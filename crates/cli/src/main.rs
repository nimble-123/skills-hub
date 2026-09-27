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
  skills-cli tools [--json]     List configured tools and whether their paths exist
  skills-cli scan  [--json]     Scan every tool's global folders and report what is there
  skills-cli rescan <dir>       Run the full pipeline: scan, record into <dir>, prune
  skills-cli toggle <name> on|off [--tool <id>] [--dry-run]
                                Enable or disable a scanned item by name
  skills-cli --help

Options:
  --json    Emit JSON instead of a table
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");

    match args.first().map(String::as_str) {
        Some("tools") => {
            let Some(home) = dirs::home_dir() else {
                eprintln!("error: could not determine your home directory");
                return ExitCode::FAILURE;
            };
            if json {
                print_tools_json(&home);
            } else {
                print_tools_table(&home);
            }
            ExitCode::SUCCESS
        }
        Some("scan") => {
            let Some(home) = dirs::home_dir() else {
                eprintln!("error: could not determine your home directory");
                return ExitCode::FAILURE;
            };
            scan_command(&home, json)
        }
        Some("rescan") => {
            let Some(home) = dirs::home_dir() else {
                eprintln!("error: could not determine your home directory");
                return ExitCode::FAILURE;
            };
            let Some(dir) = args.get(1).filter(|a| !a.starts_with("--")) else {
                eprintln!("error: rescan needs a directory\n");
                print!("{USAGE}");
                return ExitCode::FAILURE;
            };
            rescan_command(&home, Path::new(dir))
        }
        Some("toggle") => {
            let Some(home) = dirs::home_dir() else {
                eprintln!("error: could not determine your home directory");
                return ExitCode::FAILURE;
            };
            let dry_run = args.iter().any(|a| a == "--dry-run");
            let tool_filter = args
                .iter()
                .position(|a| a == "--tool")
                .and_then(|i| args.get(i + 1))
                .map(String::as_str);
            if let (Some(name), Some(state @ ("on" | "off"))) =
                (args.get(1), args.get(2).map(String::as_str))
            {
                toggle_command(&home, name, state == "on", tool_filter, dry_run)
            } else {
                eprintln!("error: toggle needs a name and on|off\n");
                print!("{USAGE}");
                ExitCode::FAILURE
            }
        }
        Some("--help" | "-h") | None => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("error: unknown command {other:?}\n");
            print!("{USAGE}");
            ExitCode::FAILURE
        }
    }
}

fn print_tools_table(home: &Path) {
    let all = tools::default_tools();
    let mut present = 0usize;

    for tool in all {
        let rows = resolved_paths(tool, home);
        let found = rows.iter().filter(|row| row.exists).count();
        if found > 0 {
            present += 1;
        }
        println!("{:<14} {found}/{} present", tool.id, rows.len());
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

fn print_tools_json(home: &Path) {
    let report: Vec<_> = tools::default_tools()
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
