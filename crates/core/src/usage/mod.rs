//! How often each item has actually been used.
//!
//! Read from the session transcripts the tools already keep on disk. Nothing
//! is sent anywhere and nothing new is recorded: this is the tools' own
//! history, read back.
//!
//! Only skills and agents leave a trace. A slash command expands into message
//! text with no distinct event, and a rule is never invoked at all — it is
//! simply part of the context. Those are absent by construction rather than
//! filtered out, which is worth saying where the numbers are shown.

pub mod claude;
pub mod codex;

use std::collections::HashMap;

use serde::Serialize;

use crate::model::{ItemMetadata, ItemType};

/// After this long without being used, an item is worth a second look.
pub const STALE_DAYS: i64 = 30;

/// How often one thing was used, and when it last was.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub count: u32,
    /// RFC 3339, or `None` if it has never been used.
    pub last_used: Option<String>,
}

impl UsageStats {
    fn record(&mut self, when: Option<&str>) {
        self.count += 1;
        // All-time, never windowed: a real invocation from a year ago is
        // still a fact, and hiding it would make a rarely-used item look
        // like one that has never been touched.
        if let Some(when) = when
            && self
                .last_used
                .as_deref()
                .is_none_or(|current| current < when)
        {
            self.last_used = Some(when.to_owned());
        }
    }
}

/// What a transcript scan found, keyed by how the tool refers to the thing.
pub type RawUsage = HashMap<String, UsageStats>;

/// Usage per item, for the items a tool actually records.
pub type UsageByEntry = HashMap<String, UsageStats>;

/// How a tool names a skill or agent when it invokes one.
///
/// An item from a plugin bundle is invoked as `<plugin>:<name>`, and the
/// plugin id carries its marketplace after an `@` that the invocation does
/// not use.
#[must_use]
pub fn invocation_key(item: &ItemMetadata) -> String {
    let kind = match item.discovered.item_type {
        ItemType::Skill => "skill",
        ItemType::Agent => "agent",
        other => return format!("{other}:{}", item.discovered.name),
    };

    match &item.discovered.plugin_id {
        Some(plugin_id) => {
            let plugin = plugin_id.split('@').next().unwrap_or(plugin_id);
            format!("{kind}:{plugin}:{}", item.discovered.name)
        }
        None => format!("{kind}:{}", item.discovered.name),
    }
}

/// Joins what a transcript recorded onto the items it belongs to.
///
/// Two items with the same name — the same skill linked into several places —
/// deliberately get the same figures: the transcript records which skill ran,
/// not which copy of it.
#[must_use]
pub fn join(items: &[ItemMetadata], raw: &RawUsage, tool_id: &str) -> UsageByEntry {
    items
        .iter()
        .filter(|item| item.discovered.tool == tool_id)
        .filter(|item| matches!(item.discovered.item_type, ItemType::Skill | ItemType::Agent))
        .map(|item| {
            let stats = raw.get(&invocation_key(item)).cloned().unwrap_or_default();
            (item.discovered.entry_id.clone(), stats)
        })
        .collect()
}

/// Items worth a second look, least recently used first.
///
/// No size threshold: something that has never fired is worth looking at
/// whatever it weighs, and this is a suggestion rather than a verdict.
#[must_use]
pub fn stale_entries(usage: &UsageByEntry, now: &str, stale_days: i64) -> Vec<String> {
    let cutoff = jiff::Timestamp::now()
        .checked_sub(jiff::SignedDuration::from_hours(stale_days * 24))
        .ok()
        .map(|t| t.to_string())
        .unwrap_or_default();
    let _ = now;

    let mut stale: Vec<(&String, &UsageStats)> = usage
        .iter()
        .filter(|(_, stats)| match &stats.last_used {
            None => true,
            Some(last) => last.as_str() < cutoff.as_str(),
        })
        .collect();

    // Never used first, then oldest first.
    stale.sort_by(|a, b| a.1.last_used.cmp(&b.1.last_used));
    stale.into_iter().map(|(id, _)| id.clone()).collect()
}
