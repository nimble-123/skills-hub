//! Developer harness.
//!
//! Drives the same domain code the application does, from a terminal, so the
//! scanner can be checked against real folders with `jq` and `ls` long before
//! there is a user interface to look at. It also keeps the layering honest: this
//! binary links `skills-core` and nothing else.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use skills_core::model::{ItemType, ToolConfig};
use skills_core::{paths, tools};

const USAGE: &str = "\
skills-cli — developer harness for skills-hub

Usage:
  skills-cli tools [--json] [--settings <file>]
                                List configured tools and whether their paths exist
  skills-cli scan  [--json]     Scan every tool's global folders and report what is there
  skills-cli rescan <dir>       Run the full pipeline: scan, record into <dir>, prune
  skills-cli toggle <name> on|off [--tool <id>] [--dry-run]
                                Enable or disable a scanned item by name
  skills-cli discover <url> [--ref <r>] [--subpath <p>]
                                Clone a repository and list what is installable
  skills-cli usage <tool>       Read a tool's own session history
  skills-cli mcp                List every configured MCP server
  skills-cli --help

Options:
  --json              Emit JSON instead of a table
  --settings <file>   Apply a settings file's tool overrides, as the
                      application would. Without it the shipped registry
                      is used as-is.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&args) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

/// Runs one command. Returning an error here prints it and exits non-zero, so
/// no branch has to remember to do both.
fn dispatch(args: &[String]) -> Result<ExitCode, String> {
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    };
    let positional = |index: usize| {
        args.get(index)
            .map(String::as_str)
            .filter(|a| !a.starts_with("--"))
    };
    let json = args.iter().any(|a| a == "--json");

    match args.first().map(String::as_str) {
        Some("tools") => {
            let home = home()?;
            let all_tools = load_tools(flag("--settings"))?;
            if json {
                print_tools_json(&all_tools, &home);
            } else {
                print_tools_table(&all_tools, &home);
            }
            Ok(ExitCode::SUCCESS)
        }
        Some("scan") => Ok(scan_command(&home()?, json)),
        Some("rescan") => {
            let dir = positional(1).ok_or("rescan needs a directory")?;
            Ok(rescan_command(&home()?, Path::new(dir)))
        }
        Some("toggle") => {
            let name = positional(1).ok_or("toggle needs a name")?;
            let state = positional(2).ok_or("toggle needs on or off")?;
            if state != "on" && state != "off" {
                return Err("toggle needs on or off".to_owned());
            }
            Ok(toggle_command(
                &home()?,
                name,
                state == "on",
                flag("--tool"),
                args.iter().any(|a| a == "--dry-run"),
            ))
        }
        Some("discover") => {
            let url = positional(1).ok_or("discover needs a repository URL")?;
            Ok(discover_command(
                url,
                flag("--ref").unwrap_or(""),
                flag("--subpath").unwrap_or(""),
            ))
        }
        Some("usage") => Ok(usage_command(
            &home()?,
            positional(1).unwrap_or("claude-code"),
        )),
        Some("mcp") => Ok(mcp_command(&home()?)),
        Some("--help" | "-h") | None => {
            print!("{USAGE}");
            Ok(ExitCode::SUCCESS)
        }
        Some(other) => {
            eprintln!("error: unknown command {other:?}\n");
            print!("{USAGE}");
            Ok(ExitCode::FAILURE)
        }
    }
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "could not determine your home directory".to_owned())
}

/// The registry, with a settings file's overrides applied if one is given.
///
/// The same merge the application does, so the harness can be used to check
/// that an override lands where it should.
fn load_tools(settings_path: Option<&str>) -> Result<Vec<ToolConfig>, String> {
    use skills_core::settings::{AppSettings, effective_tools};

    let Some(path) = settings_path else {
        return Ok(tools::default_tools().to_vec());
    };
    let raw = std::fs::read_to_string(path).map_err(|err| format!("{path}: {err}"))?;
    let settings: AppSettings =
        serde_json::from_str(&raw).map_err(|err| format!("{path}: {err}"))?;

    Ok(effective_tools(tools::default_tools(), &settings))
}

fn print_tools_table(all: &[ToolConfig], home: &Path) {
    let mut present = 0usize;

    for tool in all {
        let rows = resolved_paths(tool, home);
        let found = rows.iter().filter(|row| row.exists).count();
        if found > 0 {
            present += 1;
        }
        let hidden = if tool.disabled { "  (hidden)" } else { "" };
        println!("{:<14} {found}/{} present{hidden}", tool.id, rows.len());
        for row in rows {
            let mark = if row.exists { "+" } else { "-" };
            println!(
                "  {mark} {:<8} {}",
                row.item_type.as_str(),
                row.path.display()
            );
        }
    }
    println!(
        "\n{}/{} tools have at least one path on disk",
        present,
        all.len()
    );
}

fn print_tools_json(all: &[ToolConfig], home: &Path) {
    let report: Vec<_> = all
        .iter()
        .map(|tool| {
            serde_json::json!({
                "id": tool.id,
                "paths": resolved_paths(tool, home)
                    .into_iter()
                    .map(|row| serde_json::json!({
                        "type": row.item_type.as_str(),
                        "path": row.path,
                        "exists": row.exists,
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();

    match serde_json::to_string_pretty(&report) {
        Ok(text) => println!("{text}"),
        Err(err) => eprintln!("error: could not serialise report: {err}"),
    }
}

fn scan_command(home: &Path, json: bool) -> ExitCode {
    let started = std::time::Instant::now();
    let outcome = skills_core::scan::scan_all_tools(tools::default_tools(), home);
    let elapsed = started.elapsed();

    if json {
        match serde_json::to_string_pretty(&outcome.items) {
            Ok(text) => println!("{text}"),
            Err(err) => {
                eprintln!("error: could not serialise items: {err}");
                return ExitCode::FAILURE;
            }
        }
        return ExitCode::SUCCESS;
    }

    for item in &outcome.items {
        let state = if item.enabled { "on " } else { "off" };
        let link = if item.real_path == item.source_path {
            String::new()
        } else {
            format!("  -> {}", item.real_path.display())
        };
        println!(
            "{state} {:<12} {:<8} {:<34} {}{link}",
            item.tool,
            item.item_type.as_str(),
            item.name,
            item.source_path.display()
        );
    }

    let plugin_scan = skills_core::scan::scan_all_plugins(tools::default_tools(), home);
    for plugin in &plugin_scan.plugins {
        let state = if plugin.enabled { "on " } else { "off" };
        let group = plugin.group.as_deref().unwrap_or("-");
        println!(
            "{state} plugin       {:<12} {:<26} {group}",
            plugin.tool_id, plugin.name
        );
    }
    for item in &plugin_scan.items {
        let state = if item.enabled { "on " } else { "off" };
        println!(
            "{state} {:<12} {:<8} {:<34} (plugin {})",
            item.tool,
            item.item_type.as_str(),
            item.name,
            item.plugin_id.as_deref().unwrap_or("?")
        );
    }

    let broken = skills_core::scan::scan_broken_symlinks(tools::default_tools(), &[], home);
    for link in &broken {
        println!(
            "!!  broken link  {:<12} {} -> {}",
            link.tool,
            link.path.display(),
            link.target
        );
    }

    for warning in &outcome.warnings {
        eprintln!("warning: {} ({})", warning.path.display(), warning.message);
    }

    println!(
        "\n{} items, {} plugin bundles ({} items), {} broken links, {} warnings, in {:.0} ms",
        outcome.items.len(),
        plugin_scan.plugins.len(),
        plugin_scan.items.len(),
        broken.len(),
        outcome.warnings.len(),
        elapsed.as_secs_f64() * 1000.0
    );
    ExitCode::SUCCESS
}

/// Runs the pipeline the application runs, against real folders.
fn rescan_command(home: &Path, dir: &Path) -> ExitCode {
    use skills_core::rescan::{Progress, RescanInput, RescanOptions, perform_rescan};
    use skills_core::settings::{AppSettings, effective_tools};

    let store = match skills_core::store::MetaStore::open(dir) {
        Ok(store) => store,
        Err(err) => {
            eprintln!("error: {err}");
            return ExitCode::FAILURE;
        }
    };
    let settings = AppSettings::default();
    let all_tools = effective_tools(tools::default_tools(), &settings);

    let started = std::time::Instant::now();
    let snapshot = perform_rescan(
        RescanInput {
            tools: &all_tools,
            projects: &settings.project_workspaces,
            home,
            store: &store,
        },
        RescanOptions::default(),
        1,
        &|progress| {
            if let Progress::Recording { done, total } = progress {
                eprint!("\rrecording {done}/{total}");
            }
        },
    );
    eprintln!();

    let snapshot = match snapshot {
        Ok(snapshot) => snapshot,
        Err(err) => {
            eprintln!("error: {err}");
            return ExitCode::FAILURE;
        }
    };

    println!(
        "{} items, {} plugin bundles, {} broken links, {} warnings, {} orphaned notes, in {:.0} ms",
        snapshot.items.len(),
        snapshot.plugins.len(),
        snapshot.broken_symlinks.len(),
        snapshot.warnings.len(),
        snapshot.orphan_count,
        started.elapsed().as_secs_f64() * 1000.0
    );
    for warning in &snapshot.warnings {
        eprintln!("warning: {} ({})", warning.path.display(), warning.message);
    }
    println!("notes in {}", store.root().display());
    ExitCode::SUCCESS
}

/// Enables or disables one item, by the name the scanner reports.
///
/// `--dry-run` prints what would move without touching anything, which is the
/// only responsible way to try this against a real skills folder.
fn toggle_command(
    home: &Path,
    name: &str,
    enabled: bool,
    tool_filter: Option<&str>,
    dry_run: bool,
) -> ExitCode {
    let outcome = skills_core::scan::scan_all_tools(tools::default_tools(), home);
    let matches: Vec<_> = outcome
        .items
        .into_iter()
        .filter(|item| item.name == name)
        .filter(|item| tool_filter.is_none_or(|tool| item.tool == tool))
        .collect();

    let [found] = matches.as_slice() else {
        if matches.is_empty() {
            eprintln!("error: nothing scanned is called {name:?}");
        } else {
            eprintln!("error: {} items are called {name:?}:", matches.len());
            for item in &matches {
                eprintln!("  {} {}", item.tool, item.source_path.display());
            }
            eprintln!("(narrow it down with --tool <id>)");
        }
        return ExitCode::FAILURE;
    };

    let unit = skills_core::fsunit::linkable_unit(&found.source_path);
    let verb = if enabled { "enable" } else { "disable" };
    println!("{verb}: {}", unit.path.display());
    if let Ok(target) = std::fs::read_link(&unit.path) {
        println!("  it is a symlink to {}", target.display());
        println!("  it will be re-created with an absolute target at the new location");
    }

    if dry_run {
        println!("  (dry run: nothing was changed)");
        return ExitCode::SUCCESS;
    }

    let metadata = skills_core::model::ItemMetadata {
        discovered: found.clone(),
        tags: Vec::new(),
        favorite: false,
        collections: Vec::new(),
        source: skills_core::model::InstallSource::default(),
    };
    match skills_core::toggle::set_item_enabled(&metadata, enabled) {
        Ok(path) => {
            println!("  now at {}", path.display());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Clones a repository and reports what could be installed from it.
fn discover_command(url: &str, ref_name: &str, subpath: &str) -> ExitCode {
    let started = std::time::Instant::now();
    let result = skills_core::discover::discover(
        &skills_core::git::SystemGit,
        url,
        ref_name,
        subpath,
        "1970-01-01T00:00:00Z",
    );

    match result {
        Ok((source, entries)) => {
            println!("{} items in {}", entries.len(), source.repo_url);
            for entry in &entries {
                println!(
                    "  {:<8} {:<34} {}",
                    entry.item_type.as_str(),
                    entry.name,
                    entry.subpath
                );
            }
            println!("\nin {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Reads a tool's own history and reports what has actually been used.
fn usage_command(home: &Path, tool_id: &str) -> ExitCode {
    use skills_core::usage;

    let started = std::time::Instant::now();
    let report = |done: u32, total: u32| {
        if done == total {
            eprintln!("read {total} files");
        }
    };

    let raw = match tool_id {
        "claude-code" => usage::claude::scan(home, &report),
        "codex" => {
            let outcome = skills_core::scan::scan_all_tools(tools::default_tools(), home);
            let items: Vec<_> = outcome
                .items
                .into_iter()
                .map(|discovered| skills_core::model::ItemMetadata {
                    discovered,
                    tags: Vec::new(),
                    favorite: false,
                    collections: Vec::new(),
                    source: skills_core::model::InstallSource::default(),
                })
                .collect();
            usage::codex::scan(home, &usage::codex::needles(&items), &report)
        }
        other => {
            eprintln!("error: {other} keeps no history this application can read");
            return ExitCode::FAILURE;
        }
    };

    let mut rows: Vec<_> = raw.into_iter().collect();
    rows.sort_by(|a, b| b.1.count.cmp(&a.1.count));

    for (key, stats) in rows.iter().take(25) {
        println!(
            "{:>5}  {:<40} last {}",
            stats.count,
            key,
            stats.last_used.as_deref().unwrap_or("never")
        );
    }
    println!(
        "\n{} distinct, in {:.0} ms",
        rows.len(),
        started.elapsed().as_secs_f64() * 1000.0
    );
    ExitCode::SUCCESS
}

/// Lists every MCP server every tool is configured with.
fn mcp_command(home: &Path) -> ExitCode {
    let scan = skills_core::mcp::scan(tools::default_tools(), &[], home);

    for server in &scan.servers {
        let how = server.config.url.clone().unwrap_or_else(|| {
            let mut parts = vec![server.config.command.clone().unwrap_or_default()];
            parts.extend(server.config.args.clone());
            parts.join(" ")
        });
        println!("{:<14} {:<22} {}", server.tool, server.name, how.trim());
        if !server.config.env.is_empty() {
            let keys: Vec<&str> = server.config.env.keys().map(String::as_str).collect();
            println!("{:<14} {:<22} env: {}", "", "", keys.join(", "));
        }
    }
    for warning in &scan.warnings {
        eprintln!("warning: {} ({})", warning.path.display(), warning.message);
    }
    println!(
        "\n{} servers, {} warnings",
        scan.servers.len(),
        scan.warnings.len()
    );
    ExitCode::SUCCESS
}

struct ResolvedPath {
    item_type: ItemType,
    path: PathBuf,
    exists: bool,
}

fn resolved_paths(tool: &ToolConfig, home: &Path) -> Vec<ResolvedPath> {
    ItemType::ALL
        .into_iter()
        .filter_map(|item_type| {
            let path = paths::resolve_tool_dir(tool, item_type, None, home)?;
            let exists = path.exists();
            Some(ResolvedPath {
                item_type,
                path,
                exists,
            })
        })
        .collect()
}
