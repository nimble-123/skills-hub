//! Usage, cost and MCP configuration.

#![allow(clippy::expect_used, clippy::panic, clippy::cast_possible_truncation)]

use std::path::{Path, PathBuf};

use skills_core::dashboard::{self, OverlapReason, PruneReason};
use skills_core::mcp;
use skills_core::model::{
    DiscoveredItem, InstallSource, ItemMetadata, ItemType, ProjectWorkspace, ToolConfig,
};
use skills_core::tools;
use skills_core::usage::{self, UsageStats};

struct Fixture {
    dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
        }
    }

    fn home(&self) -> &Path {
        self.dir.path()
    }

    fn write(&self, relative: &str, content: &str) -> PathBuf {
        let path = self.home().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(&path, content).expect("write");
        path
    }
}

fn item(name: &str, item_type: ItemType, source_path: PathBuf) -> ItemMetadata {
    ItemMetadata {
        discovered: DiscoveredItem {
            entry_id: format!("{name}-id"),
            real_path: source_path.clone(),
            source_path,
            tool: "claude-code".into(),
            item_type,
            project_id: None,
            plugin_id: None,
            name: name.to_owned(),
            description: String::new(),
            enabled: true,
            modified: Some("2026-09-01T00:00:00Z".into()),
        },
        tags: Vec::new(),
        favorite: false,
        collections: Vec::new(),
        source: InstallSource::default(),
    }
}

fn tool(id: &str) -> ToolConfig {
    tools::find(tools::default_tools(), id)
        .expect("tool")
        .clone()
}

// ---------------------------------------------------------------- claude usage

/// One line of a real transcript, trimmed to what matters.
fn assistant_line(when: &str, tool_name: &str, input: &str) -> String {
    format!(
        r#"{{"type":"assistant","timestamp":"{when}","message":{{"content":[{{"type":"tool_use","name":"{tool_name}","input":{input}}}]}}}}"#
    )
}

#[test]
fn counts_skill_and_agent_invocations_in_claude_history() {
    let fx = Fixture::new();
    fx.write(
        ".claude/projects/one/session.jsonl",
        &[
            assistant_line("2026-09-01T10:00:00Z", "Skill", r#"{"skill":"writing"}"#),
            assistant_line("2026-09-05T10:00:00Z", "Skill", r#"{"skill":"writing"}"#),
            assistant_line(
                "2026-09-02T10:00:00Z",
                "Agent",
                r#"{"subagent_type":"Explore"}"#,
            ),
            // Other tools are not invocations of anything in the library.
            assistant_line("2026-09-03T10:00:00Z", "Bash", r#"{"command":"ls"}"#),
        ]
        .join("\n"),
    );

    let raw = usage::claude::scan(fx.home(), &|_, _| {});

    assert_eq!(
        raw.get("skill:writing"),
        Some(&UsageStats {
            count: 2,
            last_used: Some("2026-09-05T10:00:00Z".into()),
        })
    );
    assert_eq!(raw.get("agent:Explore").map(|s| s.count), Some(1));
    assert_eq!(raw.get("skill:ls"), None);
}

#[test]
fn ignores_everything_that_is_not_an_assistant_turn() {
    let fx = Fixture::new();
    fx.write(
        ".claude/projects/one/session.jsonl",
        &[
            // A user echoing a tool_use block back is not an invocation.
            r#"{"type":"user","timestamp":"2026-09-01T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"writing"}}]}}"#.to_owned(),
            r#"{"type":"attachment","timestamp":"2026-09-01T10:00:00Z"}"#.to_owned(),
            "not json at all".to_owned(),
            String::new(),
        ]
        .join("\n"),
    );

    assert!(usage::claude::scan(fx.home(), &|_, _| {}).is_empty());
}

#[test]
fn adds_up_across_every_project_and_session() {
    let fx = Fixture::new();
    for (project, when) in [
        ("one", "2026-09-01T10:00:00Z"),
        ("two", "2026-09-09T10:00:00Z"),
    ] {
        fx.write(
            &format!(".claude/projects/{project}/session.jsonl"),
            &assistant_line(when, "Skill", r#"{"skill":"writing"}"#),
        );
    }

    let raw = usage::claude::scan(fx.home(), &|_, _| {});
    let stats = raw.get("skill:writing").expect("found");

    assert_eq!(stats.count, 2);
    assert_eq!(
        stats.last_used.as_deref(),
        Some("2026-09-09T10:00:00Z"),
        "the newer one"
    );
}

#[test]
fn no_history_at_all_is_not_an_error() {
    let fx = Fixture::new();
    assert!(usage::claude::scan(fx.home(), &|_, _| {}).is_empty());
}

#[test]
fn joins_usage_onto_the_items_it_belongs_to() {
    let fx = Fixture::new();
    let items = vec![
        item(
            "writing",
            ItemType::Skill,
            fx.write(".claude/skills/writing/SKILL.md", "x"),
        ),
        item(
            "unused",
            ItemType::Skill,
            fx.write(".claude/skills/unused/SKILL.md", "x"),
        ),
        // Commands leave no trace, by construction.
        item(
            "deploy",
            ItemType::Command,
            fx.write(".claude/commands/deploy.md", "x"),
        ),
    ];
    let mut raw = usage::RawUsage::new();
    raw.insert(
        "skill:writing".into(),
        UsageStats {
            count: 3,
            last_used: Some("2026-09-05T10:00:00Z".into()),
        },
    );

    let joined = usage::join(&items, &raw, "claude-code");

    assert_eq!(joined.get("writing-id").map(|s| s.count), Some(3));
    assert_eq!(
        joined.get("unused-id").map(|s| s.count),
        Some(0),
        "known, and never used"
    );
    assert!(
        !joined.contains_key("deploy-id"),
        "commands are not recorded at all"
    );
}

#[test]
fn a_plugin_item_is_invoked_by_its_plugin_name() {
    let fx = Fixture::new();
    let mut bundled = item("linting", ItemType::Skill, fx.write("x/SKILL.md", "x"));
    bundled.discovered.plugin_id = Some("toolkit@acme".into());

    assert_eq!(usage::invocation_key(&bundled), "skill:toolkit:linting");
}

// ----------------------------------------------------------------- codex usage

#[test]
fn infers_codex_usage_from_the_paths_in_commands_it_ran() {
    let fx = Fixture::new();
    let mut writing = item(
        "writing",
        ItemType::Skill,
        fx.write(".codex/skills/writing/SKILL.md", "x"),
    );
    writing.discovered.tool = "codex".into();
    let mut other = item(
        "other",
        ItemType::Skill,
        fx.write(".codex/skills/other/SKILL.md", "x"),
    );
    other.discovered.tool = "codex".into();
    let items = vec![writing, other];

    let call = |when: &str, input: &str| {
        format!(
            r#"{{"type":"response_item","timestamp":"{when}","payload":{{"type":"custom_tool_call","name":"exec","input":"{input}"}}}}"#
        )
    };
    fx.write(
        ".codex/sessions/2026/09/27/session.jsonl",
        &[
            call("2026-09-27T10:00:00Z", "cat ~/.codex/skills/writing/SKILL.md"),
            // The catalogue of available skills is not a use of them. It is
            // not inside a tool call, so it is never looked at.
            r#"{"type":"response_item","timestamp":"2026-09-27T09:00:00Z","payload":{"type":"message","content":"available: .codex/skills/other"}}"#.to_owned(),
        ]
        .join("\n"),
    );

    let raw = usage::codex::scan(fx.home(), &usage::codex::needles(&items), &|_, _| {});

    assert_eq!(raw.get("skill:writing").map(|s| s.count), Some(1));
    assert_eq!(raw.get("skill:other"), None, "only what was actually run");
}

/// The one that got away. A recorded shell command is nothing but escaped
/// quotes, and serde can only lend a `&str` out of JSON that has none — so
/// borrowing outright made every line that mattered fail to parse and be
/// skipped without a word. Against a real 459 MB history this reported zero
/// uses of a skill that had run forty-six times.
#[test]
fn counts_a_command_full_of_escaped_quotes() {
    let fx = Fixture::new();
    let mut imagegen = item(
        "imagegen",
        ItemType::Skill,
        fx.write(".codex/skills/imagegen/SKILL.md", "x"),
    );
    imagegen.discovered.tool = "codex".into();

    // Built with serde rather than written by hand, so the escaping is the
    // library's problem and the fixture cannot quietly be wrong.
    let line = serde_json::json!({
        "type": "response_item",
        "timestamp": "2026-09-27T10:00:00Z",
        "payload": {
            "type": "custom_tool_call",
            "name": "exec",
            "input": r#"const r = await tools.exec_command({cmd:"cat ~/.codex/skills/imagegen/SKILL.md"})"#,
        }
    })
    .to_string();
    assert!(
        line.contains(r#"\""#),
        "the fixture really does contain escapes"
    );
    fx.write(".codex/sessions/2026/09/27/session.jsonl", &line);

    let raw = usage::codex::scan(fx.home(), &usage::codex::needles(&[imagegen]), &|_, _| {});

    assert_eq!(raw.get("skill:imagegen").map(|s| s.count), Some(1));
}

/// The same trap on the other side: an input that needs escaping.
#[test]
fn counts_a_claude_invocation_whose_input_needs_escaping() {
    let fx = Fixture::new();
    let line = serde_json::json!({
        "type": "assistant",
        "timestamp": "2026-09-01T10:00:00Z",
        "message": {
            "content": [{
                "type": "tool_use",
                "name": "Agent",
                "input": {
                    "subagent_type": "Explore",
                    "description": r#"a "quoted" description"#,
                }
            }]
        }
    })
    .to_string();
    assert!(
        line.contains(r#"\""#),
        "the fixture really does contain escapes"
    );
    fx.write(".claude/projects/one/session.jsonl", &line);

    let raw = usage::claude::scan(fx.home(), &|_, _| {});

    assert_eq!(raw.get("agent:Explore").map(|s| s.count), Some(1));
}

#[test]
fn does_not_count_a_name_that_merely_appears_inside_another() {
    let fx = Fixture::new();
    let mut pdf = item(
        "pdf",
        ItemType::Skill,
        fx.write(".codex/skills/pdf/SKILL.md", "x"),
    );
    pdf.discovered.tool = "codex".into();

    fx.write(
        ".codex/sessions/2026/09/27/session.jsonl",
        r#"{"type":"response_item","timestamp":"2026-09-27T10:00:00Z","payload":{"type":"custom_tool_call","name":"exec","input":"open ~/Downloads/pdf-notes.txt"}}"#,
    );

    let raw = usage::codex::scan(fx.home(), &usage::codex::needles(&[pdf]), &|_, _| {});
    assert!(raw.is_empty());
}

// -------------------------------------------------------------------- costs

#[test]
fn separates_what_is_always_loaded_from_what_is_loaded_on_use() {
    let fx = Fixture::new();
    let body = "This is the body of the skill.";
    let path = fx.write(
        ".claude/skills/writing/SKILL.md",
        &format!("---\nname: writing\ndescription: Helps you write\n---\n{body}"),
    );
    let mut skill = item("writing", ItemType::Skill, path);
    skill.discovered.description = "Helps you write".into();

    let costs = dashboard::measure(&[skill]);
    let cost = &costs[0];

    assert!(cost.source_chars > 0);
    // Name plus description plus a separator: what a tool carries every turn.
    assert_eq!(
        cost.available_chars,
        Some(("writing".len() + "Helps you write".len() + 1) as u32)
    );
    assert_eq!(cost.invocation_chars, Some(body.len() as u32));
    assert!(
        cost.invocation_chars < Some(cost.source_chars),
        "the frontmatter is not body"
    );
}

/// How and when each tool loads a command or a rule is not modelled, and
/// calling a file's size a per-turn cost would be worse than saying nothing.
#[test]
fn does_not_guess_at_what_a_command_or_rule_costs_per_turn() {
    let fx = Fixture::new();
    let command = item(
        "deploy",
        ItemType::Command,
        fx.write(".claude/commands/deploy.md", "run it"),
    );
    let rule = item(
        "style",
        ItemType::Rule,
        fx.write(".cursor/rules/style.md", "be brief"),
    );

    for cost in dashboard::measure(&[command, rule]) {
        assert!(cost.source_chars > 0, "its size is still known");
        assert_eq!(cost.available_chars, None);
        assert_eq!(cost.invocation_chars, None);
    }
}

#[test]
fn a_disabled_item_costs_nothing_and_is_not_measured() {
    let fx = Fixture::new();
    let mut off = item(
        "off",
        ItemType::Skill,
        fx.write(".claude/skills/off/SKILL.md", "x"),
    );
    off.discovered.enabled = false;

    assert!(dashboard::measure(&[off]).is_empty());
}

// ------------------------------------------------------------------- pruning

#[test]
fn a_recorded_invocation_settles_it_whatever_the_file_looks_like() {
    let fx = Fixture::new();
    let used = item(
        "used",
        ItemType::Skill,
        fx.write(".claude/skills/used/SKILL.md", &"x".repeat(9000)),
    );
    let never = item(
        "never",
        ItemType::Skill,
        fx.write(".claude/skills/never/SKILL.md", "tiny"),
    );

    let costs = dashboard::measure(&[used, never]);
    let mut usage_by_entry = usage::UsageByEntry::new();
    usage_by_entry.insert(
        "used-id".into(),
        UsageStats {
            count: 5,
            last_used: Some(jiff::Timestamp::now().to_string()),
        },
    );
    usage_by_entry.insert("never-id".into(), UsageStats::default());

    let candidates = dashboard::prune_candidates(&costs, &usage_by_entry);

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].entry_id, "never-id");
    assert_eq!(candidates[0].reason, PruneReason::NeverUsed);
}

/// Without usage to go on, both signals have to agree — otherwise a small
/// helper nobody has edited in a year gets flagged for no good reason.
#[test]
fn with_no_usage_it_takes_both_large_and_old_to_be_flagged() {
    let fx = Fixture::new();
    let big_old = {
        let mut i = item(
            "big-old",
            ItemType::Skill,
            fx.write("a/SKILL.md", &"x".repeat(9000)),
        );
        i.discovered.modified = Some("2020-01-01T00:00:00Z".into());
        i
    };
    let big_new = {
        let mut i = item(
            "big-new",
            ItemType::Skill,
            fx.write("b/SKILL.md", &"x".repeat(9000)),
        );
        i.discovered.modified = Some(jiff::Timestamp::now().to_string());
        i
    };
    let small_old = {
        let mut i = item("small-old", ItemType::Skill, fx.write("c/SKILL.md", "x"));
        i.discovered.modified = Some("2020-01-01T00:00:00Z".into());
        i
    };

    let costs = dashboard::measure(&[big_old, big_new, small_old]);
    let candidates = dashboard::prune_candidates(&costs, &usage::UsageByEntry::new());

    let names: Vec<&str> = candidates.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["big-old"]);
    assert_eq!(candidates[0].reason, PruneReason::LargeAndOld);
}

// ------------------------------------------------------------------ overlaps

#[test]
fn flags_two_items_with_the_same_name_and_type() {
    let fx = Fixture::new();
    let mut a = item("review", ItemType::Skill, fx.write("a/SKILL.md", "x"));
    let mut b = item("Review", ItemType::Skill, fx.write("b/SKILL.md", "x"));
    a.discovered.entry_id = "a".into();
    b.discovered.entry_id = "b".into();

    let found = dashboard::overlaps(&[a, b]);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].reason, OverlapReason::SameName);
}

#[test]
fn flags_two_items_whose_descriptions_are_much_alike() {
    let fx = Fixture::new();
    let describe = |mut i: ItemMetadata, id: &str, text: &str| {
        i.discovered.entry_id = id.into();
        i.discovered.description = text.into();
        i
    };
    let a = describe(
        item("alpha", ItemType::Skill, fx.write("a/SKILL.md", "x")),
        "a",
        "Reviews pull requests for correctness and style problems",
    );
    let b = describe(
        item("beta", ItemType::Skill, fx.write("b/SKILL.md", "x")),
        "b",
        "Reviews pull requests for style and correctness problems",
    );
    let c = describe(
        item("gamma", ItemType::Skill, fx.write("c/SKILL.md", "x")),
        "c",
        "Generates database migration scripts",
    );

    let found = dashboard::overlaps(&[a, b, c]);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].reason, OverlapReason::SimilarDescription);
    // Their own names are part of the comparison and differ, so this is not
    // 1.0 even though the descriptions say the same thing.
    assert!(found[0].similarity >= 0.75, "got {}", found[0].similarity);
}

/// The same file reached through two paths is one thing, not two competing.
#[test]
fn does_not_flag_one_file_reached_by_two_paths() {
    let fx = Fixture::new();
    let real = fx.write(".agents/skills/shared/SKILL.md", "x");
    let mut a = item(
        "shared",
        ItemType::Skill,
        fx.home().join(".claude/skills/shared/SKILL.md"),
    );
    let mut b = item(
        "shared",
        ItemType::Skill,
        fx.home().join(".cursor/skills/shared/SKILL.md"),
    );
    a.discovered.entry_id = "a".into();
    b.discovered.entry_id = "b".into();
    a.discovered.real_path.clone_from(&real);
    b.discovered.real_path = real;

    assert!(dashboard::overlaps(&[a, b]).is_empty());
}

#[test]
fn the_pair_reads_the_same_whichever_way_round_it_comes() {
    assert_eq!(dashboard::pair_id("b", "a"), dashboard::pair_id("a", "b"));
}

// ----------------------------------------------------------------------- mcp

#[test]
fn reads_servers_out_of_a_json_config() {
    let fx = Fixture::new();
    fx.write(
        ".claude.json",
        r#"{"mcpServers":{"obsidian":{"command":"npx","args":["-y","obsidian-mcp"],"env":{"TOKEN":"secret"}},"docs":{"url":"https://example.invalid/mcp","type":"http"}}}"#,
    );

    let scan = mcp::scan(&[tool("claude-code")], &[], fx.home());
    let find = |name: &str| scan.servers.iter().find(|s| s.name == name).expect("found");

    assert_eq!(scan.servers.len(), 2);
    assert_eq!(find("obsidian").config.command.as_deref(), Some("npx"));
    assert_eq!(find("obsidian").config.args, vec!["-y", "obsidian-mcp"]);
    assert_eq!(
        find("obsidian").config.env.get("TOKEN").map(String::as_str),
        Some("secret")
    );
    assert_eq!(
        find("docs").config.url.as_deref(),
        Some("https://example.invalid/mcp")
    );
    assert_eq!(find("docs").config.transport.as_deref(), Some("http"));
}

#[test]
fn reads_servers_out_of_a_toml_config() {
    let fx = Fixture::new();
    fx.write(
        ".codex/config.toml",
        r#"
model = "gpt-5"

[mcp_servers.github]
command = "gh-mcp"
args = ["--stdio"]

[mcp_servers.github.env]
GITHUB_TOKEN = "secret"

[some_other_table]
irrelevant = true
"#,
    );

    let scan = mcp::scan(&[tool("codex")], &[], fx.home());

    assert_eq!(scan.servers.len(), 1);
    assert_eq!(scan.servers[0].name, "github");
    assert_eq!(scan.servers[0].config.command.as_deref(), Some("gh-mcp"));
    assert_eq!(scan.servers[0].config.env.len(), 1);
}

#[test]
fn honours_a_tools_own_key_for_the_server_map() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.home().join("work/demo"),
    };
    // VS Code names it "servers", not "mcpServers".
    fx.write(
        "work/demo/.vscode/mcp.json",
        r#"{"servers":{"local":{"command":"node"}}}"#,
    );

    let scan = mcp::scan(
        &[tool("copilot")],
        std::slice::from_ref(&project),
        fx.home(),
    );

    assert_eq!(scan.servers.len(), 1);
    assert_eq!(scan.servers[0].name, "local");
    assert_eq!(scan.servers[0].project_id.as_deref(), Some("p1"));
}

/// Knowing a project overrides your global setup is why someone opens this.
#[test]
fn the_same_name_in_two_places_is_two_entries() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.home().join("work/demo"),
    };
    fx.write(
        ".claude.json",
        r#"{"mcpServers":{"obsidian":{"command":"global"}}}"#,
    );
    fx.write(
        "work/demo/.mcp.json",
        r#"{"mcpServers":{"obsidian":{"command":"local"}}}"#,
    );

    let scan = mcp::scan(
        &[tool("claude-code")],
        std::slice::from_ref(&project),
        fx.home(),
    );

    assert_eq!(scan.servers.len(), 2);
    let scopes: Vec<Option<&str>> = scan
        .servers
        .iter()
        .map(|s| s.project_id.as_deref())
        .collect();
    assert!(scopes.contains(&None) && scopes.contains(&Some("p1")));
}

#[test]
fn a_config_that_cannot_be_read_is_reported_rather_than_silently_empty() {
    let fx = Fixture::new();
    fx.write(".claude.json", "{ this is not json");

    let scan = mcp::scan(&[tool("claude-code")], &[], fx.home());

    assert!(scan.servers.is_empty());
    assert_eq!(scan.warnings.len(), 1);
    assert!(scan.warnings[0].message.contains("JSON"));
}

#[test]
fn a_config_with_no_servers_in_it_is_not_a_problem() {
    let fx = Fixture::new();
    fx.write(".claude.json", r#"{"theme":"dark"}"#);

    let scan = mcp::scan(&[tool("claude-code")], &[], fx.home());

    assert!(scan.servers.is_empty());
    assert!(scan.warnings.is_empty());
}

#[test]
fn a_tool_with_no_mcp_configuration_is_simply_skipped() {
    let fx = Fixture::new();
    let scan = mcp::scan(&[tool("cursor")], &[], fx.home());
    assert!(scan.servers.is_empty());
    assert!(scan.warnings.is_empty());
}
