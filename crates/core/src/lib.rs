//! Domain logic for skills-hub.
//!
//! This crate knows nothing about Tauri, about a window, or about a user interface.
//! Everything it touches is either a path it was handed or a value it was given —
//! notably `$HOME`, which is injected rather than read, so the scanner can be
//! exercised against temporary directories.

pub mod dashboard;
pub mod diff;
pub mod discover;
pub mod error;
pub mod frontmatter;
pub mod fsunit;
pub mod git;
pub mod ids;
pub mod install;
pub mod mcp;
pub mod model;
pub mod paths;
pub mod platform;
pub mod projectlink;
pub mod registry;
pub mod rescan;
pub mod scan;
pub mod settings;
pub mod store;
pub mod toggle;
pub mod tools;
pub mod usage;

pub use error::{CoreError, Result};
pub use model::{ItemType, ToolConfig};
