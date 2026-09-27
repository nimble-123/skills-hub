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
