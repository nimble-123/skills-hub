//! Finding skills through a registry that indexes them.
//!
//! [skills.sh](https://skills.sh) is a directory over GitHub: a search result
//! names the repository a skill lives in, not a package of its own. That is
//! what makes it cheap to support — a hit resolves to the same repository,
//! ref, subpath and commit everything downstream already depends on, so
//! installing, diffing and restoring are untouched.
//!
//! It also keeps the property that matters: everything still resolves to a
//! git origin. If the registry goes away, a library built with its help keeps
//! working — only the finding stops.
//!
//! Only the parsing and the URL building live here. The request itself is the
//! adapter layer's job, which is where the application's one other network
//! call already is.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

const SEARCH_ENDPOINT: &str = "https://skills.sh/api/search";

/// What the registry knows about one skill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryHit {
    /// `owner/repo/skill`, as the registry identifies it.
    pub id: String,
    /// The GitHub repository it lives in, as `owner/repo`.
    pub source: String,
    /// Its name within that repository.
    pub name: String,
    /// How many times it has been installed through the registry.
    ///
    /// The only ranking signal on offer, and the reason to consult a registry
    /// rather than search GitHub directly. A `u32` because this crosses into
    /// JavaScript, which has no wider integer — and the busiest skill on the
    /// registry is six figures.
    pub installs: u32,
    /// The repository, as something git can clone.
    pub repo_url: String,
}

/// Where to ask.
#[must_use]
pub fn search_url(query: &str) -> String {
    format!("{SEARCH_ENDPOINT}?q={}", urlencode(query.trim()))
}

/// Reads a search response.
///
/// Unknown fields are ignored and a malformed entry is dropped rather than
/// failing the search: a registry is free to add to its own response, and one
/// bad row is not a reason to show nothing.
pub fn parse_search(body: &str) -> Result<Vec<RegistryHit>> {
    #[derive(Deserialize)]
    struct Response {
        #[serde(default)]
        skills: Vec<Raw>,
    }

    #[derive(Deserialize)]
    struct Raw {
        id: Option<String>,
        source: Option<String>,
        name: Option<String>,
        #[serde(default)]
        installs: u64,
    }

    impl Raw {
        fn installs(&self) -> u32 {
            u32::try_from(self.installs).unwrap_or(u32::MAX)
        }
    }

    let response: Response = serde_json::from_str(body).map_err(|err| CoreError::Registry {
        reason: format!("the registry's answer could not be read: {err}"),
    })?;

    Ok(response
        .skills
        .into_iter()
        .filter_map(|raw| {
            let installs = raw.installs();
            let source = raw.source?;
            let repo_url = repo_url(&source)?;
            Some(RegistryHit {
                id: raw.id.unwrap_or_else(|| source.clone()),
                name: raw.name?,
                installs,
                source,
                repo_url,
            })
        })
        .collect())
}

/// The clone URL for an `owner/repo`, or `None` if it is not one.
///
/// Checked rather than formatted blindly. The result is handed to git, and
/// while a `https://` URL can never be read as a flag, a row naming something
/// GitHub could not host is a row we do not understand — and guessing at what
/// it meant is how a path traversal gets in.
#[must_use]
pub fn repo_url(source: &str) -> Option<String> {
    let mut parts = source.split('/');
    let owner = parts.next().filter(|part| is_safe_segment(part))?;
    let repo = parts.next().filter(|part| is_safe_segment(part))?;
    if parts.next().is_some() {
        return None;
    }
    Some(format!("https://github.com/{owner}/{repo}"))
}

/// What GitHub allows in an owner or repository name, and nothing else.
///
/// Alphanumerics, dash, underscore and dot — and none of those three at the
/// start, which GitHub does not allow either and which is what `..` would
/// arrive as.
fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 100
        && !segment.starts_with(['-', '.', '_'])
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Percent-encodes a query for a URL.
///
/// Hand-rolled rather than pulled in: the only thing being encoded is a search
/// term, and one dependency for one function is a poor trade.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            _ => {
                use std::fmt::Write as _;
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}
