//! The metadata store, against real files.
//!
//! These cases are about one thing: the user's tags, favourites and notes are
//! theirs, and nothing the scanner does may cost them any of it.

#![allow(clippy::expect_used, clippy::panic)]

use std::collections::HashSet;
use std::path::PathBuf;

use skills_core::model::{DiscoveredItem, ItemType};
use skills_core::store::prune::{PruneRequest, SkipReason};
use skills_core::store::{MetaPatch, MetaStore, Wrote};

fn store() -> (tempfile::TempDir, MetaStore) {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = MetaStore::open(dir.path().join("AI Skills Manager")).expect("open store");
    (dir, store)
}

fn item(entry_id: &str, name: &str) -> DiscoveredItem {
    DiscoveredItem {
        entry_id: entry_id.to_owned(),
        source_path: PathBuf::from(format!("/home/.claude/skills/{name}/SKILL.md")),
        real_path: PathBuf::from(format!("/home/.agents/skills/{name}/SKILL.md")),
        tool: "claude-code".to_owned(),
        item_type: ItemType::Skill,
        project_id: None,
        plugin_id: None,
        name: name.to_owned(),
        description: format!("{name} does things"),
        enabled: true,
    }
}

fn full_scan(found: &[&str]) -> PruneRequest {
    PruneRequest {
        found: found.iter().map(|id| (*id).to_string()).collect(),
        broken: HashSet::new(),
        full_scan: true,
        had_warnings: false,
    }
}

/// Backdates a note's orphan marker so the grace period has demonstrably passed.
fn backdate_orphan(store: &MetaStore, entry_id: &str, days: i64) {
    let path = store.note_path(entry_id);
    let raw = std::fs::read_to_string(&path).expect("read note");
    let when = jiff::Timestamp::now() - jiff::SignedDuration::from_hours(days * 24);
    let patched = raw.replace(
        &raw.lines()
            .find(|line| line.starts_with("orphanedAt:"))
            .expect("note is marked as orphaned")
            .to_string(),
        &format!("orphanedAt: {when}"),
    );
    std::fs::write(&path, patched).expect("write note");
}

// -------------------------------------------------------------- writing notes

#[test]
fn creates_one_note_per_item_named_after_its_id() {
    let (_dir, store) = store();
    assert_eq!(
        store
            .ensure(&item("writing-abc", "writing"))
            .expect("ensure"),
        Wrote::Created
    );

    let path = store.note_path("writing-abc");
    assert!(path.exists());
    assert_eq!(path.file_name().expect("name"), "writing-abc.md");

    let listed = store.list().expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].discovered.name, "writing");
}

/// The one that keeps a synced vault quiet. The Obsidian plugin rewrote every
/// note on every scan, so the whole library looked modified, every time.
#[test]
fn a_second_scan_that_found_the_same_thing_writes_nothing() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("first");

    let path = store.note_path("writing-abc");
    let before = std::fs::metadata(&path)
        .expect("stat")
        .modified()
        .expect("mtime");

    assert_eq!(
        store
            .ensure(&item("writing-abc", "writing"))
            .expect("second"),
        Wrote::Nothing
    );

    let after = std::fs::metadata(&path)
        .expect("stat")
        .modified()
        .expect("mtime");
    assert_eq!(before, after, "the file must not have been touched");
}

#[test]
fn a_changed_description_is_written_through() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("first");

    let mut changed = item("writing-abc", "writing");
    changed.description = "A better description".into();
    assert_eq!(store.ensure(&changed).expect("second"), Wrote::Updated);

    assert_eq!(
        store.list().expect("list")[0].discovered.description,
        "A better description"
    );
}

// ------------------------------------------------------------ the user's data

#[test]
fn a_rescan_does_not_disturb_tags_favourites_or_collections() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("ensure");

    store
        .update(
            "writing-abc",
            &MetaPatch {
                tags: Some(vec!["sap".into(), "abap".into()]),
                favorite: Some(true),
                collections: Some(vec!["daily".into()]),
                source: None,
            },
        )
        .expect("update");

    let mut moved = item("writing-abc", "writing");
    moved.enabled = false;
    moved.description = "Moved and disabled".into();
    store.ensure(&moved).expect("rescan");

    let listed = store.list().expect("list");
    assert_eq!(listed[0].tags, vec!["sap", "abap"]);
    assert!(listed[0].favorite);
    assert_eq!(listed[0].collections, vec!["daily"]);
    assert!(!listed[0].discovered.enabled, "the derived half did update");
}

#[test]
fn an_edit_made_outside_the_application_survives_the_next_scan() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("ensure");

    // The user opens the note in Obsidian, adds a tag and writes prose.
    let path = store.note_path("writing-abc");
    let raw = std::fs::read_to_string(&path).expect("read");
    let edited = raw
        .replace("tags: []", "tags:\n- hand-written")
        .replace("---\n\n", "---\n")
        + "\nMy own notes about this skill.\n";
    std::fs::write(&path, edited).expect("write");

    store
        .ensure(&item("writing-abc", "writing"))
        .expect("rescan");

    let after = std::fs::read_to_string(&path).expect("read");
    assert!(after.contains("hand-written"), "the tag survived");
    assert!(
        after.contains("My own notes about this skill."),
        "the body survived"
    );
}

#[test]
fn an_unknown_frontmatter_key_survives_a_rescan() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("ensure");

    let path = store.note_path("writing-abc");
    let raw = std::fs::read_to_string(&path).expect("read");
    std::fs::write(
        &path,
        raw.replacen("---\n", "---\ncssclass: skill\nreviewed: 2026-01-01\n", 1),
    )
    .expect("write");

    store
        .ensure(&item("writing-abc", "writing"))
        .expect("rescan");

    let after = std::fs::read_to_string(&path).expect("read");
    assert!(after.contains("cssclass:"));
    assert!(after.contains("reviewed:"));
}

#[test]
fn tags_are_trimmed_and_de_duplicated_without_being_reordered() {
    let (_dir, store) = store();
    store
        .ensure(&item("writing-abc", "writing"))
        .expect("ensure");

    let updated = store
        .update(
            "writing-abc",
            &MetaPatch {
                tags: Some(vec![
                    "  SAP  ".into(),
                    "abap".into(),
                    "sap".into(),
                    "   ".into(),
                ]),
                ..MetaPatch::default()
            },
        )
        .expect("update");

    assert_eq!(updated.tags, vec!["SAP", "abap"]);
}

#[test]
fn updating_something_that_was_never_scanned_is_an_error_not_a_new_note() {
    let (_dir, store) = store();
    let err = store
        .update(
            "never-seen",
            &MetaPatch {
                favorite: Some(true),
                ..MetaPatch::default()
            },
        )
        .expect_err("should fail");
    assert_eq!(err.code(), "unknown-item");
    assert!(!store.note_path("never-seen").exists());
}

#[test]
fn a_markdown_file_that_is_not_ours_is_left_alone() {
    let (_dir, store) = store();
    let stray = store.root().join("Some other note.md");
    std::fs::write(&stray, "# Just a note\n\nNothing to do with skills.\n").expect("write");

    assert!(store.list().expect("list").is_empty());
    assert_eq!(store.load_all().expect("load").foreign, vec![stray.clone()]);
    assert!(stray.exists());
}

// ------------------------------------------------------------------- pruning

#[test]
fn a_partial_scan_prunes_nothing() {
    let (_dir, store) = store();
    store.ensure(&item("gone-abc", "gone")).expect("ensure");

    let outcome = store
        .prune(&PruneRequest {
            full_scan: false,
            ..full_scan(&[])
        })
        .expect("prune");

    assert_eq!(outcome.skipped, Some(SkipReason::PartialScan));
    assert!(store.note_path("gone-abc").exists());
}

/// The case that matters most on macOS: a folder the app has not been given
/// consent to read looks exactly like a folder with nothing in it.
#[test]
fn a_scan_that_could_not_read_something_prunes_nothing() {
    let (_dir, store) = store();
    store.ensure(&item("gone-abc", "gone")).expect("ensure");

    let outcome = store
        .prune(&PruneRequest {
            had_warnings: true,
            ..full_scan(&["other"])
        })
        .expect("prune");

    assert_eq!(outcome.skipped, Some(SkipReason::ScanHadWarnings));
    assert!(store.note_path("gone-abc").exists());
}

#[test]
fn a_scan_that_found_nothing_at_all_prunes_nothing() {
    let (_dir, store) = store();
    store.ensure(&item("gone-abc", "gone")).expect("ensure");

    let outcome = store.prune(&full_scan(&[])).expect("prune");

    assert_eq!(outcome.skipped, Some(SkipReason::ScanFoundNothing));
    assert!(store.note_path("gone-abc").exists());
}

#[test]
fn a_missing_item_is_marked_before_it_is_ever_removed() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.ensure(&item("gone-abc", "gone")).expect("ensure");

    let outcome = store.prune(&full_scan(&["kept-abc"])).expect("prune");

    assert_eq!(outcome.marked, vec!["gone-abc"]);
    assert!(outcome.trashed.is_empty());
    assert!(store.note_path("gone-abc").exists());

    let orphans = store.orphans().expect("orphans");
    assert_eq!(orphans.len(), 1);
    assert_eq!(orphans[0].entry_id, "gone-abc");
    assert!(!orphans[0].has_user_data);
}

#[test]
fn an_item_that_comes_back_stops_being_an_orphan() {
    let (_dir, store) = store();
    store
        .ensure(&item("blinked-abc", "blinked"))
        .expect("ensure");
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.prune(&full_scan(&["kept-abc"])).expect("prune");
    assert_eq!(store.orphans().expect("orphans").len(), 1);

    store
        .ensure(&item("blinked-abc", "blinked"))
        .expect("found again");

    assert!(store.orphans().expect("orphans").is_empty());
}

#[test]
fn a_long_gone_note_with_nothing_in_it_is_moved_to_the_trash() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.ensure(&item("gone-abc", "gone")).expect("ensure");
    store.prune(&full_scan(&["kept-abc"])).expect("mark");
    backdate_orphan(&store, "gone-abc", 20);

    let outcome = store.prune(&full_scan(&["kept-abc"])).expect("prune");

    assert_eq!(outcome.trashed, vec!["gone-abc"]);
    assert!(!store.note_path("gone-abc").exists());
    assert!(store.note_path("kept-abc").exists());
}

#[test]
fn a_note_is_not_removed_before_the_grace_period_is_up() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.ensure(&item("gone-abc", "gone")).expect("ensure");
    store.prune(&full_scan(&["kept-abc"])).expect("mark");
    backdate_orphan(&store, "gone-abc", 3);

    let outcome = store.prune(&full_scan(&["kept-abc"])).expect("prune");

    assert!(outcome.trashed.is_empty());
    assert!(store.note_path("gone-abc").exists());
}

/// However long it has been gone, a note the user put something into is theirs
/// to delete, not ours.
#[test]
fn a_note_carrying_user_data_is_never_removed_automatically() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.ensure(&item("gone-abc", "gone")).expect("ensure");
    store
        .update(
            "gone-abc",
            &MetaPatch {
                tags: Some(vec!["precious".into()]),
                ..MetaPatch::default()
            },
        )
        .expect("tag it");

    store.prune(&full_scan(&["kept-abc"])).expect("mark");
    backdate_orphan(&store, "gone-abc", 400);
    let outcome = store.prune(&full_scan(&["kept-abc"])).expect("prune");

    assert!(outcome.trashed.is_empty());
    assert_eq!(outcome.retained_with_user_data, vec!["gone-abc"]);
    assert!(store.note_path("gone-abc").exists());

    let orphan = &store.orphans().expect("orphans")[0];
    assert!(orphan.has_user_data, "the UI can offer it for review");
}

#[test]
fn an_item_whose_symlink_is_broken_keeps_its_note() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store
        .ensure(&item("dangling-abc", "dangling"))
        .expect("ensure");

    let mut request = full_scan(&["kept-abc"]);
    request.broken.insert("dangling-abc".to_owned());
    let outcome = store.prune(&request).expect("prune");

    assert!(
        outcome.marked.is_empty(),
        "not even marked: we can see the file"
    );
    assert!(store.note_path("dangling-abc").exists());
}

#[test]
fn the_user_can_let_an_orphan_go() {
    let (_dir, store) = store();
    store.ensure(&item("kept-abc", "kept")).expect("ensure");
    store.ensure(&item("gone-abc", "gone")).expect("ensure");
    store
        .update(
            "gone-abc",
            &MetaPatch {
                favorite: Some(true),
                ..MetaPatch::default()
            },
        )
        .expect("favourite it");
    store.prune(&full_scan(&["kept-abc"])).expect("mark");

    assert_eq!(store.forget(&["gone-abc".to_owned()]).expect("forget"), 1);
    assert!(!store.note_path("gone-abc").exists());
    assert!(store.note_path("kept-abc").exists());
}

// ------------------------------------------------------------------ provenance

#[test]
fn install_provenance_round_trips() {
    use skills_core::model::InstallSource;

    let (_dir, store) = store();
    store
        .ensure(&item("installed-abc", "installed"))
        .expect("ensure");

    let source = InstallSource {
        source_repo: Some("https://github.com/acme/skills.git".into()),
        source_ref: Some(String::new()),
        source_subpath: Some("skills/installed".into()),
        source_commit: Some("a1b2c3d4".into()),
    };
    store
        .update(
            "installed-abc",
            &MetaPatch {
                source: Some(source.clone()),
                ..MetaPatch::default()
            },
        )
        .expect("update");

    assert_eq!(store.list().expect("list")[0].source, source);
}
