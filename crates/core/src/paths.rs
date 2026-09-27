//! Turning a configured path string into a directory to look in.
//!
//! `home` is a parameter everywhere here rather than something read from the
//! environment. That one decision is what makes the scanner testable against a
//! temporary directory instead of only against the machine it runs on.

use std::path::{Path, PathBuf};

use crate::model::{ItemType, ProjectWorkspace, ToolConfig};

/// Expands a leading `~` against the given home directory.
///
/// A path that does not start with `~` is returned as-is, absolute or not.
#[must_use]
pub fn expand_home(raw: &str, home: &Path) -> PathBuf {
    match raw.strip_prefix('~') {
        Some(rest) => home.join(rest.trim_start_matches(['/', '\\'])),
        None => PathBuf::from(raw),
    }
}

/// Derives a project-relative path from a global one by dropping the `~/`.
///
/// `~/.claude/skills` becomes `.claude/skills`. This is the fallback used when a
/// tool declares no explicit project path for a type, and it is right far more
/// often than not, because most tools mirror their home layout into a project.
#[must_use]
pub fn to_project_relative(raw: &str) -> String {
    raw.trim_start_matches('~')
        .trim_start_matches(['/', '\\'])
        .to_owned()
}

/// The directory to scan for one tool, one item type and one scope.
///
/// `project` of `None` means the global scope. Returns `None` when the tool has
/// no path configured for that type in that scope.
#[must_use]
pub fn resolve_tool_dir(
    tool: &ToolConfig,
    item_type: ItemType,
    project: Option<&ProjectWorkspace>,
    home: &Path,
) -> Option<PathBuf> {
    match project {
        None => tool.paths.get(&item_type).map(|raw| expand_home(raw, home)),
        Some(project) => {
            let relative = tool.project_paths.get(&item_type).cloned().or_else(|| {
                tool.paths
                    .get(&item_type)
                    .map(|raw| to_project_relative(raw))
            })?;
            Some(expand_home_in_project(&relative, &project.path, home))
        }
    }
}

fn expand_home_in_project(relative: &str, project_root: &Path, home: &Path) -> PathBuf {
    // A project path is normally relative, but a user override may well be
    // absolute or start with `~`; honour that rather than joining nonsense.
    if relative.starts_with('~') {
        return expand_home(relative, home);
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        project_root.join(candidate)
    }
}

/// Item types this tool can have things installed into, in display order.
///
/// Rules are excluded when the tool's rule path is a single instructions file:
/// a `CLAUDE.md` is the user's own memory, never an install target.
#[must_use]
pub fn candidate_types_for_tool(tool: &ToolConfig) -> Vec<ItemType> {
    ItemType::ALL
        .into_iter()
        .filter(|item_type| {
            if *item_type == ItemType::Rule && tool.single_file_rule {
                return false;
            }
            tool.paths.contains_key(item_type) || tool.project_paths.contains_key(item_type)
        })
        .collect()
}

/// Whether this path sits inside a folder the tool's vendor ships.
///
/// Matches a directory name at any depth, which is how `synced` (Claude Code's
/// own catalogue) and `.system` (Codex's bundled set) are recognised.
#[must_use]
pub fn is_built_in_path(source_path: &Path, tool: &ToolConfig) -> bool {
    if tool.built_in_dirnames.is_empty() {
        return false;
    }
    source_path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|segment| tool.built_in_dirnames.iter().any(|name| name == segment))
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::tools;

    fn tool(id: &str) -> &'static ToolConfig {
        tools::find(tools::default_tools(), id).expect("tool exists")
    }

    fn project() -> ProjectWorkspace {
        ProjectWorkspace {
            id: "p1".to_owned(),
            name: "Demo".to_owned(),
            path: PathBuf::from("/work/demo"),
        }
    }

    #[test]
    fn expands_a_leading_tilde() {
        let home = Path::new("/Users/nimble");
        assert_eq!(
            expand_home("~/.claude/skills", home),
            PathBuf::from("/Users/nimble/.claude/skills")
        );
        assert_eq!(expand_home("~", home), PathBuf::from("/Users/nimble"));
    }

    #[test]
    fn leaves_a_path_without_a_tilde_alone() {
        let home = Path::new("/Users/nimble");
        assert_eq!(
            expand_home("/etc/skills", home),
            PathBuf::from("/etc/skills")
        );
        assert_eq!(
            expand_home(".claude/skills", home),
            PathBuf::from(".claude/skills")
        );
    }

    #[test]
    fn derives_a_project_path_from_the_global_one_when_none_is_declared() {
        let dir = resolve_tool_dir(
            tool("cursor"),
            ItemType::Skill,
            Some(&project()),
            Path::new("/Users/nimble"),
        );
        assert_eq!(dir, Some(PathBuf::from("/work/demo/.cursor/skills")));
    }

    #[test]
    fn prefers_a_declared_project_path_over_the_derived_one() {
        // The whole point of the override: stripping "~/" off "~/.claude/CLAUDE.md"
        // would put a project's rule file at ".claude/CLAUDE.md" instead of the root.
        let dir = resolve_tool_dir(
            tool("claude-code"),
            ItemType::Rule,
            Some(&project()),
            Path::new("/Users/nimble"),
        );
        assert_eq!(dir, Some(PathBuf::from("/work/demo/CLAUDE.md")));
    }

    #[test]
    fn a_project_only_tool_has_no_global_directory() {
        assert_eq!(
            resolve_tool_dir(
                tool("continue"),
                ItemType::Rule,
                None,
                Path::new("/Users/nimble")
            ),
            None
        );
        assert_eq!(
            resolve_tool_dir(
                tool("continue"),
                ItemType::Rule,
                Some(&project()),
                Path::new("/Users/nimble")
            ),
            Some(PathBuf::from("/work/demo/.continue/rules"))
        );
    }

    #[test]
    fn a_single_file_rule_is_not_an_install_target() {
        let types = candidate_types_for_tool(tool("claude-code"));
        assert!(types.contains(&ItemType::Skill));
        assert!(!types.contains(&ItemType::Rule));

        // A tool whose rules really are a directory keeps them.
        assert!(candidate_types_for_tool(tool("cursor")).contains(&ItemType::Rule));
    }

    #[test]
    fn recognises_a_vendor_shipped_folder_at_any_depth() {
        let claude = tool("claude-code");
        assert!(is_built_in_path(
            Path::new("/Users/n/.claude/skills/synced/acme_nimble/thing/SKILL.md"),
            claude
        ));
        assert!(!is_built_in_path(
            Path::new("/Users/n/.claude/skills/mine/SKILL.md"),
            claude
        ));
        // A tool that ships nothing can have no built-in paths.
        assert!(!is_built_in_path(Path::new("/x/synced/y"), tool("cursor")));
    }
}
