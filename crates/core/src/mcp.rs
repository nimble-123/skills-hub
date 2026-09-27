//! Which MCP servers each tool is configured with.
//!
//! Read-only, and deliberately so. These are the tools' own configuration
//! files, written in their own formats, and editing them from here would mean
//! understanding each tool's schema well enough to not corrupt it. Showing
//! what is there — and where — is the useful part; changing it is a click
//! away in the file itself.
//!
//! A server defined both globally and in a project appears twice. That is not
//! a duplicate to collapse: knowing a project overrides your global setup is
//! exactly why someone opens this page.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::{McpConfigFormat, ProjectWorkspace, ScanWarning, ScanWarningKind, ToolConfig};
use crate::paths;

/// How a server is started, or where it is reached.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct McpServerConfig {
    pub command: Option<String>,
    pub args: Vec<String>,
    /// Environment, often holding a token — never shown unmasked by default.
    pub env: BTreeMap<String, String>,
    pub url: Option<String>,
    #[serde(rename = "type")]
    pub transport: Option<String>,
}

/// One configured server, and where that configuration lives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub tool: String,
    /// `None` is the global scope.
    pub project_id: Option<String>,
    pub config: McpServerConfig,
    pub source_path: PathBuf,
}

/// What a sweep of every tool's configuration found.
#[derive(Debug, Default)]
pub struct McpScan {
    pub servers: Vec<McpServer>,
    pub warnings: Vec<ScanWarning>,
}

/// Every server every tool is configured with, global and per project.
#[must_use]
pub fn scan(tools: &[ToolConfig], projects: &[ProjectWorkspace], home: &Path) -> McpScan {
    let mut scan = McpScan::default();

    for tool in tools {
        if let Some(raw) = &tool.mcp_config_path {
            let path = paths::expand_home(raw, home);
            read_into(&mut scan, tool, &path, None);
        }
        let Some(raw) = &tool.project_mcp_config_path else {
            continue;
        };
        for project in projects {
            let path = project.path.join(raw);
            read_into(&mut scan, tool, &path, Some(project));
        }
    }

    scan.servers
        .sort_by(|a, b| a.name.cmp(&b.name).then(a.tool.cmp(&b.tool)));
    scan
}

fn read_into(
    scan: &mut McpScan,
    tool: &ToolConfig,
    path: &Path,
    project: Option<&ProjectWorkspace>,
) {
    if !path.is_file() {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };

    let parsed = match tool.mcp_config_format {
        McpConfigFormat::Json => from_json(&raw, tool.mcp_config_key.as_deref()),
        McpConfigFormat::Toml => from_toml(&raw, tool.mcp_config_key.as_deref()),
    };

    let servers = match parsed {
        Ok(servers) => servers,
        Err(message) => {
            // Worth saying rather than swallowing: an unreadable config is a
            // reason the page looks empty, and the user can fix it.
            scan.warnings.push(ScanWarning {
                path: path.to_path_buf(),
                tool: Some(tool.id.clone()),
                message,
                kind: ScanWarningKind::Malformed,
            });
            return;
        }
    };

    for (name, config) in servers {
        scan.servers.push(McpServer {
            id: format!(
                "{}:{}:{}",
                tool.id,
                project.map_or("global", |p| p.id.as_str()),
                name
            ),
            name,
            tool: tool.id.clone(),
            project_id: project.map(|p| p.id.clone()),
            config,
            source_path: path.to_path_buf(),
        });
    }
}

/// The default key holding the server map in each format.
fn default_key(format: McpConfigFormat) -> &'static str {
    match format {
        McpConfigFormat::Json => "mcpServers",
        McpConfigFormat::Toml => "mcp_servers",
    }
}

fn from_json(
    raw: &str,
    key: Option<&str>,
) -> std::result::Result<Vec<(String, McpServerConfig)>, String> {
    let document: serde_json::Value =
        serde_json::from_str(raw).map_err(|err| format!("not valid JSON: {err}"))?;

    let key = key.unwrap_or_else(|| default_key(McpConfigFormat::Json));
    let Some(map) = document.get(key).and_then(serde_json::Value::as_object) else {
        // A file with no server map is not malformed, it just has none.
        return Ok(Vec::new());
    };

    Ok(map
        .iter()
        .filter_map(|(name, value)| {
            let config = serde_json::from_value(value.clone()).ok()?;
            Some((name.clone(), config))
        })
        .collect())
}

/// Reads `[mcp_servers.NAME]` tables out of a TOML file.
///
/// With a real TOML parser. The Obsidian plugin scanned lines because it had
/// no TOML dependency available, which meant no multi-line values and no
/// nested tables. One caveat comes with doing it properly: a real parser
/// rejects the whole file over one syntax error, where the line scanner
/// degraded — hence the warning rather than silence.
fn from_toml(
    raw: &str,
    key: Option<&str>,
) -> std::result::Result<Vec<(String, McpServerConfig)>, String> {
    let document: toml::Value =
        toml::from_str(raw).map_err(|err| format!("not valid TOML: {err}"))?;

    let key = key.unwrap_or_else(|| default_key(McpConfigFormat::Toml));
    let Some(table) = document.get(key).and_then(toml::Value::as_table) else {
        return Ok(Vec::new());
    };

    Ok(table
        .iter()
        .filter_map(|(name, value)| {
            let config = value.clone().try_into().ok()?;
            Some((name.clone(), config))
        })
        .collect())
}
