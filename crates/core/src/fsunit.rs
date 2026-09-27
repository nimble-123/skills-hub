//! What an item *is* on disk.
//!
//! A skill is a folder that happens to contain a `SKILL.md`; a command or a rule
//! is the file itself. Enable/disable and project linking both need to agree on
//! which of those they are moving or pointing at, so both ask this one function.

use std::path::{Path, PathBuf};

/// The folder a disabled item is moved into, always a sibling of the item.
///
/// Named after the Obsidian plugin rather than after this application, on
/// purpose: both act on the same folders, and a shared name means neither has
/// to migrate the other's state.
pub const DISABLED_DIRNAME: &str = ".skillmanager-disabled";

/// The filename that turns a folder into a skill.
///
/// Case-sensitive, matching the tools themselves: a `skill.md` is an ordinary
/// flat file.
pub const SKILL_MANIFEST: &str = "SKILL.md";

/// The filesystem entry that represents an item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkableUnit {
    pub path: PathBuf,
    pub is_dir: bool,
    pub name: String,
}

/// Resolves a scanned source path to the entry that can be moved or linked.
#[must_use]
pub fn linkable_unit(source_path: &Path) -> LinkableUnit {
    let file_name = source_path.file_name().and_then(|n| n.to_str());

    if file_name == Some(SKILL_MANIFEST)
        && let Some(dir) = source_path.parent()
    {
        return LinkableUnit {
            path: dir.to_path_buf(),
            is_dir: true,
            name: basename(dir),
        };
    }

    LinkableUnit {
        path: source_path.to_path_buf(),
        is_dir: false,
        name: basename(source_path),
    }
}

fn basename(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_manifest_resolves_to_its_containing_folder() {
        let unit = linkable_unit(Path::new("/home/.claude/skills/writing/SKILL.md"));
        assert_eq!(unit.path, PathBuf::from("/home/.claude/skills/writing"));
        assert!(unit.is_dir);
        assert_eq!(unit.name, "writing");
    }

    #[test]
    fn a_flat_file_resolves_to_itself() {
        let unit = linkable_unit(Path::new("/home/.claude/commands/review.md"));
        assert_eq!(unit.path, PathBuf::from("/home/.claude/commands/review.md"));
        assert!(!unit.is_dir);
        assert_eq!(unit.name, "review.md");
    }

    #[test]
    fn the_manifest_name_is_case_sensitive() {
        // Lowercase `skill.md` is not a manifest; the tools do not treat it as one.
        let unit = linkable_unit(Path::new("/home/.claude/skills/writing/skill.md"));
        assert!(!unit.is_dir);
        assert_eq!(unit.name, "skill.md");
    }

    #[test]
    fn a_single_instructions_file_resolves_to_itself() {
        let unit = linkable_unit(Path::new("/work/demo/CLAUDE.md"));
        assert_eq!(unit.path, PathBuf::from("/work/demo/CLAUDE.md"));
        assert!(!unit.is_dir);
        assert_eq!(unit.name, "CLAUDE.md");
    }
}
