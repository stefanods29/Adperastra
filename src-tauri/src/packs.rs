//! Native adapter for the optional pack manager (Step 12a E1/E2).
//!
//! Pack data types and the pure catalog/download/install workers live in
//! `pack-store`; this module only validates IPC arguments, owns the app-wide
//! pack state and maps stable `packs.*` codes back to the UI. Pack roots come
//! from the injected `ProfileRoot::shared_packs_dir`, never from a second
//! AppData guess.
//!
//! H04: the bounded `--pack-helper` child parses and extracts pack ZIPs; its
//! parent entry lives in `crate::pack_helper`. `pack-store::install` remains a
//! pure worker for that child. Install/activation is still **not** registered
//! in this app process: this build has no signed catalog source, no completed
//! download path and no production probe, and 12b has not frozen the real
//! artifacts. Until those contracts exist, `install_start` and
//! `download_resume_start` fail closed with `packs.unavailable`. A Tauri job is
//! not a sandbox for an archive parser, so no in-process installer is exposed.
//! Listing, acquiring a verified lease, removing an installed version and
//! refreshing the signed catalog do not extract an archive and remain
//! available.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use pack_store::catalog::{CatalogStore, CatalogTrust, MAX_CATALOG_BYTES, MAX_SIGNATURE_BYTES};
use pack_store::download_state::DownloadStateStore;
use pack_store::install::{scan_states, ActiveVersions};
pub use pack_store::leases::PackLease;
use pack_store::leases::PackLeases;
use pack_store::types::{PackCatalog, PackId, PackState};
use pack_store::validation::CatalogPolicy;
use tauri::{AppHandle, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

/// The two signed catalog URLs. The build/coordinator supplies both; the app
/// never invents a catalog URL and never follows an unsigned redirect.
#[derive(Debug, Clone)]
pub struct CatalogSource {
    pub catalog_url: String,
    pub signature_url: String,
}

#[derive(Clone)]
pub struct Packs {
    inner: Arc<PacksInner>,
}

struct PacksInner {
    root: PathBuf,
    trust: CatalogTrust,
    policy: CatalogPolicy,
    store: CatalogStore,
    downloads: DownloadStateStore,
    leases: PackLeases,
    active: ActiveVersions,
    catalog: Mutex<Option<PackCatalog>>,
    catalog_error: Mutex<Option<String>>,
    source: Option<CatalogSource>,
    /// Pause flags for downloads started by a future bounded helper. They are
    /// kept here so the one pack manager owns the per-pack control state; no
    /// in-process download starts until that helper exists.
    controls: Mutex<HashMap<PackId, Arc<AtomicBool>>>,
}

impl Packs {
    /// `root` is `ProfileRoot::shared_packs_dir`; `public_key` is the same
    /// trusted setup/release key used by Step 01a verification.
    pub fn new(
        root: PathBuf,
        public_key: String,
        source: Option<CatalogSource>,
    ) -> Result<Self, String> {
        let trust = CatalogTrust::new(public_key);
        let policy = CatalogPolicy::production();
        let store = CatalogStore::new(&root);
        let loaded = store.load(&trust, policy);
        let (catalog, catalog_error) = match loaded {
            Ok(catalog) => (Some(catalog), None),
            Err(error) => (None, Some(error.code().to_string())),
        };
        let downloads = DownloadStateStore::new(&root);
        let leases = PackLeases::new(&root);
        // A removal requested before the last app run had no leases left;
        // finish it now, before any new lease can be acquired.
        let _ = leases.complete_pending_removals();
        let active = ActiveVersions::new(&root);
        Ok(Self {
            inner: Arc::new(PacksInner {
                downloads,
                leases,
                active,
                root,
                trust,
                policy,
                store,
                catalog: Mutex::new(catalog),
                catalog_error: Mutex::new(catalog_error),
                source,
                controls: Mutex::new(HashMap::new()),
            }),
        })
    }

    fn catalog(&self) -> Result<PackCatalog, String> {
        if let Some(catalog) = self
            .inner
            .catalog
            .lock()
            .map_err(|_| "packs.failed".to_string())?
            .clone()
        {
            return Ok(catalog);
        }
        Err(self
            .inner
            .catalog_error
            .lock()
            .map_err(|_| "packs.failed".to_string())?
            .clone()
            .unwrap_or_else(|| "packs.unavailable".to_string()))
    }

    /// E2: pin the exact active verified version until `PackLease` drops.
    /// The path itself never crosses IPC; only a trusted native caller uses
    /// the lease's entrypoint.
    pub fn acquire(&self, id: PackId, capability: &str) -> Result<PackLease, String> {
        if self.inner.leases.is_pending_remove(id) {
            return Err("packs.busy".to_string());
        }
        let pointer = self
            .inner
            .active
            .read(id)
            .map_err(|error| error.code().to_string())?
            .ok_or_else(|| "packs.unavailable".to_string())?;
        let catalog = self.catalog()?;
        let descriptor = catalog
            .descriptor(id, &pointer.version)
            .ok_or_else(|| "packs.unavailable".to_string())?;
        self.inner
            .leases
            .acquire(&pointer, descriptor, capability)
            .map_err(|error| error.code().to_string())
    }

    /// Every row Settings > App storage shows. With no valid catalog, App
    /// storage still opens and shows the uninstalled production rows instead
    /// of failing or inventing versions.
    pub fn list(&self) -> Result<Vec<PackState>, String> {
        let catalog = match self.catalog() {
            Ok(catalog) => catalog,
            Err(_) => return self.list_without_catalog(),
        };
        let downloads = self
            .inner
            .downloads
            .list()
            .map_err(|error| error.code().to_string())?;
        let mut rows = scan_states(&self.inner.root, &catalog, &downloads, |id| {
            self.inner.leases.lease_count(id)
        })
        .map_err(|error| error.code().to_string())?;
        rows.retain(|row| row.id.is_production());
        for id in PackId::PRODUCTION {
            if !rows.iter().any(|row| row.id == *id) {
                rows.push(PackState::absent(*id));
            }
        }
        Ok(rows)
    }

    /// App storage still opens without a valid catalog. Installed versions,
    /// pending removals and existing downloads are real local facts and stay
    /// visible; no version is offered or invented.
    fn list_without_catalog(&self) -> Result<Vec<PackState>, String> {
        let downloads = self
            .inner
            .downloads
            .list()
            .map_err(|error| error.code().to_string())?;
        let empty = PackCatalog {
            schema_version: 1,
            revision: 1,
            allowed_origins: Vec::new(),
            packs: Vec::new(),
        };
        let mut rows = scan_states(&self.inner.root, &empty, &downloads, |id| {
            self.inner.leases.lease_count(id)
        })
        .map_err(|error| error.code().to_string())?;
        rows.retain(|row| row.id.is_production());
        for id in PackId::PRODUCTION {
            if !rows.iter().any(|row| row.id == *id) {
                rows.push(PackState::absent(*id));
            }
        }
        Ok(rows)
    }

    fn state_for(&self, id: PackId) -> Result<PackState, String> {
        let rows = match self.catalog() {
            Ok(catalog) => {
                let downloads = self
                    .inner
                    .downloads
                    .list()
                    .map_err(|error| error.code().to_string())?;
                pack_store::install::scan_states(
                    &self.inner.root,
                    &catalog,
                    &downloads,
                    |pack_id| self.inner.leases.lease_count(pack_id),
                )
                .map_err(|error| error.code().to_string())?
            }
            Err(_) => self.list_without_catalog()?,
        };
        rows.into_iter()
            .find(|row| row.id == id)
            .ok_or_else(|| "packs.unavailable".to_string())
    }

    fn pause(&self, id: PackId) -> Result<(), String> {
        let controls = self
            .inner
            .controls
            .lock()
            .map_err(|_| "packs.failed".to_string())?;
        let flag = controls
            .get(&id)
            .ok_or_else(|| "packs.bad_request".to_string())?;
        flag.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn refresh_catalog(&self) -> Result<PackCatalog, String> {
        let source = self
            .inner
            .source
            .clone()
            .ok_or_else(|| "packs.unavailable".to_string())?;
        let catalog_url = pack_store::validation::parse_https_url(&source.catalog_url, false)
            .map_err(|error| error.code().to_string())?;
        let signature_url =
            pack_store::validation::parse_https_url(&source.signature_url, false)
                .map_err(|error| error.code().to_string())?;
        if catalog_url.origin() != signature_url.origin() {
            return Err("packs.bad_request".to_string());
        }
        if let Ok(current) = self.catalog() {
            pack_store::validation::validate_download_url(
                catalog_url.as_str(),
                &current.allowed_origins,
                self.inner.policy,
            )
            .map_err(|error| error.code().to_string())?;
        }
        let catalog_bytes = fetch_bounded(&source.catalog_url, MAX_CATALOG_BYTES)?;
        let signature = fetch_bounded(&source.signature_url, MAX_SIGNATURE_BYTES)?;
        let signature =
            String::from_utf8(signature).map_err(|_| "packs.bad_signature".to_string())?;
        let catalog = self
            .inner
            .store
            .store(
                &catalog_bytes,
                &signature,
                &self.inner.trust,
                self.inner.policy,
            )
            .map_err(|error| error.code().to_string())?;
        *self
            .inner
            .catalog
            .lock()
            .map_err(|_| "packs.failed".to_string())? = Some(catalog.clone());
        *self
            .inner
            .catalog_error
            .lock()
            .map_err(|_| "packs.failed".to_string())? = None;
        Ok(catalog)
    }
}

/// Read at most `max` bytes from one explicit HTTPS catalog URL. Redirects
/// are refused rather than followed to an origin the signed catalog did not
/// name; the caller already checked the origin against the current catalog.
fn fetch_bounded(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let parsed = pack_store::validation::parse_https_url(url, false)
        .map_err(|error| error.code().to_string())?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "packs.unavailable".to_string())?;
    let response = client
        .get(parsed)
        .send()
        .map_err(|_| "packs.unavailable".to_string())?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|length| length > max)
    {
        return Err("packs.unavailable".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "packs.failed".to_string())?;
    if bytes.len() as u64 > max {
        return Err("packs.bad_request".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn pack_list(
    window: WebviewWindow,
    packs: State<'_, Packs>,
) -> Result<Vec<PackState>, String> {
    ensure_main(window.label())?;
    let packs = packs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || packs.list())
        .await
        .map_err(|_| "packs.failed".to_string())?
}

#[tauri::command]
pub fn catalog_refresh_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    packs: State<'_, Packs>,
    request_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    let packs = packs.inner().clone();
    spawn_job(app, request_id, token, move |_context| {
        let catalog = packs.refresh_catalog()?;
        serde_json::to_value(catalog).map_err(|_| "packs.failed".to_string())
    });
    Ok(())
}

/// H04: no in-process archive extraction or activation. The bounded
/// `--pack-helper` exists, but install needs a signed catalog descriptor, a
/// completed owned download and a production probe first; all three are
/// absent from this build. The command keeps the documented IPC surface and
/// fails closed rather than parsing an archive in this process.
#[tauri::command]
pub fn install_start(
    window: WebviewWindow,
    _packs: State<'_, Packs>,
    request_id: String,
    id: PackId,
    version: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if !pack_store::validation::is_valid_semver(&version) {
        return Err("packs.bad_request".to_string());
    }
    let _ = id;
    Err("packs.unavailable".to_string())
}

#[tauri::command]
pub fn download_pause(
    window: WebviewWindow,
    packs: State<'_, Packs>,
    id: PackId,
) -> Result<(), String> {
    ensure_main(window.label())?;
    // No download can be running while installs are unavailable; refusing
    // here is truthful and cannot leave a partial writer open.
    packs.inner().pause(id).map_err(|code| {
        if code == "packs.bad_request" {
            "packs.unavailable".to_string()
        } else {
            code
        }
    })
}

/// H04: downloads belong to the bounded helper install path, and this build
/// has no catalog source or completed-download command. Without both, no
/// resume is offered and no partial is appended in this process.
#[tauri::command]
pub fn download_resume_start(
    window: WebviewWindow,
    _packs: State<'_, Packs>,
    request_id: String,
    id: PackId,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let _ = id;
    Err("packs.unavailable".to_string())
}

#[tauri::command]
pub fn remove_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    packs: State<'_, Packs>,
    request_id: String,
    id: PackId,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let packs = packs.inner().clone();
    let pointer = packs
        .inner
        .active
        .read(id)
        .map_err(|error| error.code().to_string())?
        .ok_or_else(|| "packs.unavailable".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    let inner = packs.inner.clone();
    spawn_job(app, request_id, token, move |_context| {
        let control = Arc::clone(&inner);
        inner
            .leases
            .request_remove(&pointer, &|pack_id| {
                if let Ok(controls) = control.controls.lock() {
                    if let Some(flag) = controls.get(&pack_id) {
                        flag.store(true, Ordering::SeqCst);
                    }
                }
            })
            .map_err(|error| error.code().to_string())?;
        let packs = Packs { inner };
        let state = packs.state_for(id)?;
        serde_json::to_value(state).map_err(|_| "packs.failed".to_string())
    });
    Ok(())
}

