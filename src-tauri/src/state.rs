//! What the application holds on to between commands.
//!
//! Three things, each behind its own lock so that reading settings does not
//! wait on a scan: the settings, the metadata store, and the last snapshot.
//! A scan lock on top of those makes concurrent scans impossible rather than
//! merely unlikely.

use std::path::PathBuf;
use std::sync::Mutex;

use skills_core::rescan::LibrarySnapshot;
use skills_core::settings::{AppSettings, SettingsFile};
use skills_core::store::MetaStore;

pub struct AppState {
    pub home: PathBuf,
    pub settings_file: SettingsFile,
    pub settings: Mutex<AppSettings>,
    /// `None` until the user has chosen where their notes should live.
    pub store: Mutex<Option<MetaStore>>,
    pub snapshot: Mutex<Option<LibrarySnapshot>>,
    /// Incremented per scan; the frontend keys its derived state on it.
    pub version: Mutex<u32>,
    /// Held for the duration of a scan. A second scan does not queue behind
    /// it — the user would only be waiting twice for a result they will throw
    /// away — it is refused.
    pub scanning: Mutex<()>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("home", &self.home)
            .field("settings_file", &self.settings_file.path())
            .finish_non_exhaustive()
    }
}

impl AppState {
    pub fn new(home: PathBuf, settings_file: SettingsFile, settings: AppSettings) -> Self {
        let store = settings
            .metadata_folder
            .as_ref()
            .and_then(|folder| MetaStore::open(folder).ok());

        Self {
            home,
            settings_file,
            settings: Mutex::new(settings),
            store: Mutex::new(store),
            snapshot: Mutex::new(None),
            version: Mutex::new(0),
            scanning: Mutex::new(()),
        }
    }
}
