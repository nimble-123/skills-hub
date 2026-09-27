//! Bundles installed into a tool, and the items inside them.
//!
//! Two tools ship plugins and each records them differently. Claude Code keeps a
//! registry file listing install paths; Codex keeps a versioned cache directory
//! that has to be walked. Both end up as a [`PluginSource`] plus the items found
//! under it.
//!
//! An item from a bundle is never individually toggleable — the bundle is the
//! unit the owning tool understands — so a disabled bundle forces every item
//! inside it to report as disabled regardless of where the file sits.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::model::{DiscoveredItem, ItemType, PluginSource, ToolConfig};
use crate::paths;
use crate::scan::{ScanOutcome, Scope, Walk};

/// Marker that tells a real Codex bundle apart from a marketplace source tree.
const CODEX_BUNDLE_MARKER: &str = ".codex-plugin";

/// Bundles and their items, across every tool that has any.
#[derive(Debug, Default)]
pub struct PluginScan {
    pub plugins: Vec<PluginSource>,
    pub items: Vec<DiscoveredItem>,
}

#[must_use]
pub fn scan_all_plugins(tools: &[ToolConfig], home: &Path) -> PluginScan {
    let mut scan = PluginScan::default();

    for tool in tools {
        let mut plugins = Vec::new();
        plugins.extend(read_registry_plugins(tool, home));
        plugins.extend(read_cached_plugins(tool, home));

        for plugin in plugins {
            scan.items.extend(scan_plugin_items(tool, &plugin, home));
            scan.plugins.push(plugin);
        }
    }

    scan
}

// ------------------------------------------------------------------ registry

#[derive(Deserialize)]
struct Registry {
    #[serde(default)]
    plugins: std::collections::BTreeMap<String, Vec<RegistryInstall>>,
}

#[derive(Deserialize)]
struct RegistryInstall {
    #[serde(rename = "installPath")]
    install_path: PathBuf,
}

#[derive(Deserialize)]
struct PluginSettings {
    #[serde(default, rename = "enabledPlugins")]
    enabled_plugins: std::collections::BTreeMap<String, bool>,
}

/// Bundles listed in a tool's installed-plugins registry (Claude Code).
fn read_registry_plugins(tool: &ToolConfig, home: &Path) -> Vec<PluginSource> {
    let Some(registry_path) = &tool.plugins_registry else {
        return Vec::new();
    };
    let Some(registry) = read_json::<Registry>(&paths::expand_home(registry_path, home)) else {
        return Vec::new();
    };

    let enabled_map = tool
        .plugins_settings_path
        .as_ref()
        .and_then(|path| read_json::<PluginSettings>(&paths::expand_home(path, home)))
        .map(|settings| settings.enabled_plugins)
        .unwrap_or_default();

    registry
        .plugins
        .into_iter()
        .filter_map(|(key, installs)| {
            let install = installs.into_iter().next()?;
            let (name, group) = split_plugin_key(&key);
            Some(PluginSource {
                // Absent from the map means enabled: the file only records
                // decisions the user has actually made.
                enabled: enabled_map.get(&key).copied().unwrap_or(true),
                repo_url: read_repo_url(&install.install_path),
                id: key,
                name,
                group,
                path: install.install_path,
                tool_id: tool.id.clone(),
            })
        })
        .collect()
}

/// `name@marketplace` split into its parts.
fn split_plugin_key(key: &str) -> (String, Option<String>) {
    match key.split_once('@') {
        Some((name, group)) => (name.to_owned(), Some(group.to_owned())),
        None => (key.to_owned(), None),
    }
}

// --------------------------------------------------------------------- cache

/// Bundles found by walking a versioned cache (Codex).
///
/// Layout is `<cache>/<marketplace>/<plugin>/<version>/`. Only a directory
/// holding the bundle marker counts — the same cache also contains marketplace
/// source trees, which are not installed plugins.
fn read_cached_plugins(tool: &ToolConfig, home: &Path) -> Vec<PluginSource> {
    let mut found = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_paths = HashSet::new();

    for raw_root in &tool.plugins_paths {
        let root = paths::expand_home(raw_root, home);
        for marketplace in read_dir_names(&root) {
            let market_dir = root.join(&marketplace);
            for plugin_name in read_dir_names(&market_dir) {
                let plugin_dir = market_dir.join(&plugin_name);
                // A cache can hold several versions mid-update; first wins.
                let Some(install_path) = read_dir_names(&plugin_dir)
                    .into_iter()
                    .map(|version| plugin_dir.join(version))
                    .find(|dir| dir.join(CODEX_BUNDLE_MARKER).exists())
                else {
                    continue;
                };

                let id = format!("{}:{marketplace}:{plugin_name}", tool.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                if !seen_paths.insert(super::real_path(&install_path)) {
                    continue;
                }

                found.push(PluginSource {
                    name: read_manifest_name(&install_path).unwrap_or_else(|| plugin_name.clone()),
                    repo_url: read_repo_url(&install_path),
                    id,
                    group: Some(marketplace.clone()),
                    path: install_path,
                    tool_id: tool.id.clone(),
                    // Codex offers no supported way to enable or disable an
                    // installed plugin from outside, so these are read-only.
                    enabled: true,
                });
            }
        }
    }

    found
}

// --------------------------------------------------------------------- items

fn scan_plugin_items(tool: &ToolConfig, plugin: &PluginSource, home: &Path) -> Vec<DiscoveredItem> {
    let mut items = Vec::new();

    for item_type in ItemType::ALL {
        let Some(subfolder) = plugin_subfolder(tool, item_type, home) else {
            continue;
        };

        let mut walk = Walk::new(Scope {
            tool_id: &tool.id,
            item_type,
            // A bundle is installed for the tool, not for a project.
            project_id: None,
            plugin_id: Some(&plugin.id),
        });
        walk.directory(&plugin.path.join(subfolder));

        items.extend(walk.finish().items);
    }

    if !plugin.enabled {
        for item in &mut items {
            item.enabled = false;
        }
    }
    items
}

/// Where inside a bundle this type lives.
///
/// Defaults to the last segment of the tool's own global path — `~/.claude/skills`
/// becomes `skills` — unless the tool declares an override, as Codex does for
/// commands.
fn plugin_subfolder(tool: &ToolConfig, item_type: ItemType, home: &Path) -> Option<PathBuf> {
    if let Some(explicit) = tool.plugin_paths.get(&item_type) {
        return Some(PathBuf::from(explicit));
    }
    let raw = tool.paths.get(&item_type)?;
    let expanded = paths::expand_home(raw, home);
    expanded.file_name().map(PathBuf::from)
}

// ------------------------------------------------------------------ manifests

#[derive(Deserialize)]
struct PluginManifest {
    name: Option<String>,
    repository: Option<String>,
}

/// Reads whichever of the two known manifest locations exists.
fn read_manifest(install_path: &Path) -> Option<PluginManifest> {
    [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]
        .into_iter()
        .find_map(|relative| read_json::<PluginManifest>(&install_path.join(relative)))
}

fn read_manifest_name(install_path: &Path) -> Option<String> {
    read_manifest(install_path)?.name
}

/// The bundle's repository, accepted only when it is a GitHub URL.
///
/// Anything else cannot be offered to Discover, and a half-usable value would
/// be worse than none.
fn read_repo_url(install_path: &Path) -> Option<String> {
    let url = read_manifest(install_path)?.repository?;
    let normalised = url.trim().to_ascii_lowercase();
    let is_github = normalised.starts_with("https://github.com/")
        || normalised.starts_with("http://github.com/")
        || normalised.starts_with("https://www.github.com/")
        || normalised.starts_with("http://www.github.com/");
    is_github.then_some(url)
}

// ------------------------------------------------------------------- plumbing

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(err) => {
            tracing::debug!(path = %path.display(), %err, "ignoring unreadable plugin JSON");
            None
        }
    }
}

fn read_dir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(ToOwned::to_owned))
        .collect();
    names.sort_unstable();
    names
}

/// Convenience for callers that want both halves of a scan in one value.
impl From<PluginScan> for ScanOutcome {
    fn from(scan: PluginScan) -> Self {
        Self {
            items: scan.items,
            warnings: Vec::new(),
        }
    }
}
