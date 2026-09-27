//! One metadata note: a markdown file that is almost all frontmatter.
//!
//! These files live in the user's vault and are meant to be read, queried and
//! edited there. Two consequences shape everything below. Anything the user or
//! another tool put in a note must survive being rewritten — the body verbatim,
//! unknown frontmatter keys intact. And a note must only be written when
//! something actually changed, because a folder that is synced or under version
//! control should not show every file as modified after every scan.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{DiscoveredItem, InstallSource, ItemMetadata, ItemType};

/// Version of the identity scheme the ids in these notes were built with.
///
/// Bumping it means every existing id is stale, so notes must be rematched to
/// items before anything is treated as orphaned.
pub const ID_VERSION: u32 = 1;

/// A parsed note: its frontmatter, and everything after it untouched.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    pub front: Frontmatter,
    /// Everything after the closing fence, byte for byte.
    pub body: String,
}

/// The frontmatter of a metadata note.
///
/// Three zones, and the distinction matters: derived fields are rewritten from
/// disk on every scan, user fields are never touched by a scan, and provenance
/// is written once at install time. Field order here is the order they appear
/// in the file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frontmatter {
    pub entry_id: String,
    #[serde(default = "default_id_version")]
    pub id_version: u32,

    // ---- derived from the filesystem
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type", default = "default_item_type")]
    pub item_type: ItemType,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub source_path: String,
    #[serde(default)]
    pub real_path: String,
    /// Defaults to true: a note whose `enabled` key went missing describes an
    /// item that is present, and hiding it would be the more surprising error.
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub modified: Option<String>,
    #[serde(default)]
    pub last_scanned: Option<String>,

    // ---- the user's own
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub collections: Vec<String>,

    // ---- where it was installed from
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_subpath: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_commit: Option<String>,

    /// When the item behind this note stopped being found.
    ///
    /// Set rather than deleting straight away, so a scan that was wrong about a
    /// path — an unmounted volume, a tool reinstalling itself — costs nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orphaned_at: Option<String>,

    /// Everything else the file declared.
    ///
    /// Dataview fields, another plugin's keys, notes to self. Round-tripped so
    /// that writing a note never costs the user something they put there.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_yaml_ng::Value>,
}

fn default_id_version() -> u32 {
    ID_VERSION
}

fn default_item_type() -> ItemType {
    ItemType::Skill
}

fn default_true() -> bool {
    true
}

impl Frontmatter {
    /// A fresh note for a newly discovered item.
    #[must_use]
    pub fn new(item: &DiscoveredItem, now: &str) -> Self {
        Self {
            entry_id: item.entry_id.clone(),
            id_version: ID_VERSION,
            name: item.name.clone(),
            description: item.description.clone(),
            item_type: item.item_type,
            tool: item.tool.clone(),
            project_id: item.project_id.clone(),
            plugin_id: item.plugin_id.clone(),
            source_path: item.source_path.to_string_lossy().into_owned(),
            real_path: item.real_path.to_string_lossy().into_owned(),
            enabled: item.enabled,
            modified: item.modified.clone(),
            last_scanned: Some(now.to_owned()),
            tags: Vec::new(),
            favorite: false,
            collections: Vec::new(),
            source_repo: None,
            source_ref: None,
            source_subpath: None,
            source_commit: None,
            orphaned_at: None,
            extra: BTreeMap::new(),
        }
    }

    /// Overwrites the derived fields from a fresh scan, leaving everything the
    /// user owns exactly as it was.
    pub fn refresh_from(&mut self, item: &DiscoveredItem, now: &str) {
        self.id_version = ID_VERSION;
        self.name.clone_from(&item.name);
        self.description.clone_from(&item.description);
        self.item_type = item.item_type;
        self.tool.clone_from(&item.tool);
        self.project_id.clone_from(&item.project_id);
        self.plugin_id.clone_from(&item.plugin_id);
        self.source_path = item.source_path.to_string_lossy().into_owned();
        self.real_path = item.real_path.to_string_lossy().into_owned();
        self.enabled = item.enabled;
        self.modified.clone_from(&item.modified);
        self.last_scanned = Some(now.to_owned());
        // Being found again is the end of being orphaned.
        self.orphaned_at = None;
    }

    /// Whether the user has put anything here worth protecting.
    ///
    /// A note carrying user data is never deleted automatically, however long
    /// its item has been missing.
    #[must_use]
    pub fn has_user_data(&self) -> bool {
        !self.tags.is_empty()
            || self.favorite
            || !self.collections.is_empty()
            || self.source_repo.is_some()
            || !self.extra.is_empty()
    }

    #[must_use]
    pub fn to_metadata(&self) -> ItemMetadata {
        ItemMetadata {
            discovered: DiscoveredItem {
                entry_id: self.entry_id.clone(),
                source_path: self.source_path.clone().into(),
                real_path: self.real_path.clone().into(),
                tool: self.tool.clone(),
                item_type: self.item_type,
                project_id: self.project_id.clone(),
                plugin_id: self.plugin_id.clone(),
                name: self.name.clone(),
                description: self.description.clone(),
                enabled: self.enabled,
                modified: self.modified.clone(),
            },
            tags: self.tags.clone(),
            favorite: self.favorite,
            collections: self.collections.clone(),
            source: InstallSource {
                source_repo: self.source_repo.clone(),
                source_ref: self.source_ref.clone(),
                source_subpath: self.source_subpath.clone(),
                source_commit: self.source_commit.clone(),
            },
        }
    }
}

/// Splits a note file into frontmatter and body.
///
/// A file without frontmatter, or with frontmatter that cannot be understood,
/// is not a note this store owns — the caller decides what to do about it
/// rather than having it silently overwritten.
pub fn parse(raw: &str) -> Result<Note, ParseError> {
    let rest = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
        .ok_or(ParseError::NoFrontmatter)?;

    let offset = raw.len() - rest.len();
    let mut cursor = offset;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let front: Frontmatter = serde_yaml_ng::from_str(&raw[offset..cursor])
                .map_err(|err| ParseError::Yaml(err.to_string()))?;
            return Ok(Note {
                front,
                body: raw[cursor + line.len()..].to_owned(),
            });
        }
        cursor += line.len();
    }

    Err(ParseError::UnterminatedFrontmatter)
}

/// Renders a note back to a file's contents.
pub fn render(note: &Note) -> Result<String, ParseError> {
    let yaml =
        serde_yaml_ng::to_string(&note.front).map_err(|err| ParseError::Yaml(err.to_string()))?;
    Ok(format!("---\n{yaml}---\n{}", note.body))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ParseError {
    #[error("the file does not start with a frontmatter block")]
    NoFrontmatter,
    #[error("the frontmatter block is never closed")]
    UnterminatedFrontmatter,
    #[error("the frontmatter is not valid YAML: {0}")]
    Yaml(String),
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn item() -> DiscoveredItem {
        DiscoveredItem {
            entry_id: "writing-abc123".into(),
            source_path: PathBuf::from("/home/.claude/skills/writing/SKILL.md"),
            real_path: PathBuf::from("/home/.agents/skills/writing/SKILL.md"),
            tool: "claude-code".into(),
            item_type: ItemType::Skill,
            project_id: None,
            plugin_id: None,
            name: "writing".into(),
            description: "Helps you write".into(),
            enabled: true,
            modified: Some("2026-01-01T00:00:00Z".into()),
        }
    }

    #[test]
    fn round_trips_a_note_it_wrote_itself() {
        let note = Note {
            front: Frontmatter::new(&item(), "2026-09-27T09:12:44Z"),
            body: "\nSome prose the user wrote.\n".to_owned(),
        };
        let rendered = render(&note).expect("render");
        assert_eq!(parse(&rendered).expect("parse"), note);
    }

    #[test]
    fn keeps_an_unknown_key_and_the_body_verbatim() {
        let raw = "---\nentryId: writing-abc123\nname: writing\nreviewed: 2026-01-01\ncssclass: skill\n---\n\nMy own notes.\n\n- a list\n";
        let note = parse(raw).expect("parse");

        assert_eq!(note.front.extra.len(), 2, "unknown keys are kept");
        assert!(note.front.extra.contains_key("reviewed"));
        assert_eq!(note.body, "\nMy own notes.\n\n- a list\n");

        let rendered = render(&note).expect("render");
        assert!(rendered.contains("reviewed:"));
        assert!(rendered.contains("cssclass:"));
        assert!(rendered.ends_with("\nMy own notes.\n\n- a list\n"));
    }

    #[test]
    fn a_refresh_leaves_everything_the_user_owns_alone() {
        let mut front = Frontmatter::new(&item(), "2026-01-01T00:00:00Z");
        front.tags = vec!["sap".into(), "abap".into()];
        front.favorite = true;
        front.collections = vec!["daily".into()];
        front
            .extra
            .insert("reviewed".into(), serde_yaml_ng::Value::from("yes"));

        let mut moved = item();
        moved.description = "A better description".into();
        moved.enabled = false;
        front.refresh_from(&moved, "2026-09-27T09:12:44Z");

        assert_eq!(front.description, "A better description");
        assert!(!front.enabled);
        assert_eq!(front.tags, vec!["sap", "abap"]);
        assert!(front.favorite);
        assert_eq!(front.collections, vec!["daily"]);
        assert!(front.extra.contains_key("reviewed"));
    }

    #[test]
    fn being_found_again_clears_the_orphan_marker() {
        let mut front = Frontmatter::new(&item(), "2026-01-01T00:00:00Z");
        front.orphaned_at = Some("2026-02-01T00:00:00Z".into());
        front.refresh_from(&item(), "2026-09-27T09:12:44Z");
        assert_eq!(front.orphaned_at, None);
    }

    #[test]
    fn a_note_with_no_user_data_is_recognised_as_such() {
        let plain = Frontmatter::new(&item(), "now");
        assert!(!plain.has_user_data());

        for mutate in [
            (|f: &mut Frontmatter| f.tags.push("x".into())) as fn(&mut Frontmatter),
            |f| f.favorite = true,
            |f| f.collections.push("c".into()),
            |f| f.source_repo = Some("https://github.com/a/b".into()),
            |f| {
                f.extra.insert("k".into(), serde_yaml_ng::Value::from("v"));
            },
        ] {
            let mut front = Frontmatter::new(&item(), "now");
            mutate(&mut front);
            assert!(front.has_user_data());
        }
    }

    #[test]
    fn a_missing_enabled_key_reads_as_enabled() {
        let note = parse("---\nentryId: x\nname: y\n---\n").expect("parse");
        assert!(note.front.enabled);
    }

    #[test]
    fn refuses_a_file_that_is_not_one_of_ours() {
        assert_eq!(parse("Just prose.\n"), Err(ParseError::NoFrontmatter));
        assert_eq!(
            parse("---\nentryId: x\nnever closed"),
            Err(ParseError::UnterminatedFrontmatter)
        );
        assert!(matches!(
            parse("---\n\tbad: [unclosed\n---\n"),
            Err(ParseError::Yaml(_))
        ));
    }

    #[test]
    fn provenance_is_left_out_of_the_file_until_there_is_any() {
        let rendered = render(&Note {
            front: Frontmatter::new(&item(), "now"),
            body: String::new(),
        })
        .expect("render");
        assert!(!rendered.contains("sourceRepo"));
        assert!(!rendered.contains("orphanedAt"));
    }
}
