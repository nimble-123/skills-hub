//! Finding installable items inside a repository.
//!
//! There is no GitHub API here beyond a star count. A repository is cloned,
//! walked, and thrown away — which works for any host git can reach, needs no
//! token, and has no rate limit.
//!
//! What something *is* comes from where it sits, not from what is in it. A
//! folder holding a `SKILL.md` is a skill; a markdown file inside a folder
//! called `agents`, `commands`, `prompts` or `rules` is one of those. Guessing
//! from content would be wrong more interestingly and more often.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::git::{ClonedRepo, GitRunner, shallow_clone};
use crate::model::ItemType;
use crate::{frontmatter, ids};

/// How deep to look inside a repository.
///
/// More generous than the item scan: a repository organises itself however it
/// likes, and skills are often several folders down.
const MAX_DEPTH: usize = 6;

/// Folder names that say what the markdown inside them is.
const TYPE_DIRNAMES: [(&str, ItemType); 7] = [
    ("agent", ItemType::Agent),
    ("agents", ItemType::Agent),
    ("command", ItemType::Command),
    ("commands", ItemType::Command),
    ("prompt", ItemType::Command),
    ("prompts", ItemType::Command),
    ("rules", ItemType::Rule),
];

/// Folders never descended into.
///
/// Dot-folders are deliberately *not* among them: Copilot's prompts live under
/// `.github/`, and a Claude plugin's manifest under `.claude-plugin/`.
const SKIP_DIRNAMES: [&str; 2] = ["node_modules", ".git"];

/// A repository the user is watching for installable items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverSource {
    pub id: String,
    pub repo_url: String,
    /// Empty means the default branch.
    pub ref_name: String,
    /// Empty means the whole repository.
    pub subpath: String,
    pub added_at: String,
    /// Stars, and when that was last asked. `None` means never asked.
    #[serde(default)]
    pub stars: Option<u32>,
    #[serde(default)]
    pub stars_fetched_at: Option<String>,
}

/// One installable item found in a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverEntry {
    pub id: String,
    /// The source it came from.
    pub source_id: String,
    pub repo_url: String,
    pub ref_name: String,
    /// Where in the repository this item is.
    pub subpath: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    /// The commit it was found at.
    pub commit: String,
    /// The manifest's text, cached so a preview needs no second clone.
    pub manifest: String,
    pub discovered_at: String,
}

/// Everything the user is watching, and what was found in it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscoverCatalog {
    pub sources: Vec<DiscoverSource>,
    pub entries: Vec<DiscoverEntry>,
}

impl DiscoverCatalog {
    /// Replaces everything known about one source.
    ///
    /// Replacing rather than merging: a refetch is the newer truth about that
    /// repository, and an item that has gone from it should go from here.
    pub fn replace_source(&mut self, source: DiscoverSource, entries: Vec<DiscoverEntry>) {
        self.entries.retain(|entry| entry.source_id != source.id);
        self.entries.extend(entries);

        match self.sources.iter_mut().find(|s| s.id == source.id) {
            Some(existing) => *existing = source,
            None => self.sources.push(source),
        }
    }

    pub fn remove_source(&mut self, source_id: &str) {
        self.sources.retain(|source| source.id != source_id);
        self.entries.retain(|entry| entry.source_id != source_id);
    }
}

/// What a repository, branch and subpath together identify.
#[must_use]
pub fn source_id(repo_url: &str, ref_name: &str, subpath: &str) -> String {
    let digest = blake3::hash(format!("{repo_url}\0{ref_name}\0{subpath}").as_bytes());
    format!("src-{}", &digest.to_hex()[..16])
}

fn entry_id(source_id: &str, subpath: &str) -> String {
    let digest = blake3::hash(format!("{source_id}\0{subpath}").as_bytes());
    let name = PathBuf::from(subpath)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("item")
        .to_owned();
    format!("{}-{}", ids::slug(&name), &digest.to_hex()[..12])
}

/// Clones a repository and reports everything installable in it.
pub fn discover(
    git: &dyn GitRunner,
    repo_url: &str,
    ref_name: &str,
    subpath: &str,
    now: &str,
) -> Result<(DiscoverSource, Vec<DiscoverEntry>)> {
    let clone = shallow_clone(git, repo_url, Some(ref_name))?;
    let root = clone
        .resolve(subpath)
        .ok_or_else(|| crate::error::CoreError::GitFailed {
            args: format!("resolve {subpath}"),
            message: "that subpath reaches outside the repository".to_owned(),
        })?;

    if !root.exists() {
        return Err(crate::error::CoreError::SubpathMissing {
            subpath: subpath.to_owned(),
        });
    }

    let id = source_id(repo_url, ref_name, subpath);
    let entries = collect(&clone, &root, &id, repo_url, ref_name, now);

    Ok((
        DiscoverSource {
            id,
            repo_url: repo_url.to_owned(),
            ref_name: ref_name.to_owned(),
            subpath: subpath.to_owned(),
            added_at: now.to_owned(),
            stars: None,
            stars_fetched_at: None,
        },
        entries,
    ))
}

fn collect(
    clone: &ClonedRepo,
    root: &Path,
    source_id: &str,
    repo_url: &str,
    ref_name: &str,
    now: &str,
) -> Vec<DiscoverEntry> {
    let mut found = Vec::new();
    let mut push = |path: &Path, item_type: ItemType| {
        if let Some(entry) = describe(clone, path, item_type, source_id, repo_url, ref_name, now) {
            found.push(entry);
        }
    };

    // The subpath may name one item rather than a folder of them, which is
    // what a link to a single skill gives you. The walk below only ever looks
    // at a folder's children, so the root is checked here.
    match root_item(root) {
        Some((path, item_type)) => push(&path, item_type),
        None => walk(root, type_of_dirname(root), 0, &mut push),
    }

    found.sort_by(|a, b| a.subpath.cmp(&b.subpath));
    found
}

/// The item the subpath names, when it names one rather than a folder of them.
fn root_item(root: &Path) -> Option<(PathBuf, ItemType)> {
    let manifest = root.join(crate::fsunit::SKILL_MANIFEST);
    if manifest.is_file() {
        return Some((manifest, ItemType::Skill));
    }
    if root.is_file()
        && root
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        // A lone file: what it is still comes from the folder holding it.
        let item_type = root
            .parent()
            .and_then(type_of_dirname)
            .unwrap_or(ItemType::Command);
        return Some((root.to_path_buf(), item_type));
    }
    None
}

/// The type a folder's own name implies, if any.
///
/// Pointing a subpath at `commands/` should still make what is inside it
/// commands, even though the walk starts below that folder.
fn type_of_dirname(dir: &Path) -> Option<ItemType> {
    let name = dir.file_name()?.to_str()?.to_ascii_lowercase();
    TYPE_DIRNAMES
        .iter()
        .find(|(dirname, _)| *dirname == name)
        .map(|(_, item_type)| *item_type)
}

/// Walks a directory, calling back for every installable thing.
///
/// `hint` is the type implied by an enclosing folder, and it carries down:
/// `commands/git/commit.md` is a command.
fn walk(dir: &Path, hint: Option<ItemType>, depth: usize, found: &mut impl FnMut(&Path, ItemType)) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();

    for path in paths {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if SKIP_DIRNAMES.contains(&name) {
            continue;
        }

        if path.is_dir() {
            // A folder with a manifest is a skill, and nothing inside it is a
            // separate item — its `references/` and `scripts/` belong to it.
            if path.join(crate::fsunit::SKILL_MANIFEST).is_file() {
                found(&path.join(crate::fsunit::SKILL_MANIFEST), ItemType::Skill);
                continue;
            }
            let lower = name.to_ascii_lowercase();
            let inherited = TYPE_DIRNAMES
                .iter()
                .find(|(dirname, _)| *dirname == lower)
                .map(|(_, item_type)| *item_type)
                .or(hint);
            walk(&path, inherited, depth + 1, found);
            continue;
        }

        // A loose markdown file only counts where a folder says what it is.
        if let Some(item_type) = hint
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            && name != crate::fsunit::SKILL_MANIFEST
        {
            found(&path, item_type);
        }
    }
}

fn describe(
    clone: &ClonedRepo,
    path: &Path,
    item_type: ItemType,
    source_id: &str,
    repo_url: &str,
    ref_name: &str,
    now: &str,
) -> Option<DiscoverEntry> {
    // What gets installed is the folder for a skill, the file otherwise.
    let unit = crate::fsunit::linkable_unit(path);
    let subpath = relative_posix(clone.path(), &unit.path)?;

    let manifest = std::fs::read_to_string(path).ok()?;
    let head: String = manifest.chars().take(frontmatter::HEAD_BYTES).collect();
    let meta = frontmatter::parse_source_meta(&head);

    let fallback = if unit.is_dir {
        unit.name.clone()
    } else {
        unit.name.trim_end_matches(".md").to_owned()
    };

    Some(DiscoverEntry {
        id: entry_id(source_id, &subpath),
        source_id: source_id.to_owned(),
        repo_url: repo_url.to_owned(),
        ref_name: ref_name.to_owned(),
        subpath,
        item_type,
        name: if meta.name.is_empty() {
            fallback
        } else {
            meta.name
        },
        description: meta.description,
        tags: parse_tags(&head),
        commit: clone.commit.clone(),
        manifest,
        discovered_at: now.to_owned(),
    })
}

fn parse_tags(head: &str) -> Vec<String> {
    frontmatter::parse(head)
        .into_iter()
        .find(|field| field.key == "tags")
        .map(|field| {
            field
                .value
                .split(',')
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// A path inside the clone, with forward slashes.
///
/// Forward slashes because this is stored and shown as a repository path, and
/// a backslash there would be wrong even on Windows.
fn relative_posix(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let joined: Vec<String> = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(joined.join("/"))
}

// --------------------------------------------------------------- persistence

/// Reads and writes the catalogue as one JSON file.
///
/// Kept apart from the settings: it holds every item found in every watched
/// repository, with each manifest cached, so it grows without bound while the
/// settings stay small enough to read and hand-edit.
#[derive(Debug, Clone)]
pub struct CatalogFile {
    path: PathBuf,
}

impl CatalogFile {
    #[must_use]
    pub fn new(config_dir: impl AsRef<Path>) -> Self {
        Self {
            path: config_dir.as_ref().join("discover.json"),
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Loads the catalogue, or an empty one.
    ///
    /// An unreadable file is a lost list of repositories, which is a nuisance
    /// rather than a loss: nothing in it cannot be found again by adding the
    /// repository back. So it starts empty rather than refusing to open.
    #[must_use]
    pub fn load(&self) -> DiscoverCatalog {
        let Ok(raw) = std::fs::read_to_string(&self.path) else {
            return DiscoverCatalog::default();
        };
        serde_json::from_str(&raw).unwrap_or_else(|err| {
            tracing::warn!(path = %self.path.display(), %err, "the discover catalogue is unreadable");
            DiscoverCatalog::default()
        })
    }

    pub fn save(&self, catalog: &DiscoverCatalog) -> Result<()> {
        use std::io::Write as _;

        let dir = self.path.parent().ok_or_else(|| {
            crate::error::CoreError::io(&self.path, std::io::Error::other("no parent directory"))
        })?;
        std::fs::create_dir_all(dir).map_err(|err| crate::error::CoreError::io(dir, err))?;

        let json = serde_json::to_string_pretty(catalog)
            .map_err(|err| crate::error::CoreError::io(&self.path, std::io::Error::other(err)))?;

        let mut temp = tempfile::NamedTempFile::new_in(dir)
            .map_err(|err| crate::error::CoreError::io(dir, err))?;
        temp.write_all(json.as_bytes())
            .and_then(|()| temp.write_all(b"\n"))
            .and_then(|()| temp.as_file().sync_all())
            .map_err(|err| crate::error::CoreError::io(&self.path, err))?;
        temp.persist(&self.path)
            .map_err(|err| crate::error::CoreError::io(&self.path, err.error))?;
        Ok(())
    }
}
