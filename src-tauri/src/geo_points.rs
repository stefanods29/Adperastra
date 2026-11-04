//! Geotagged local photos for the optional map (Step 11b decision 9, E6).
//!
//! Photo rows come from the user's canonical Step 11a `SearchQuery` paged
//! through `SearchIndexState::run_view_query`; nothing here scans a second
//! filesystem or reads file contents. Only a fixed four-property Windows
//! allowlist is read (`System.GPS.Latitude/LatitudeRef/Longitude/LongitudeRef`)
//! with a source stamp captured before and after, online-only and reparse
//! entries are skipped, and a session inspects at most 10,000 photos. Pages
//! carry 256 points and at most 768 KiB.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use fs_service::source_stamp::{capture_source_stamp, FileIdentityKey};
use fs_service::{CancellationToken, SortDirection, SortKey, SortSpec};
use search_index::types::{
    validate_uuid, SearchFilter, SearchPage, SearchQuery, SearchResult,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri::Manager;

use crate::jobs::{spawn_job, Jobs};
use crate::map_types::{
    GeoPoint, GeoPointPage, MAX_GEO_PAGE_BYTES, MAX_GEO_POINTS, MAX_GEO_PHOTOS_PER_SESSION,
};
use crate::search_index::SearchIndexState;

const GEO_CURSOR_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_GEO_CURSORS: usize = 128;
const SEARCH_PAGE_SIZE: usize = 256;
/// Indexed picture formats whose Windows properties may carry GPS. Fixed;
/// the UI can never extend it.
pub const PHOTO_EXTENSIONS: [&str; 9] = [
    "jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "webp", "dng",
];

// ---------------------------------------------------------------------------
// GPS parsing (pure, so it is testable without photos)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum GpsValue {
    Scalar(f64),
    Vector(Vec<f64>),
    Text(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Latitude,
    Longitude,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GeoFix {
    pub latitude: f64,
    pub longitude: f64,
}

fn reference_sign(reference: Option<&str>, axis: Axis) -> Option<f64> {
    match reference.map(|value| value.trim().to_ascii_uppercase()).as_deref() {
        None | Some("") => Some(1.0),
        Some("N") if axis == Axis::Latitude => Some(1.0),
        Some("S") if axis == Axis::Latitude => Some(-1.0),
        Some("E") if axis == Axis::Longitude => Some(1.0),
        Some("W") if axis == Axis::Longitude => Some(-1.0),
        _ => None,
    }
}

/// Degrees, minutes and seconds (or a single decimal degree), with the
/// hemisphere applied as a sign. Anything outside the axis or with a
/// wrong-hemisphere reference is invalid, never guessed.
pub fn parse_parts(
    parts: &[f64],
    reference: Option<&str>,
    axis: Axis,
    limit: f64,
) -> Option<f64> {
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    if parts
        .iter()
        .any(|part| !part.is_finite() || *part < 0.0)
    {
        return None;
    }
    if parts[0] > limit {
        return None;
    }
    if parts.len() > 1 && parts[1] >= 60.0 {
        return None;
    }
    if parts.len() > 2 && parts[2] >= 60.0 {
        return None;
    }
    let mut value = parts[0];
    if let Some(minutes) = parts.get(1) {
        value += minutes / 60.0;
    }
    if let Some(seconds) = parts.get(2) {
        value += seconds / 3600.0;
    }
    if !value.is_finite() || value > limit {
        return None;
    }
    Some(reference_sign(reference, axis)? * value)
}

pub fn coordinate_from_text(text: &str, reference: Option<&str>, axis: Axis, limit: f64) -> Option<f64> {
    let parts: Vec<f64> = text
        .split(|character: char| {
            character == ';' || character == ',' || character.is_whitespace()
        })
        .filter(|part| !part.is_empty())
        .map(str::parse::<f64>)
        .collect::<Result<Vec<f64>, _>>()
        .ok()?;
    parse_parts(&parts, reference, axis, limit)
}

pub fn coordinate_from_value(
    value: &GpsValue,
    reference: Option<&str>,
    axis: Axis,
    limit: f64,
) -> Option<f64> {
    match value {
        GpsValue::Scalar(number) => parse_parts(&[*number], reference, axis, limit),
        GpsValue::Vector(parts) => parse_parts(parts, reference, axis, limit),
        GpsValue::Text(text) => coordinate_from_text(text, reference, axis, limit),
    }
}

/// The metadata reader seam. The Windows implementation below reads only the
/// four fixed property names; tests supply an in-memory probe.
pub trait GeoProbe: Send + Sync {
    fn probe(&self, path: &Path) -> Result<Option<GeoFix>, String>;
}

#[cfg(windows)]
pub struct WindowsGeoProbe;

#[cfg(windows)]
mod windows_reader {
    use super::{coordinate_from_text, parse_parts, Axis, GpsKeys, GeoFix, GeoProbe};
    use crate::metadata_properties::windows::VariantGuard;
    use std::path::Path;
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantToDoubleVector, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, PSGetPropertyKeyFromName,
    };

    fn resolve_name(name: &str) -> Option<PROPERTYKEY> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut key = PROPERTYKEY::default();
        // SAFETY: `wide` is a NUL-terminated property name and `key` is a
        // writable out-parameter.
        unsafe { PSGetPropertyKeyFromName(PCWSTR(wide.as_ptr()), &mut key) }
            .is_ok()
            .then_some(key)
    }

    pub(super) fn gps_keys() -> Option<GpsKeys> {
        static KEYS: OnceLock<Option<GpsKeys>> = OnceLock::new();
        *KEYS.get_or_init(|| {
            Some(GpsKeys {
                latitude: resolve_name("System.GPS.Latitude")?,
                latitude_ref: resolve_name("System.GPS.LatitudeRef")?,
                longitude: resolve_name("System.GPS.Longitude")?,
                longitude_ref: resolve_name("System.GPS.LongitudeRef")?,
            })
        })
    }

    fn read_doubles(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<Vec<f64>> {
        // SAFETY: the key comes from the fixed allowlist; the returned
        // variant is owned and cleared by VariantGuard.
        let variant = unsafe { store.GetValue(key) }.ok()?;
        let guard = VariantGuard::new(variant);
        let mut buffer = [0f64; 4];
        let mut count = 0u32;
        // SAFETY: the buffer length is passed to the conversion.
        unsafe { PropVariantToDoubleVector(guard.value(), &mut buffer, &mut count) }.ok()?;
        if count == 0 || count as usize > buffer.len() {
            return None;
        }
        Some(buffer[..count as usize].to_vec())
    }

    fn read_text(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
        // SAFETY: same contract as `read_doubles`.
        let variant = unsafe { store.GetValue(key) }.ok()?;
        let guard = VariantGuard::new(variant);
        // SAFETY: the returned string is CoTaskMem-allocated and taken once.
        let pointer = unsafe { PropVariantToStringAlloc(guard.value()) }.ok()?;
        // SAFETY: the pointer is NUL-terminated until it is freed below.
        let text = unsafe { pointer.to_string() }.ok();
        unsafe { CoTaskMemFree(Some(pointer.0 as *const core::ffi::c_void)) };
        let text = text?;
        if text.chars().count() > 64 {
            return None;
        }
        Some(text)
    }

    fn read_coordinate(
        store: &IPropertyStore,
        value_key: PROPERTYKEY,
        reference_key: PROPERTYKEY,
        axis: Axis,
        limit: f64,
    ) -> Option<f64> {
        let reference = read_text(store, &reference_key);
        if let Some(parts) = read_doubles(store, &value_key) {
            return parse_parts(&parts, reference.as_deref(), axis, limit);
        }
        let text = read_text(store, &value_key)?;
        coordinate_from_text(&text, reference.as_deref(), axis, limit)
    }

    impl GeoProbe for GeoProbeImpl {
        fn probe(&self, path: &Path) -> Result<Option<GeoFix>, String> {
            let _com = crate::explorer::ComGuard::new();
            let Some(keys) = gps_keys() else {
                return Ok(None);
            };
            let store = match crate::metadata_properties::windows::open_store(path) {
                Ok(store) => store,
                Err(_) => return Ok(None),
            };
            let Some(latitude) = read_coordinate(
                &store,
                keys.latitude,
                keys.latitude_ref,
                Axis::Latitude,
                90.0,
            ) else {
                return Ok(None);
            };
            let Some(longitude) = read_coordinate(
                &store,
                keys.longitude,
                keys.longitude_ref,
                Axis::Longitude,
                180.0,
            ) else {
                return Ok(None);
            };
            Ok(Some(GeoFix {
                latitude,
                longitude,
            }))
        }
    }

    pub(super) struct GeoProbeImpl;
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct GpsKeys {
    latitude: windows::Win32::Foundation::PROPERTYKEY,
    latitude_ref: windows::Win32::Foundation::PROPERTYKEY,
    longitude: windows::Win32::Foundation::PROPERTYKEY,
    longitude_ref: windows::Win32::Foundation::PROPERTYKEY,
}

#[cfg(windows)]
impl GeoProbe for WindowsGeoProbe {
    fn probe(&self, path: &Path) -> Result<Option<GeoFix>, String> {
        windows_reader::GeoProbeImpl.probe(path)
    }
}

#[cfg(not(windows))]
pub struct WindowsGeoProbe;

#[cfg(not(windows))]
impl GeoProbe for WindowsGeoProbe {
    fn probe(&self, _path: &Path) -> Result<Option<GeoFix>, String> {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Search source
// ---------------------------------------------------------------------------

pub trait GeoSearch {
    fn search_geo(
        &self,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<SearchPage, String>;
}

pub struct SearchGeoSource<'a> {
    pub app: &'a AppHandle,
    pub state: &'a SearchIndexState,
}

impl GeoSearch for SearchGeoSource<'_> {
    fn search_geo(
        &self,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<SearchPage, String> {
        self.state
            .run_view_query(self.app, query, offset, limit, cancel)
    }
}

fn is_photo_name(name: &str) -> bool {
    PHOTO_EXTENSIONS.contains(&crate::files::extension_of(name).as_str())
}

/// Keep the user's filter and only add the fixed picture-extension clause.
/// Path-name order gives stable offsets across pages.
pub fn photo_query(base: &SearchQuery) -> Result<SearchQuery, String> {
    let mut query = base.clone();
    query.sort = SortSpec {
        key: SortKey::Name,
        direction: SortDirection::Ascending,
    };
    let extension_filter = SearchFilter::ExtList {
        values: PHOTO_EXTENSIONS.iter().map(|ext| (*ext).to_string()).collect(),
        exclude: false,
    };
    query.filter = Some(match query.filter.take() {
        None => extension_filter,
        Some(SearchFilter::All { mut clauses })
            if clauses.len() < search_index::limits::MAX_FILTER_CLAUSES =>
        {
            clauses.push(extension_filter);
            SearchFilter::All { clauses }
        }
        Some(filter) => SearchFilter::All {
            clauses: vec![filter, extension_filter],
        },
    });
    query.validate().map_err(|_| "map.invalid".to_string())?;
    Ok(query)
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

struct StoredGeoCursor {
    fingerprint: String,
    offset: usize,
    inspected: u32,
    generation: u64,
    created: Instant,
}

struct TakenGeoCursor {
    offset: usize,
    inspected: u32,
    generation: u64,
}

/// Opaque per-session cursors bound to the exact derived query and the index
/// generation that produced them.
#[derive(Default)]
pub struct GeoCursorStore {
    cursors: Mutex<HashMap<String, StoredGeoCursor>>,
}

impl GeoCursorStore {
    fn insert(
        &self,
        fingerprint: &str,
        generation: u64,
        offset: usize,
        inspected: u32,
    ) -> Result<String, String> {
        let mut cursors = self
            .cursors
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        cursors.retain(|_, cursor| cursor.created.elapsed() < GEO_CURSOR_TTL);
        while cursors.len() >= MAX_GEO_CURSORS {
            let oldest = cursors
                .iter()
                .min_by_key(|(_, cursor)| cursor.created)
                .map(|(id, _)| id.clone());
            let Some(oldest) = oldest else { break };
            cursors.remove(&oldest);
        }
        let id = uuid::Uuid::new_v4().to_string();
        cursors.insert(
            id.clone(),
            StoredGeoCursor {
                fingerprint: fingerprint.to_string(),
                offset,
                inspected,
                generation,
                created: Instant::now(),
            },
        );
        Ok(id)
    }

    fn take(&self, id: &str, fingerprint: &str) -> Result<TakenGeoCursor, String> {
        validate_uuid(id).map_err(|_| "map.invalid".to_string())?;
        let mut cursors = self
            .cursors
            .lock()
            .map_err(|_| "map.unavailable".to_string())?;
        let Some(stored) = cursors.remove(id) else {
            return Err("map.invalid".to_string());
        };
        if stored.created.elapsed() >= GEO_CURSOR_TTL || stored.fingerprint != fingerprint {
            return Err("map.invalid".to_string());
        }
        Ok(TakenGeoCursor {
            offset: stored.offset,
            inspected: stored.inspected,
            generation: stored.generation,
        })
    }
}

// ---------------------------------------------------------------------------
// Page building
// ---------------------------------------------------------------------------

fn point_for(result: &SearchResult, probe: &dyn GeoProbe) -> Option<GeoPoint> {
    if result.item.online_only || !is_photo_name(&result.item.name) {
        return None;
    }
    let path = Path::new(&result.item.path);
    let before = capture_source_stamp(path).ok()?;
    let fix = probe.probe(path).ok()??;
    let after = capture_source_stamp(path).ok()?;
    if before != after {
        return None;
    }
    let stable = before.volume_id.bytes().any(|byte| byte != b'0')
        && before.file_id.bytes().any(|byte| byte != b'0');
    let point = GeoPoint {
        key: FileIdentityKey {
            volume_id: before.volume_id.clone(),
            file_id: before.file_id.clone(),
            path_key: before.path_key.clone(),
            stable,
        },
        path: result.item.path.clone(),
        source: before,
        latitude: fix.latitude,
        longitude: fix.longitude,
        date_unix: result.date_taken_unix,
    };
    point.validate().ok()?;
    Some(point)
}

fn budget_fits(kept: &[(GeoPoint, usize)], count: usize) -> bool {
    let slice: Vec<&GeoPoint> = kept
        .iter()
        .take(count)
        .map(|(point, _)| point)
        .collect();
    serde_json::to_vec(&slice)
        .map(|bytes| bytes.len() + 512 <= MAX_GEO_PAGE_BYTES)
        .unwrap_or(false)
}

pub fn geo_points_page(
    source: &dyn GeoSearch,
    probe: &dyn GeoProbe,
    cursors: &GeoCursorStore,
    base: &SearchQuery,
    cursor: Option<&str>,
    cancel: &CancellationToken,
) -> Result<GeoPointPage, String> {
    let query = photo_query(base)?;
    let fingerprint =
        serde_json::to_string(&query).map_err(|_| "map.invalid".to_string())?;
    let mut offset;
    let mut inspected;
    let mut generation;
    match cursor {
        Some(cursor) => {
            let taken = cursors.take(cursor, &fingerprint)?;
            offset = taken.offset;
            inspected = taken.inspected;
            generation = Some(taken.generation);
        }
        None => {
            offset = 0;
            inspected = 0;
            generation = None;
        }
    }

    let mut kept: Vec<(GeoPoint, usize)> = Vec::new();
    let mut skipped = 0u32;
    let complete;
    loop {
        if kept.len() >= MAX_GEO_POINTS {
            complete = false;
            break;
        }
        if inspected as usize >= MAX_GEO_PHOTOS_PER_SESSION {
            complete = true;
            break;
        }
        let page = source.search_geo(&query, offset, SEARCH_PAGE_SIZE, cancel)?;
        match generation {
            Some(expected) if expected != page.generation => {
                return Err("map.invalid".to_string())
            }
            Some(_) => {}
            None => generation = Some(page.generation),
        }
        let mut consumed = 0usize;
        let mut last_kept_offset: Option<usize> = None;
        for result in &page.results {
            if kept.len() >= MAX_GEO_POINTS
                || inspected as usize >= MAX_GEO_PHOTOS_PER_SESSION
            {
                break;
            }
            consumed += 1;
            inspected += 1;
            match point_for(result, probe) {
                Some(point) => {
                    last_kept_offset = Some(offset + consumed);
                    kept.push((point, offset + consumed));
                }
                None => skipped = skipped.saturating_add(1),
            }
        }
        if kept.len() >= MAX_GEO_POINTS {
            // Re-read any rows after the last kept photo on the next page;
            // skipped rows are cheap to inspect again and no photo is lost.
            offset = last_kept_offset.unwrap_or(offset + consumed);
            complete = false;
            break;
        }
        offset += consumed;
        if inspected as usize >= MAX_GEO_PHOTOS_PER_SESSION {
            complete = true;
            break;
        }
        if page.results.is_empty() || page.complete {
            complete = true;
            break;
        }
    }

    let generation = generation.ok_or_else(|| "map.invalid".to_string())?;
    let mut count = kept.len();
    while count > 0 && !budget_fits(&kept, count) {
        count -= 1;
    }
    if count == 0 && !kept.is_empty() {
        return Err("map.invalid".to_string());
    }
    let trimmed = count < kept.len();
    let next_offset = if trimmed {
        kept[count - 1].1
    } else {
        offset
    };
    let points = kept
        .into_iter()
        .take(count)
        .map(|(point, _)| point)
        .collect();
    let page_complete = complete && !trimmed;
    let next_cursor = if page_complete {
        None
    } else {
        Some(cursors.insert(&fingerprint, generation, next_offset, inspected)?)
    };
    Ok(GeoPointPage {
        points,
        next_cursor,
        complete: page_complete,
        skipped_count: skipped,
        generation,
    })
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Start one geotagged-photo page (first page or `next_cursor`) as a job.
#[tauri::command]
pub fn geo_points_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    query: SearchQuery,
    cursor: Option<String>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    photo_query(&query)?;
    if let Some(cursor) = &cursor {
        validate_uuid(cursor).map_err(|_| "map.invalid".to_string())?;
    }
    let token = jobs.begin(&request_id, 0)?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let state = work_app.state::<SearchIndexState>();
        let cursors = work_app.state::<GeoCursorStore>();
        let source = SearchGeoSource {
            app: &work_app,
            state: &state,
        };
        let page = geo_points_page(
            &source,
            &WindowsGeoProbe,
            &cursors,
            &query,
            cursor.as_deref(),
            context.token(),
        )?;
        serde_json::to_value(page).map_err(|_| "map.invalid".to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use search_index::types::{ExplorerItem, SearchCoverage};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use fs_service::ItemKind;

    struct FakeSearch {
        rows: Vec<SearchResult>,
        generation: u64,
        calls: AtomicUsize,
    }

    impl FakeSearch {
        fn new(rows: Vec<SearchResult>) -> Self {
            Self {
                rows,
                generation: 7,
                calls: AtomicUsize::new(0),
            }
        }
    }

    impl GeoSearch for FakeSearch {
        fn search_geo(
            &self,
            _query: &SearchQuery,
            offset: usize,
            limit: usize,
            _cancel: &CancellationToken,
        ) -> Result<SearchPage, String> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            let results: Vec<SearchResult> = self.rows.iter().skip(offset).take(limit).cloned().collect();
            let complete = offset + results.len() >= self.rows.len();
            Ok(SearchPage {
                results,
                next_cursor: None,
                next_offset: None,
                generation: self.generation,
                total_estimate: self.rows.len() as u32,
                total_bytes: 0,
                total_exact: true,
                complete,
                coverage: SearchCoverage::Complete,
                skipped_count: 0,
            })
        }
    }

    struct FakeProbe {
        fixes: HashMap<String, Option<GeoFix>>,
    }

    impl GeoProbe for FakeProbe {
        fn probe(&self, path: &Path) -> Result<Option<GeoFix>, String> {
            Ok(self
                .fixes
                .get(&path.to_string_lossy().to_string())
                .copied()
                .flatten())
        }
    }

    fn result(path: &Path, name: &str) -> SearchResult {
        SearchResult {
            item: ExplorerItem {
                path: path.to_string_lossy().to_string(),
                name: name.to_string(),
                kind: ItemKind::File,
                size: 10,
                modified_unix: 1_700_000_000,
                hidden: false,
                system: false,
                is_link: false,
                online_only: false,
                file_id: None,
                file_id_stable: false,
            },
            key: FileIdentityKey {
                volume_id: "11111111".to_string(),
                file_id: "aaaaaaaaaaaaaaaa".to_string(),
                path_key: path.to_string_lossy().to_lowercase(),
                stable: true,
            },
            found_by: search_index::types::SearchMode::Name,
            snippet: None,
            content_truncated: false,
            metadata_available: false,
            created_unix: 1_700_000_000,
            date_taken_unix: Some(1_700_000_000),
        }
    }

    #[test]
    fn gps_values_parse_and_reject_invalid() {
        let close = |left: f64, right: f64| (left - right).abs() < 1e-9;
        assert_eq!(
            parse_parts(&[0.0, 0.0, 0.0], None, Axis::Latitude, 90.0),
            Some(0.0)
        );
        let north = parse_parts(&[47.0, 30.0], Some("N"), Axis::Latitude, 90.0).unwrap();
        assert!(close(north, 47.5));
        let west = parse_parts(&[122.0], Some("W"), Axis::Longitude, 180.0).unwrap();
        assert!(close(west, -122.0));
        assert_eq!(
            parse_parts(&[91.0], None, Axis::Latitude, 90.0),
            None
        );
        assert_eq!(
            parse_parts(&[10.0], Some("W"), Axis::Latitude, 90.0),
            None
        );
        assert_eq!(
            parse_parts(&[10.0, 60.0], None, Axis::Latitude, 90.0),
            None
        );
        assert_eq!(
            parse_parts(&[10.0, 0.0, 0.0, 0.0], None, Axis::Latitude, 90.0),
            None
        );
        assert_eq!(
            coordinate_from_text("47;30;36", Some("N"), Axis::Latitude, 90.0)
                .map(|value| close(value, 47.51)),
            Some(true)
        );
        assert_eq!(
            coordinate_from_text("not a number", None, Axis::Latitude, 90.0),
            None
        );
        assert_eq!(
            coordinate_from_value(&GpsValue::Scalar(0.0), None, Axis::Latitude, 90.0),
            Some(0.0)
        );
    }

    #[test]
    fn missing_or_invalid_gps_is_skipped() {
        let directory = tempfile::tempdir().unwrap();
        let zero = directory.path().join("zero.jpg");
        let missing = directory.path().join("missing.jpg");
        let invalid = directory.path().join("invalid.jpg");
        std::fs::write(&zero, b"a").unwrap();
        std::fs::write(&missing, b"b").unwrap();
        std::fs::write(&invalid, b"c").unwrap();
        let rows = vec![
            result(&zero, "zero.jpg"),
            result(&missing, "missing.jpg"),
            result(&invalid, "invalid.jpg"),
        ];
        let mut fixes = HashMap::new();
        fixes.insert(
            zero.to_string_lossy().to_string(),
            Some(GeoFix {
                latitude: 0.0,
                longitude: 0.0,
            }),
        );
        fixes.insert(missing.to_string_lossy().to_string(), None);
        fixes.insert(
            invalid.to_string_lossy().to_string(),
            Some(GeoFix {
                latitude: 95.0,
                longitude: 0.0,
            }),
        );
        let probe = FakeProbe { fixes };
        let search = FakeSearch::new(rows);
        let cursors = GeoCursorStore::default();
        let cancel = fs_service::new_cancellation_token();
        let page = geo_points_page(
            &search,
            &probe,
            &cursors,
            &SearchQuery::default(),
            None,
            &cancel,
        )
        .unwrap();
        assert_eq!(page.points.len(), 1);
        assert_eq!(page.points[0].latitude, 0.0);
        assert_eq!(page.skipped_count, 2);
        assert!(page.complete);
        assert!(page.next_cursor.is_none());
        assert!(page.generation > 0);
    }

    #[test]
    fn online_only_photos_are_never_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cloud.jpg");
        std::fs::write(&path, b"placeholder").unwrap();
        let mut row = result(&path, "cloud.jpg");
        row.item.online_only = true;
        let probe = FakeProbe {
            fixes: HashMap::new(),
        };
        let search = FakeSearch::new(vec![row]);
        let cursors = GeoCursorStore::default();
        let cancel = fs_service::new_cancellation_token();
        let page = geo_points_page(
            &search,
            &probe,
            &cursors,
            &SearchQuery::default(),
            None,
            &cancel,
        )
        .unwrap();
        assert!(page.points.is_empty());
        assert_eq!(page.skipped_count, 1);
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn photo_query_keeps_user_filter_and_adds_extensions() {
        let mut base = SearchQuery::default();
        base.text = "beach".to_string();
        base.filter = Some(SearchFilter::String {
            field: search_index::types::StringField::Author,
            op: search_index::types::StringOp::Contains,
            value: "beach".to_string(),
        });
        let query = photo_query(&base).unwrap();
        assert_eq!(query.text, "beach");
        assert_eq!(query.sort.key, SortKey::Name);
        assert_eq!(query.sort.direction, SortDirection::Ascending);
        match query.filter {
            Some(SearchFilter::All { clauses }) => {
                assert_eq!(clauses.len(), 2);
                assert!(matches!(
                    clauses[1],
                    SearchFilter::ExtList { ref values, exclude: false } if values.contains(&"jpg".to_string())
                ));
            }
            other => panic!("expected an All filter, got {other:?}"),
        }
    }
}
