//! What the application holds on to between commands.
//!
//! Three things, each behind its own lock so that reading settings does not
//! wait on a scan: the settings, the metadata store, and the last snapshot.
//! A scan lock on top of those makes concurrent scans impossible rather than
//! merely unlikely.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use skills_core::dashboard::{Dismissals, DismissalsFile};
use skills_core::discover::{CatalogFile, DiscoverCatalog};
use skills_core::install::Review;
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

    pub catalog_file: CatalogFile,
    pub catalog: Mutex<DiscoverCatalog>,

    /// Reviews waiting to be applied or cancelled.
    ///
    /// Each holds the clone it was computed from, because applying must copy
    /// the very files the diff was shown for — cloning again could apply
    /// something the user never saw.
    pub reviews: Mutex<HashMap<String, PendingReview>>,

    pub dismissals_file: DismissalsFile,
    pub dismissals: Mutex<Dismissals>,
}

/// A prepared review, and when it was prepared.
#[derive(Debug)]
pub struct PendingReview {
    pub review: Review,
    pub entry_id: String,
    pub prepared_at: Instant,
}

/// How long an unapplied review is kept before its clone is dropped.
pub const REVIEW_LIFETIME: std::time::Duration = std::time::Duration::from_secs(15 * 60);

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("home", &self.home)
            .field("settings_file", &self.settings_file.path())
            .finish_non_exhaustive()
    }
}

impl AppState {
    pub fn new(
        home: PathBuf,
        settings_file: SettingsFile,
        settings: AppSettings,
        catalog_file: CatalogFile,
        dismissals_file: DismissalsFile,
    ) -> Self {
        let store = settings
            .metadata_folder
            .as_ref()
            .and_then(|folder| MetaStore::open(folder).ok());
        let catalog = catalog_file.load();
        let dismissals = dismissals_file.load();

        Self {
            home,
            settings_file,
            settings: Mutex::new(settings),
            store: Mutex::new(store),
            snapshot: Mutex::new(None),
            version: Mutex::new(0),
            scanning: Mutex::new(()),
            catalog_file,
            catalog: Mutex::new(catalog),
            reviews: Mutex::new(HashMap::new()),
            dismissals_file,
            dismissals: Mutex::new(dismissals),
        }
    }

    /// Drops reviews nobody came back to.
    ///
    /// Each holds a clone in the temporary directory, so an abandoned one is a
    /// leak that lasts as long as the application runs.
    pub fn sweep_reviews(&self) {
        let Ok(mut reviews) = self.reviews.lock() else {
            return;
        };
        reviews.retain(|_, pending| pending.prepared_at.elapsed() < REVIEW_LIFETIME);
    }
}
