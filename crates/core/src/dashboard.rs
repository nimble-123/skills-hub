//! What the library costs, and what is probably not earning its place.
//!
//! Everything here is measured in characters and only turned into tokens
//! where it is shown. Four characters to a token is an approximation, not a
//! tokeniser, and the number exists to compare items against each other
//! rather than to predict a bill.
//!
//! The distinction that matters is between what a tool has available before
//! anything is invoked — an item's name and description, which it carries
//! every turn so the model knows the item exists — and what it loads when the
//! item is actually invoked. Only the first is a standing cost.
//!
//! Commands and rules are deliberately left without a context figure. How and
//! when each tool loads them is not modelled here, and calling a file's size
//! a per-turn cost would be more misleading than saying nothing.

use std::collections::HashMap;

use serde::Serialize;

use crate::model::{ItemMetadata, ItemType};
use crate::{frontmatter, usage};

/// A file bigger than this share of the library is "large" for pruning.
const SIZE_PERCENTILE: f64 = 0.75;

/// Untouched for this long, and large, and it is worth a second look.
///
/// Longer than the usage threshold, because a date on a file is a far weaker
/// signal than a record of the thing having run.
pub const STALE_FILE_DAYS: i64 = 90;

/// Two items this similar are probably competing for the same request.
const OVERLAP_THRESHOLD: f64 = 0.4;

/// What one item costs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemCost {
    pub entry_id: String,
    pub name: String,
    pub tool: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    /// The whole file.
    pub source_chars: u32,
    /// Name and description: what a tool carries every turn.
    ///
    /// `None` for commands and rules, whose loading is not modelled.
    pub available_chars: Option<u32>,
    /// The instructions loaded once the item is invoked.
    pub invocation_chars: Option<u32>,
    /// When the file was last written.
    pub modified: Option<String>,
}

/// A suggestion, and why it is being made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PruneCandidate {
    pub entry_id: String,
    pub name: String,
    pub tool: String,
    pub reason: PruneReason,
    pub source_chars: u32,
    pub last_used: Option<String>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum PruneReason {
    /// The tool's own history says it has never run.
    NeverUsed,
    /// It has run, but not for a long time.
    NotUsedLately,
    /// No usage to go on, so: large and long untouched.
    LargeAndOld,
}

/// Two items that look like they are after the same request.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub a: String,
    pub b: String,
    pub a_name: String,
    pub b_name: String,
    /// Stable across the pair, whichever order they come in.
    pub pair_id: String,
    pub reason: OverlapReason,
    /// How alike their descriptions are, from 0 to 1.
    pub similarity: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum OverlapReason {
    /// The same name and type: an outright collision.
    SameName,
    /// Descriptions alike enough to compete.
    SimilarDescription,
}

/// Everything the dashboard shows.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DashboardReport {
    pub costs: Vec<ItemCost>,
    pub prune: Vec<PruneCandidate>,
    pub overlaps: Vec<Overlap>,
    /// Totals across everything enabled.
    pub total_source_chars: u32,
    pub total_available_chars: u32,
    pub total_invocation_chars: u32,
}

/// Measures every enabled item.
///
/// Only enabled ones: a disabled item costs nothing, which is the point of
/// being able to disable it.
#[must_use]
pub fn measure(items: &[ItemMetadata]) -> Vec<ItemCost> {
    items
        .iter()
        .filter(|item| item.discovered.enabled)
        .filter_map(|item| {
            let content = std::fs::read_to_string(&item.discovered.source_path).ok()?;
            let modelled = matches!(item.discovered.item_type, ItemType::Skill | ItemType::Agent);

            Some(ItemCost {
                entry_id: item.discovered.entry_id.clone(),
                name: item.discovered.name.clone(),
                tool: item.discovered.tool.clone(),
                item_type: item.discovered.item_type,
                source_chars: count(content.chars().count()),
                available_chars: modelled.then(|| {
                    count(
                        item.discovered.name.chars().count()
                            + item.discovered.description.chars().count()
                            + 1,
                    )
                }),
                invocation_chars: modelled
                    .then(|| count(frontmatter::strip(&content).chars().count())),
                modified: item.discovered.modified.clone(),
            })
        })
        .collect()
}

/// Puts the whole report together.
#[must_use]
pub fn report(
    items: &[ItemMetadata],
    usage_by_entry: &usage::UsageByEntry,
    disregarded: &[String],
) -> DashboardReport {
    let costs = measure(items);
    let ignored: std::collections::HashSet<&str> = disregarded.iter().map(String::as_str).collect();

    let mut report = DashboardReport {
        total_source_chars: costs.iter().map(|cost| cost.source_chars).sum(),
        total_available_chars: costs.iter().filter_map(|cost| cost.available_chars).sum(),
        total_invocation_chars: costs.iter().filter_map(|cost| cost.invocation_chars).sum(),
        prune: prune_candidates(&costs, usage_by_entry)
            .into_iter()
            .filter(|candidate| !ignored.contains(candidate.entry_id.as_str()))
            .collect(),
        overlaps: overlaps(items)
            .into_iter()
            .filter(|overlap| !ignored.contains(overlap.pair_id.as_str()))
            .collect(),
        costs,
    };

    report
        .costs
        .sort_by(|a, b| b.source_chars.cmp(&a.source_chars));
    report
}

/// What is probably not earning its place.
///
/// Where a tool records usage, that is what is used — it is a fact rather
/// than a proxy. Where it does not, an item is flagged only if it is both
/// large for this library and long untouched, so a small helper nobody has
/// edited in a year is left alone.
#[must_use]
pub fn prune_candidates(
    costs: &[ItemCost],
    usage_by_entry: &usage::UsageByEntry,
) -> Vec<PruneCandidate> {
    let threshold = size_threshold(costs);
    let stale_before = ago(usage::STALE_DAYS);
    let old_before = ago(STALE_FILE_DAYS);

    let mut candidates: Vec<PruneCandidate> = costs
        .iter()
        .filter_map(|cost| {
            let stats = usage_by_entry.get(&cost.entry_id);

            let reason = if let Some(stats) = stats {
                // A record of the thing having run is a fact, not a proxy,
                // so where there is one it decides on its own.
                match &stats.last_used {
                    None => PruneReason::NeverUsed,
                    Some(last) if last.as_str() < stale_before.as_str() => {
                        PruneReason::NotUsedLately
                    }
                    Some(_) => return None,
                }
            } else {
                // Nothing to go on, so both signals have to agree: large for
                // this library, and long untouched.
                let large = cost.source_chars >= threshold;
                let old = cost
                    .modified
                    .as_deref()
                    .is_some_and(|when| when < old_before.as_str());
                if !(large && old) {
                    return None;
                }
                PruneReason::LargeAndOld
            };

            Some(PruneCandidate {
                entry_id: cost.entry_id.clone(),
                name: cost.name.clone(),
                tool: cost.tool.clone(),
                reason,
                source_chars: cost.source_chars,
                last_used: stats.and_then(|stats| stats.last_used.clone()),
                modified: cost.modified.clone(),
            })
        })
        .collect();

    // Never used first, then least recently used, then largest.
    candidates.sort_by(|a, b| {
        a.last_used
            .cmp(&b.last_used)
            .then(b.source_chars.cmp(&a.source_chars))
    });
    candidates
}

/// Pairs of enabled items that look like they are after the same request.
#[must_use]
pub fn overlaps(items: &[ItemMetadata]) -> Vec<Overlap> {
    let enabled: Vec<&ItemMetadata> = items
        .iter()
        .filter(|item| item.discovered.enabled)
        // A single instructions file has no declared name, so every copy of
        // one would collide with every other on filename alone.
        .filter(|item| item.discovered.item_type != ItemType::Rule)
        .collect();

    let words: Vec<std::collections::HashSet<String>> =
        enabled.iter().map(|item| word_set(item)).collect();

    let mut found = Vec::new();
    for (i, left) in enabled.iter().enumerate() {
        for (j, right) in enabled.iter().enumerate().skip(i + 1) {
            // The same file reached by two paths is not two things.
            if left.discovered.real_path == right.discovered.real_path {
                continue;
            }

            let same_name = left.discovered.item_type == right.discovered.item_type
                && left
                    .discovered
                    .name
                    .trim()
                    .eq_ignore_ascii_case(right.discovered.name.trim());
            let similarity = jaccard(&words[i], &words[j]);

            if !same_name && similarity < OVERLAP_THRESHOLD {
                continue;
            }

            found.push(Overlap {
                a: left.discovered.entry_id.clone(),
                b: right.discovered.entry_id.clone(),
                a_name: left.discovered.name.clone(),
                b_name: right.discovered.name.clone(),
                pair_id: pair_id(&left.discovered.entry_id, &right.discovered.entry_id),
                reason: if same_name {
                    OverlapReason::SameName
                } else {
                    OverlapReason::SimilarDescription
                },
                similarity,
            });
        }
    }

    // An outright name collision first, then the most alike.
    found.sort_by(|a, b| {
        a.reason
            .cmp_priority(b.reason)
            .then(b.similarity.total_cmp(&a.similarity))
    });
    found
}

impl OverlapReason {
    fn cmp_priority(self, other: Self) -> std::cmp::Ordering {
        let rank = |reason: Self| match reason {
            Self::SameName => 0,
            Self::SimilarDescription => 1,
        };
        rank(self).cmp(&rank(other))
    }
}

/// The same identifier whichever way round the pair comes.
#[must_use]
pub fn pair_id(a: &str, b: &str) -> String {
    let (first, second) = if a <= b { (a, b) } else { (b, a) };
    format!("{first}::{second}")
}

/// Words worth comparing, from an item's name and description.
///
/// Anything shorter than three characters is dropped: "a", "of" and "to"
/// appear in everything and would make every pair look alike.
fn word_set(item: &ItemMetadata) -> std::collections::HashSet<String> {
    format!("{} {}", item.discovered.name, item.discovered.description)
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| word.len() >= 3)
        .map(ToOwned::to_owned)
        .collect()
}

fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let shared = a.intersection(b).count();
    let total = a.union(b).count();
    if total == 0 {
        return 0.0;
    }
    #[allow(clippy::cast_precision_loss)]
    {
        shared as f64 / total as f64
    }
}

/// The size above which a file counts as large *for this library*.
///
/// A percentile rather than a fixed number of bytes: what counts as a big
/// skill depends entirely on what else is in the library.
fn size_threshold(costs: &[ItemCost]) -> u32 {
    if costs.is_empty() {
        return u32::MAX;
    }
    let mut sizes: Vec<u32> = costs.iter().map(|cost| cost.source_chars).collect();
    sizes.sort_unstable();

    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    let index = ((sizes.len() as f64) * SIZE_PERCENTILE) as usize;
    sizes[index.min(sizes.len() - 1)]
}

fn ago(days: i64) -> String {
    jiff::Timestamp::now()
        .checked_sub(jiff::SignedDuration::from_hours(days * 24))
        .map(|then| then.to_string())
        .unwrap_or_default()
}

fn count(chars: usize) -> u32 {
    u32::try_from(chars).unwrap_or(u32::MAX)
}

/// Suggestions the user has waved away, and when.
///
/// Kept apart from the settings: these are not configuration, they are a
/// record of decisions about individual items that will be irrelevant the
/// moment those items change.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct Dismissals {
    /// Entry ids and pair ids alike, each with when it was dismissed.
    pub disregarded: HashMap<String, String>,
}

impl Dismissals {
    #[must_use]
    pub fn ids(&self) -> Vec<String> {
        self.disregarded.keys().cloned().collect()
    }
}

/// Reads and writes dismissals as one JSON file.
///
/// Kept apart from the settings for the same reason the catalogue is: these
/// are a record of decisions about individual items, not configuration, and
/// they will be irrelevant the moment those items change.
#[derive(Debug, Clone)]
pub struct DismissalsFile {
    path: std::path::PathBuf,
}

impl DismissalsFile {
    #[must_use]
    pub fn new(config_dir: impl AsRef<std::path::Path>) -> Self {
        Self {
            path: config_dir.as_ref().join("dismissals.json"),
        }
    }

    #[must_use]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// Loads them, or starts empty.
    ///
    /// Losing these means a few suggestions reappear, which is a nuisance and
    /// not a loss.
    #[must_use]
    pub fn load(&self) -> Dismissals {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dismissals: &Dismissals) -> crate::error::Result<()> {
        use std::io::Write as _;

        let dir = self.path.parent().ok_or_else(|| {
            crate::error::CoreError::io(&self.path, std::io::Error::other("no parent directory"))
        })?;
        std::fs::create_dir_all(dir).map_err(|err| crate::error::CoreError::io(dir, err))?;

        let json = serde_json::to_string_pretty(dismissals)
            .map_err(|err| crate::error::CoreError::io(&self.path, std::io::Error::other(err)))?;

        let mut temp = tempfile::NamedTempFile::new_in(dir)
            .map_err(|err| crate::error::CoreError::io(dir, err))?;
        temp.write_all(json.as_bytes())
            .and_then(|()| temp.write_all(b"\n"))
            .and_then(|()| temp.as_file().sync_all())
            .map_err(|err| crate::error::CoreError::io(&self.path, err))?;
        temp.persist(&self.path)
            .map_err(|err| crate::error::CoreError::io(&self.path, err.error))?;
        Ok(())
    }
}
