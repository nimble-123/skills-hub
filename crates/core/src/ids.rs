//! Stable identity for an item.
//!
//! An id has to survive two things: the enable/disable move, which changes an
//! item's path, and two same-named items living in different directories, which
//! must not collide. The first is handled by stripping the disabled folder out
//! of the path before hashing; the second by hashing the path at all.
//!
//! The Obsidian plugin slugged the whole identity tuple and truncated the result
//! to 80 characters, which for a deeply nested path discards the entire path
//! discriminator — two same-named items could then share one metadata note and
//! overwrite each other's tags. A hash has no such ceiling.

use std::path::{Component, Path, PathBuf};

use crate::fsunit::DISABLED_DIRNAME;
use crate::model::ItemType;

/// Characters of the readable prefix kept in front of the hash.
const NAME_PREFIX_LEN: usize = 32;
/// Hex characters of the hash. 16 is 64 bits: ample for a few thousand items.
const HASH_LEN: usize = 16;

/// Lowercase, hyphen-separated, safe as a filename. Not truncated.
#[must_use]
pub fn slug(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pending_separator = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_separator && !out.is_empty() {
                out.push('-');
            }
            pending_separator = false;
            out.push(ch.to_ascii_lowercase());
        } else {
            pending_separator = true;
        }
    }

    if out.is_empty() {
        "item".to_owned()
    } else {
        out
    }
}

/// The identity of one item: readable prefix, then a hash of the full tuple.
///
/// The prefix exists so a metadata file is recognisable in a folder listing;
/// only the hash carries uniqueness.
#[must_use]
pub fn entry_id(
    tool_id: &str,
    item_type: ItemType,
    project_id: Option<&str>,
    plugin_id: Option<&str>,
    name: &str,
    identity_path: &Path,
) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in [
        tool_id,
        item_type.as_str(),
        project_id.unwrap_or("global"),
        plugin_id.unwrap_or("none"),
        name,
    ] {
        hasher.update(part.as_bytes());
        hasher.update(b"\0");
    }
    hasher.update(
        stable_entry_path(identity_path)
            .as_os_str()
            .as_encoded_bytes(),
    );

    let prefix: String = slug(name).chars().take(NAME_PREFIX_LEN).collect();
    let digest = hasher.finalize().to_hex();
    format!("{}-{}", prefix.trim_end_matches('-'), &digest[..HASH_LEN])
}

/// The path with every disabled-folder segment removed.
///
/// Disabling an item moves it one directory deeper; without this, that move
/// would change its identity and orphan its metadata.
#[must_use]
pub fn stable_entry_path(path: &Path) -> PathBuf {
    path.components()
        .filter(|component| !is_disabled_dir(component))
        .collect()
}

fn is_disabled_dir(component: &Component<'_>) -> bool {
    matches!(component, Component::Normal(name) if name.to_str() == Some(DISABLED_DIRNAME))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const TOOL: &str = "claude-code";

    fn id_for(name: &str, path: &str) -> String {
        entry_id(TOOL, ItemType::Skill, None, None, name, Path::new(path))
    }

    #[test]
    fn slugs_are_lowercase_and_hyphenated() {
        assert_eq!(slug("SAP ABAP CDS"), "sap-abap-cds");
        assert_eq!(slug("  leading & trailing  "), "leading-trailing");
        assert_eq!(slug("already-fine"), "already-fine");
    }

    #[test]
    fn a_slug_of_nothing_usable_still_yields_a_name() {
        assert_eq!(slug(""), "item");
        assert_eq!(slug("...---..."), "item");
    }

    #[test]
    fn slugs_are_not_truncated() {
        let long = "a".repeat(200);
        assert_eq!(slug(&long).len(), 200);
    }

    #[test]
    fn disabling_an_item_does_not_change_its_identity() {
        let enabled = id_for("obsidian", "/Users/n/.claude/skills/obsidian/SKILL.md");
        let disabled = id_for(
            "obsidian",
            "/Users/n/.claude/skills/.skillmanager-disabled/obsidian/SKILL.md",
        );
        assert_eq!(enabled, disabled);
    }

    #[test]
    fn same_name_in_different_directories_gets_different_ids() {
        assert_ne!(
            id_for("review", "/Users/n/.claude/skills/backend/review/SKILL.md"),
            id_for("review", "/Users/n/.claude/skills/frontend/review/SKILL.md")
        );
    }

    /// The bug this module exists to fix: the plugin's 80-character slug left
    /// nothing of a long path, so these two items collided onto one metadata note.
    #[test]
    fn long_paths_sharing_an_eighty_character_prefix_do_not_collide() {
        let shared = "/Users/n/.claude/skills/very-long-category-name-that-eats-the-budget";
        let a = format!("{shared}/{}/alpha/SKILL.md", "x".repeat(120));
        let b = format!("{shared}/{}/beta/SKILL.md", "x".repeat(120));

        assert_eq!(
            &a[..80],
            &b[..80],
            "the paths really do share an 80-char prefix"
        );
        assert_ne!(id_for("review", &a), id_for("review", &b));
    }

    #[test]
    fn every_component_of_the_tuple_is_part_of_the_identity() {
        let path = Path::new("/Users/n/.claude/skills/thing/SKILL.md");
        let base = entry_id(TOOL, ItemType::Skill, None, None, "thing", path);

        assert_ne!(
            base,
            entry_id("codex", ItemType::Skill, None, None, "thing", path)
        );
        assert_ne!(
            base,
            entry_id(TOOL, ItemType::Agent, None, None, "thing", path)
        );
        assert_ne!(
            base,
            entry_id(TOOL, ItemType::Skill, Some("p1"), None, "thing", path)
        );
        assert_ne!(
            base,
            entry_id(TOOL, ItemType::Skill, None, Some("pl"), "thing", path)
        );
        assert_ne!(
            base,
            entry_id(TOOL, ItemType::Skill, None, None, "other", path)
        );
    }

    #[test]
    fn ids_are_filename_safe_and_start_with_a_readable_prefix() {
        let id = id_for("SAP ABAP / CDS", "/x/y/SKILL.md");
        assert!(id.starts_with("sap-abap-cds-"));
        assert!(
            id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "{id} must be safe as a filename"
        );
    }

    #[test]
    fn a_very_long_name_is_shortened_to_a_prefix_but_stays_unique() {
        let long_a = format!("{}-alpha", "n".repeat(120));
        let long_b = format!("{}-beta", "n".repeat(120));
        let a = id_for(&long_a, "/x/SKILL.md");
        let b = id_for(&long_b, "/x/SKILL.md");

        assert!(a.len() <= NAME_PREFIX_LEN + 1 + HASH_LEN);
        assert_ne!(a, b);
    }
}
