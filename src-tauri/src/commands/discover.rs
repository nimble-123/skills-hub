//! Watching repositories, and installing from them.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use skills_core::discover::{self, DiscoverCatalog};
use skills_core::git::SystemGit;
use skills_core::install::{self, InstallRequest};
use skills_core::model::{ItemMetadata, ItemType};
use skills_core::settings::effective_tools;
use skills_core::store::{MetaPatch, now_rfc3339};
use tauri::State;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn get_discover_catalog(state: State<'_, AppState>) -> CommandResult<DiscoverCatalog> {
    Ok(lock(&state.catalog)?.clone())
}

/// Clones a repository, records everything installable in it, and asks GitHub
/// how many stars it has.
#[tauri::command]
#[specta::specta]
pub async fn discover_add_source(
    repo_url: String,
    ref_name: String,
    subpath: String,
    state: State<'_, AppState>,
) -> CommandResult<DiscoverCatalog> {
    let (mut source, entries) = discover::discover(
        &SystemGit,
        &normalise_repo_url(&repo_url),
        &ref_name,
        &subpath,
        &now_rfc3339(),
    )?;

    if let Some(stars) = fetch_stars(&source.repo_url).await {
        source.stars = Some(stars);
        source.stars_fetched_at = Some(now_rfc3339());
    }

    save_catalog(&state, |catalog| catalog.replace_source(source, entries))
}

/// Clones a watched repository again and replaces what was known about it.
#[tauri::command]
#[specta::specta]
pub async fn discover_refresh_source(
    source_id: String,
    state: State<'_, AppState>,
) -> CommandResult<DiscoverCatalog> {
    let existing = lock(&state.catalog)?
        .sources
        .iter()
        .find(|source| source.id == source_id)
        .cloned()
        .ok_or_else(|| CommandError::new("unknown-source", "That repository is not watched."))?;

    let (mut source, entries) = discover::discover(
        &SystemGit,
        &existing.repo_url,
        &existing.ref_name,
        &existing.subpath,
        &now_rfc3339(),
    )?;

    // Stars are decoration and the endpoint is rate-limited without a token,
    // so a week-old count is reused rather than asked for again.
    source.stars = existing.stars;
    source.stars_fetched_at = existing.stars_fetched_at.clone();
    if stars_are_stale(existing.stars_fetched_at.as_deref())
        && let Some(stars) = fetch_stars(&source.repo_url).await
    {
        source.stars = Some(stars);
        source.stars_fetched_at = Some(now_rfc3339());
    }

    save_catalog(&state, |catalog| catalog.replace_source(source, entries))
}

#[tauri::command]
#[specta::specta]
pub fn discover_remove_source(
    source_id: String,
    state: State<'_, AppState>,
) -> CommandResult<DiscoverCatalog> {
    save_catalog(&state, |catalog| catalog.remove_source(&source_id))
}

/// Where an item from a repository should be installed.
#[derive(Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallSpec {
    pub repo_url: String,
    pub ref_name: String,
    pub subpath: String,
    pub tool_id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    /// `None` installs into the home directory.
    pub project_id: Option<String>,
}

/// Installs one item and records where it came from.
#[tauri::command]
#[specta::specta]
pub async fn install_from_github(
    spec: InstallSpec,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    let settings = lock(&state.settings)?.clone();
    let all_tools = effective_tools(skills_core::tools::default_tools(), &settings);

    let tool = all_tools
        .iter()
        .find(|tool| tool.id == spec.tool_id)
        .ok_or_else(|| CommandError::new("unknown-tool", "No tool with that id."))?;

    let project = match &spec.project_id {
        None => None,
        Some(id) => Some(
            settings
                .project_workspaces
                .iter()
                .find(|workspace| &workspace.id == id)
                .ok_or_else(|| {
                    CommandError::new("unknown-project", "No workspace with that id.")
                })?,
        ),
    };

    let installed = install::install(
        &SystemGit,
        &InstallRequest {
            repo_url: &normalise_repo_url(&spec.repo_url),
            ref_name: &spec.ref_name,
            subpath: &spec.subpath,
            tool,
            item_type: spec.item_type,
            project,
        },
        &state.home,
    )?;

    // Scanned so it gets an id and a note, then the provenance is written
    // onto that note — which is what makes updating it possible later.
    let discovered = skills_core::model::DiscoveredItem {
        entry_id: skills_core::ids::entry_id(
            &tool.id,
            spec.item_type,
            project.map(|p| p.id.as_str()),
            None,
            unit_name(&installed.source_path),
            &installed.source_path,
        ),
        real_path: skills_core::scan::real_path(&installed.source_path),
        source_path: installed.source_path.clone(),
        tool: tool.id.clone(),
        item_type: spec.item_type,
        project_id: project.map(|p| p.id.clone()),
        plugin_id: None,
        name: installed.name,
        description: installed.description,
        enabled: true,
        modified: Some(now_rfc3339()),
    };

    let guard = lock(&state.store)?;
    let store = guard
        .as_ref()
        .ok_or_else(CommandError::no_metadata_folder)?;
    store.ensure(&discovered)?;
    let metadata = store.update(
        &discovered.entry_id,
        &MetaPatch {
            source: Some(installed.source),
            ..MetaPatch::default()
        },
    )?;
    drop(guard);

    // Remove it from the catalogue: it is a real item now.
    save_catalog(&state, |catalog| {
        catalog
            .entries
            .retain(|entry| entry.repo_url != spec.repo_url || entry.subpath != spec.subpath);
    })?;

    if let Ok(mut snapshot) = state.snapshot.lock()
        && let Some(snapshot) = snapshot.as_mut()
    {
        snapshot.items.push(metadata.clone());
    }

    Ok(metadata)
}

// ------------------------------------------------------------------ plumbing

fn save_catalog(
    state: &State<'_, AppState>,
    change: impl FnOnce(&mut DiscoverCatalog),
) -> CommandResult<DiscoverCatalog> {
    let catalog = {
        let mut guard = lock(&state.catalog)?;
        change(&mut guard);
        guard.clone()
    };
    state.catalog_file.save(&catalog)?;
    Ok(catalog)
}

/// The name of the folder or file an item was installed as.
fn unit_name(source_path: &std::path::Path) -> &str {
    let unit_path = if source_path.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
        source_path.parent().unwrap_or(source_path)
    } else {
        source_path
    };
    unit_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("item")
}

/// Accepts what people paste.
///
/// A GitHub URL copied from the address bar, with or without `.git`, and the
/// `/tree/<branch>/<path>` form that appears when browsing a subfolder — the
/// branch and path in that form are the user's job to split out in the dialog,
/// so here only the repository part is kept.
fn normalise_repo_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if let Some((repo, _)) = trimmed.split_once("/tree/") {
        return repo.to_owned();
    }
    trimmed.to_owned()
}

/// How long a star count is reused before asking again.
const STARS_TTL_DAYS: i64 = 7;

fn stars_are_stale(fetched_at: Option<&str>) -> bool {
    let Some(fetched_at) = fetched_at else {
        return true;
    };
    let Ok(then) = fetched_at.parse::<jiff::Timestamp>() else {
        return true;
    };
    jiff::Timestamp::now().duration_since(then)
        >= jiff::SignedDuration::from_hours(STARS_TTL_DAYS * 24)
}

/// The star count, for repositories on GitHub.
///
/// The only network call this application makes that is not git. It is
/// decoration, it is rate-limited to sixty an hour without a token, and there
/// is no token here — so a failure is silent and the count simply goes
/// unshown.
async fn fetch_stars(repo_url: &str) -> Option<u32> {
    let slug = github_slug(repo_url)?;
    let response = tauri_plugin_http::reqwest::Client::new()
        .get(format!("https://api.github.com/repos/{slug}"))
        .header("User-Agent", "skills-hub")
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = serde_json::from_str(&response.text().await.ok()?).ok()?;
    body.get("stargazers_count")?.as_u64()?.try_into().ok()
}

/// `owner/repo`, for a GitHub URL and nothing else.
fn github_slug(repo_url: &str) -> Option<String> {
    let rest = repo_url
        .strip_prefix("https://github.com/")
        .or_else(|| repo_url.strip_prefix("http://github.com/"))
        .or_else(|| repo_url.strip_prefix("https://www.github.com/"))?;

    let cleaned = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = cleaned.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    parts.next().is_none().then(|| format!("{owner}/{repo}"))
}
