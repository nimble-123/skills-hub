//! Where the user's own metadata lives.
//!
//! One markdown file per item, in a folder the user chooses — normally inside
//! an Obsidian vault, so the notes sync with everything else they have and stay
//! queryable from Dataview. That choice is why these are markdown files with
//! frontmatter rather than rows in a database, and it is also why the rules
//! about not clobbering them are as strict as they are: this is a folder the
//! user opens and edits.

pub mod note;
pub mod prune;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::model::{DiscoveredItem, InstallSource, ItemMetadata};

pub use note::{Frontmatter, ID_VERSION, Note};
pub use prune::{PruneOutcome, PruneRequest};

/// The user's edits to one item.
///
/// Every field is optional so a caller can change one thing without having to
/// restate the rest, which would race with the user editing the note directly.
#[derive(Debug, Clone, Default)]
pub struct MetaPatch {
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub collections: Option<Vec<String>>,
    pub source: Option<InstallSource>,
}

/// A folder of metadata notes.
#[derive(Debug)]
pub struct MetaStore {
    root: PathBuf,
}

/// What `ensure` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wrote {
    /// The note already said exactly this. Nothing was touched.
    Nothing,
    Created,
    Updated,
}

impl MetaStore {
    /// Opens (and creates, if needed) the folder holding the notes.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root).map_err(|err| CoreError::io(&root, err))?;
        Ok(Self { root })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The file a given item's note lives in.
    ///
    /// The entry id is already a readable slug plus a hash, so it is safe as a
    /// filename as it stands. The Obsidian plugin slugged it a second time here
    /// and truncated it again in the process.
    #[must_use]
    pub fn note_path(&self, entry_id: &str) -> PathBuf {
        self.root.join(format!("{entry_id}.md"))
    }

    /// Every note in the folder, keyed by entry id.
    ///
    /// Files that are not notes of ours — anything without readable
    /// frontmatter — are reported rather than parsed, so a stray markdown file
    /// in the same folder is left alone instead of being adopted.
    pub fn load_all(&self) -> Result<Loaded> {
        let mut notes = BTreeMap::new();
        let mut foreign = Vec::new();

        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::default()),
            Err(err) => return Err(CoreError::io(&self.root, err)),
        };

        for entry in entries {
            let path = entry.map_err(|err| CoreError::io(&self.root, err))?.path();
            if path.extension().is_none_or(|ext| ext != "md") {
                continue;
            }
            let raw = match std::fs::read_to_string(&path) {
                Ok(raw) => raw,
                Err(err) => return Err(CoreError::io(&path, err)),
            };
            match note::parse(&raw) {
                Ok(parsed) if !parsed.front.entry_id.is_empty() => {
                    notes.insert(parsed.front.entry_id.clone(), parsed);
                }
                Ok(_) | Err(_) => foreign.push(path),
            }
        }

        Ok(Loaded { notes, foreign })
    }

    /// Everything the store knows, as the application's own item type.
    pub fn list(&self) -> Result<Vec<ItemMetadata>> {
        Ok(self
            .load_all()?
            .notes
            .values()
            .map(|note| note.front.to_metadata())
            .collect())
    }

    /// Records what a scan found, preserving whatever the user put there.
    ///
    /// Returns [`Wrote::Nothing`] when the note already says exactly this,
    /// which is the common case and the reason a rescan does not touch the
    /// mtime of every file in a synced folder.
    pub fn ensure(&self, item: &DiscoveredItem) -> Result<Wrote> {
        let path = self.note_path(&item.entry_id);
        let now = now_rfc3339();

        if let Some(mut existing) = Self::read_note(&path)? {
            let before = existing.clone();
            existing.front.refresh_from(item, &now);
            return self.write_if_changed(&path, &before, &existing);
        }

        let note = Note {
            front: Frontmatter::new(item, &now),
            body: String::new(),
        };
        self.write(&path, &note)?;
        Ok(Wrote::Created)
    }

    /// Applies a user edit to one note.
    pub fn update(&self, entry_id: &str, patch: &MetaPatch) -> Result<ItemMetadata> {
        let note_file = self.note_path(entry_id);
        let Some(mut note) = Self::read_note(&note_file)? else {
            return Err(CoreError::UnknownItem {
                entry_id: entry_id.to_owned(),
            });
        };

        let before = note.clone();
        if let Some(tags) = &patch.tags {
            note.front.tags = normalise_tags(tags);
        }
        if let Some(favorite) = patch.favorite {
            note.front.favorite = favorite;
        }
        if let Some(collections) = &patch.collections {
            note.front.collections.clone_from(collections);
        }
        if let Some(source) = &patch.source {
            note.front.source_repo.clone_from(&source.source_repo);
            note.front.source_ref.clone_from(&source.source_ref);
            note.front.source_subpath.clone_from(&source.source_subpath);
            note.front.source_commit.clone_from(&source.source_commit);
        }

        let metadata = note.front.to_metadata();
        self.write_if_changed(&note_file, &before, &note)?;
        Ok(metadata)
    }

    fn read_note(path: &Path) -> Result<Option<Note>> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(CoreError::io(path, err)),
        };
        match note::parse(&raw) {
            Ok(note) => Ok(Some(note)),
            Err(err) => Err(CoreError::UnreadableNote {
                path: path.to_path_buf(),
                reason: err.to_string(),
            }),
        }
    }

    /// Writes only when the rendered file would differ.
    ///
    /// `lastScanned` alone is not a change worth a write — otherwise every scan
    /// rewrites every note, and a synced or version-controlled folder shows the
    /// whole library as modified, every time.
    fn write_if_changed(&self, path: &Path, before: &Note, after: &Note) -> Result<Wrote> {
        if unchanged_apart_from_scan_time(before, after) {
            return Ok(Wrote::Nothing);
        }
        self.write(path, after)?;
        Ok(Wrote::Updated)
    }

    /// Writes a note atomically.
    ///
    /// Through a temporary file in the same directory and a rename, so a reader
    /// — Obsidian, a sync client — never sees a half-written note.
    fn write(&self, path: &Path, note: &Note) -> Result<()> {
        use std::io::Write as _;

        let rendered = note::render(note).map_err(|err| CoreError::UnreadableNote {
            path: path.to_path_buf(),
            reason: err.to_string(),
        })?;

        let mut temp = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|err| CoreError::io(&self.root, err))?;
        temp.write_all(rendered.as_bytes())
            .and_then(|()| temp.as_file().sync_all())
            .map_err(|err| CoreError::io(path, err))?;
        temp.persist(path)
            .map_err(|err| CoreError::io(path, err.error))?;
        Ok(())
    }
}

/// Everything found in the notes folder.
#[derive(Debug, Default)]
pub struct Loaded {
    pub notes: BTreeMap<String, Note>,
    /// Markdown files in the folder that are not notes of ours.
    pub foreign: Vec<PathBuf>,
}

/// Two notes that differ only in when they were last scanned.
fn unchanged_apart_from_scan_time(before: &Note, after: &Note) -> bool {
    if before.body != after.body {
        return false;
    }
    let mut a = before.front.clone();
    let mut b = after.front.clone();
    a.last_scanned = None;
    b.last_scanned = None;
    a == b
}

/// Trimmed, de-duplicated, order preserved.
fn normalise_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .filter(|tag| seen.insert(tag.to_lowercase()))
        .map(ToOwned::to_owned)
        .collect()
}

/// The current instant, as the notes record it.
///
/// Whole seconds: these timestamps are read by a person and queried by
/// Dataview, and fractional seconds are noise in both.
#[must_use]
pub fn now_rfc3339() -> String {
    jiff::Timestamp::now()
        .round(jiff::Unit::Second)
        .unwrap_or_else(|_| jiff::Timestamp::now())
        .to_string()
}
