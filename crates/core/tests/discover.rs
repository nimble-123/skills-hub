//! Finding installable items in a repository.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::Path;

use skills_core::discover::{self, DiscoverCatalog, DiscoverEntry};
use skills_core::git::{GitRunner as _, SystemGit};
use skills_core::model::ItemType;

const NOW: &str = "2026-09-27T12:00:00Z";

struct Origin {
    dir: tempfile::TempDir,
}

impl Origin {
    fn new() -> Self {
        let origin = Self {
            dir: tempfile::tempdir().expect("tempdir"),
        };
        origin.git(&["init", "--quiet", "--initial-branch", "main"]);
        origin.git(&["config", "user.email", "test@example.invalid"]);
        origin.git(&["config", "user.name", "Test"]);
        origin
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn url(&self) -> String {
        self.path().to_string_lossy().into_owned()
    }

    fn git(&self, args: &[&str]) -> String {
        SystemGit
            .run(args, Some(self.path()))
            .unwrap_or_else(|err| panic!("git {args:?}: {err}"))
    }

    fn write(&self, relative: &str, content: &str) -> &Self {
        let path = self.path().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, content).expect("write");
        self
    }

    fn skill(&self, folder: &str, name: &str) -> &Self {
        self.write(
            &format!("{folder}/SKILL.md"),
            &format!("---\nname: {name}\ndescription: {name} does things\ntags: alpha, beta\n---\n\nBody.\n"),
        )
    }

    fn commit(&self) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "-m", "content"]);
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }
}

fn find(entries: &[DiscoverEntry], name: &str) -> DiscoverEntry {
    entries
        .iter()
        .find(|entry| entry.name == name)
        .unwrap_or_else(|| {
            panic!(
                "no entry called {name}; found {:?}",
                entries.iter().map(|e| &e.name).collect::<Vec<_>>()
            )
        })
        .clone()
}

fn names(entries: &[DiscoverEntry]) -> Vec<&str> {
    let mut out: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    out.sort_unstable();
    out
}

fn run(origin: &Origin, subpath: &str) -> Vec<DiscoverEntry> {
    discover::discover(&SystemGit, &origin.url(), "", subpath, NOW)
        .expect("discover")
        .1
}

// ------------------------------------------------------------------- shapes

#[test]
fn finds_a_folder_skill_and_reads_its_frontmatter() {
    let origin = Origin::new();
    origin.skill("skills/writing", "writing-well");
    let commit = origin.commit();

    let entries = run(&origin, "");
    let entry = find(&entries, "writing-well");

    assert_eq!(entry.item_type, ItemType::Skill);
    assert_eq!(entry.description, "writing-well does things");
    assert_eq!(entry.tags, vec!["alpha", "beta"]);
    assert_eq!(
        entry.subpath, "skills/writing",
        "the folder is what installs"
    );
    assert_eq!(entry.commit, commit);
    assert!(entry.manifest.contains("Body."), "the manifest is cached");
}

/// What something is comes from where it sits.
#[test]
fn reads_the_type_from_the_folder_it_is_in() {
    let origin = Origin::new();
    origin
        .write("agents/reviewer.md", "---\nname: reviewer\n---\n")
        .write("commands/deploy.md", "---\nname: deploy\n---\n")
        .write("prompts/refactor.md", "---\nname: refactor\n---\n")
        .write("rules/style.md", "---\nname: style\n---\n");
    origin.commit();

    let entries = run(&origin, "");
    assert_eq!(find(&entries, "reviewer").item_type, ItemType::Agent);
    assert_eq!(find(&entries, "deploy").item_type, ItemType::Command);
    assert_eq!(find(&entries, "refactor").item_type, ItemType::Command);
    assert_eq!(find(&entries, "style").item_type, ItemType::Rule);
}

#[test]
fn the_type_carries_down_into_subfolders() {
    let origin = Origin::new();
    origin.write("commands/git/commit.md", "---\nname: commit\n---\n");
    origin.commit();

    assert_eq!(
        find(&run(&origin, ""), "commit").item_type,
        ItemType::Command
    );
}

#[test]
fn a_loose_markdown_file_with_nothing_saying_what_it_is_is_not_an_item() {
    let origin = Origin::new();
    origin
        .write("README.md", "# A repository\n")
        .write("docs/guide.md", "# A guide\n")
        .skill("skills/real", "real");
    origin.commit();

    assert_eq!(names(&run(&origin, "")), vec!["real"]);
}

#[test]
fn a_skills_own_files_are_not_separate_items() {
    let origin = Origin::new();
    origin
        .skill("skills/writing", "writing")
        .write("skills/writing/references/style.md", "# Style\n")
        .write(
            "skills/writing/commands/nested.md",
            "---\nname: nested\n---\n",
        );
    origin.commit();

    assert_eq!(names(&run(&origin, "")), vec!["writing"]);
}

/// Copilot keeps prompts under `.github/`, and a Claude plugin's manifest
/// lives in `.claude-plugin/`. Skipping dot-folders would miss both.
#[test]
fn looks_inside_dot_folders() {
    let origin = Origin::new();
    origin.write(".github/prompts/refactor.md", "---\nname: refactor\n---\n");
    origin.commit();

    assert_eq!(names(&run(&origin, "")), vec!["refactor"]);
}

#[test]
fn never_looks_inside_node_modules_or_git() {
    let origin = Origin::new();
    origin
        .skill("node_modules/pkg/skills/nope", "from-node-modules")
        .skill("skills/real", "real");
    origin.commit();

    assert_eq!(names(&run(&origin, "")), vec!["real"]);
}

#[test]
fn falls_back_to_the_file_or_folder_name() {
    let origin = Origin::new();
    origin
        .write("skills/untitled/SKILL.md", "no frontmatter at all\n")
        .write("commands/plain.md", "no frontmatter\n");
    origin.commit();

    assert_eq!(names(&run(&origin, "")), vec!["plain", "untitled"]);
}

// ------------------------------------------------------------------ subpaths

#[test]
fn a_subpath_narrows_the_walk() {
    let origin = Origin::new();
    origin
        .skill("packs/one/skills/alpha", "alpha")
        .skill("packs/two/skills/beta", "beta");
    origin.commit();

    assert_eq!(names(&run(&origin, "packs/one")), vec!["alpha"]);
    assert_eq!(names(&run(&origin, "")).len(), 2);
}

/// Pasting a link to one skill's folder is the obvious thing to do, and the
/// walk only ever looked at a folder's children.
#[test]
fn a_subpath_pointing_straight_at_a_skill_finds_it() {
    let origin = Origin::new();
    origin
        .skill("skills/writing", "writing")
        .skill("skills/other", "other");
    origin.commit();

    let entries = run(&origin, "skills/writing");

    assert_eq!(names(&entries), vec!["writing"]);
    assert_eq!(entries[0].subpath, "skills/writing");
}

/// The same for a link to one command file.
#[test]
fn a_subpath_pointing_straight_at_a_markdown_file_finds_it() {
    let origin = Origin::new();
    origin.write("commands/deploy.md", "---\nname: deploy\n---\n");
    origin.commit();

    let entries = run(&origin, "commands/deploy.md");

    assert_eq!(names(&entries), vec!["deploy"]);
    assert_eq!(entries[0].item_type, ItemType::Command);
    assert_eq!(entries[0].subpath, "commands/deploy.md");
}

#[test]
fn a_subpath_that_is_not_there_says_so() {
    let origin = Origin::new();
    origin.skill("skills/writing", "writing");
    origin.commit();

    let err = discover::discover(&SystemGit, &origin.url(), "", "nope", NOW).expect_err("fail");
    assert_eq!(err.code(), "subpath-missing");
}

#[test]
fn a_repository_with_nothing_installable_yields_nothing_rather_than_failing() {
    let origin = Origin::new();
    origin.write("README.md", "# Nothing here\n");
    origin.commit();

    assert!(run(&origin, "").is_empty());
}

// -------------------------------------------------------------------- source

#[test]
fn the_source_records_what_it_was_asked_for() {
    let origin = Origin::new();
    origin.skill("skills/writing", "writing");
    origin.commit();

    let (source, _) =
        discover::discover(&SystemGit, &origin.url(), "", "skills", NOW).expect("discover");

    assert_eq!(source.repo_url, origin.url());
    assert_eq!(source.subpath, "skills");
    assert_eq!(source.added_at, NOW);
    assert_eq!(source.stars, None, "not asked yet");
}

#[test]
fn the_same_repository_branch_and_subpath_is_the_same_source() {
    let a = discover::source_id("https://example.invalid/a.git", "", "skills");
    let b = discover::source_id("https://example.invalid/a.git", "", "skills");
    let other_subpath = discover::source_id("https://example.invalid/a.git", "", "other");
    let other_branch = discover::source_id("https://example.invalid/a.git", "next", "skills");

    assert_eq!(a, b);
    assert_ne!(a, other_subpath);
    assert_ne!(a, other_branch);
}

// ------------------------------------------------------------------- catalog

#[test]
fn refetching_a_source_replaces_what_was_known_about_it() {
    let origin = Origin::new();
    origin
        .skill("skills/alpha", "alpha")
        .skill("skills/beta", "beta");
    origin.commit();

    let mut catalog = DiscoverCatalog::default();
    let (source, entries) =
        discover::discover(&SystemGit, &origin.url(), "", "", NOW).expect("first");
    catalog.replace_source(source, entries);
    assert_eq!(catalog.entries.len(), 2);

    // The repository loses one.
    std::fs::remove_dir_all(origin.path().join("skills/beta")).expect("remove");
    origin.commit();

    let (source, entries) =
        discover::discover(&SystemGit, &origin.url(), "", "", NOW).expect("second");
    catalog.replace_source(source, entries);

    assert_eq!(
        names(&catalog.entries),
        vec!["alpha"],
        "the gone one is gone"
    );
    assert_eq!(catalog.sources.len(), 1, "and it is still one source");
}

#[test]
fn removing_a_source_takes_its_entries_with_it() {
    let origin = Origin::new();
    origin.skill("skills/alpha", "alpha");
    origin.commit();

    let mut catalog = DiscoverCatalog::default();
    let (source, entries) = discover::discover(&SystemGit, &origin.url(), "", "", NOW).expect("d");
    let id = source.id.clone();
    catalog.replace_source(source, entries);

    catalog.remove_source(&id);

    assert!(catalog.sources.is_empty());
    assert!(catalog.entries.is_empty());
}

#[test]
fn two_sources_keep_their_own_entries() {
    let one = Origin::new();
    one.skill("skills/alpha", "alpha");
    one.commit();
    let two = Origin::new();
    two.skill("skills/beta", "beta");
    two.commit();

    let mut catalog = DiscoverCatalog::default();
    for origin in [&one, &two] {
        let (source, entries) =
            discover::discover(&SystemGit, &origin.url(), "", "", NOW).expect("discover");
        catalog.replace_source(source, entries);
    }

    assert_eq!(catalog.sources.len(), 2);
    assert_eq!(names(&catalog.entries), vec!["alpha", "beta"]);
}
