//! Indexed timeline, calendar and By kind views (Step 11b decision 7 and E4).
//!
//! Every page is built from canonical Step 11a `SearchQuery`/`SearchPage`
//! results. Counts are real `SELECT COUNT(*)` answers per local-date bucket;
//! results are paged at 256 rows and trimmed to 768 KiB. Local calendar
//! boundaries use Windows' own zone rules through `TzSpecificLocalTimeToSystemTime`.
#![allow(dead_code)]


use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use fs_service::{CancellationToken, SortDirection};
use search_index::limits::{unix_now, MAX_FILTER_CLAUSES};
use search_index::types::{
    validate_uuid, DateField, SearchFilter, SearchPage, SearchQuery,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri::Manager;

use crate::jobs::{spawn_job, Jobs};
use crate::search_index::SearchIndexState;
use crate::smart_view_types::{
    parse_month, IndexedView, IndexedViewPage, IndexedViewQuery, ViewBucket, ViewGroup, ViewKind,
    MAX_VIEW_BUCKETS, MAX_VIEW_PAGE_BYTES, MAX_VIEW_RESULTS,
};

const VIEW_CURSOR_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_VIEW_CURSORS: usize = 128;
const UNDATED_ID: &str = "undated";

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct StoredCursor {
    offset: usize,
    generation: u64,
    fingerprint: String,
    buckets: Vec<ViewBucket>,
    created: Instant,
}

pub struct TakenCursor {
    pub offset: usize,
    pub generation: u64,
    pub buckets: Vec<ViewBucket>,
}

/// Opaque per-request cursors. A cursor is bound to the exact request (minus
/// the cursor itself) and to the index generation that produced it.
#[derive(Default)]
pub struct ViewCursorStore {
    cursors: Mutex<HashMap<String, StoredCursor>>,
}

impl ViewCursorStore {
    fn insert(
        &self,
        fingerprint: &str,
        generation: u64,
        offset: usize,
        buckets: Vec<ViewBucket>,
    ) -> Result<String, String> {
        let mut cursors = self
            .cursors
            .lock()
            .map_err(|_| "views.unavailable".to_string())?;
        cursors.retain(|_, cursor| cursor.created.elapsed() < VIEW_CURSOR_TTL);
        while cursors.len() >= MAX_VIEW_CURSORS {
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
            StoredCursor {
                offset,
                generation,
                fingerprint: fingerprint.to_string(),
                buckets,
                created: Instant::now(),
            },
        );
        Ok(id)
    }

    fn take(&self, id: &str, fingerprint: &str) -> Result<TakenCursor, String> {
        validate_uuid(id).map_err(|_| "views.invalid".to_string())?;
        let mut cursors = self
            .cursors
            .lock()
            .map_err(|_| "views.unavailable".to_string())?;
        let Some(stored) = cursors.remove(id) else {
            return Err("views.invalid".to_string());
        };
        if stored.created.elapsed() >= VIEW_CURSOR_TTL || stored.fingerprint != fingerprint {
            return Err("views.invalid".to_string());
        }
        Ok(TakenCursor {
            offset: stored.offset,
            generation: stored.generation,
            buckets: stored.buckets,
        })
    }
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

pub trait ViewSearch {
    fn search_view(
        &self,
        query: &SearchQuery,
        offset: usize,
        limit: usize,
        cancel: &CancellationToken,
    ) -> Result<SearchPage, String>;
}

pub struct SearchViewSource<'a> {
    pub app: &'a AppHandle,
    pub state: &'a SearchIndexState,
}

impl ViewSearch for SearchViewSource<'_> {
    fn search_view(
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

// ---------------------------------------------------------------------------
// Local calendar math
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CivilDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

pub fn leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

pub fn next_day(year: i32, month: u32, day: u32) -> CivilDate {
    if day < days_in_month(year, month) {
        CivilDate {
            year,
            month,
            day: day + 1,
        }
    } else {
        let (year, month) = next_month(year, month);
        CivilDate {
            year,
            month,
            day: 1,
        }
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
pub fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = i64::from(if month <= 2 { year - 1 } else { year });
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = month as i64;
    let day = day as i64;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

pub fn civil_from_days(days: i64) -> CivilDate {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = if month_part < 10 { month_part + 3 } else { month_part - 9 };
    CivilDate {
        year: (year + if month <= 2 { 1 } else { 0 }) as i32,
        month: month as u32,
        day: day as u32,
    }
}

/// The local moment of `date` at 00:00, as seconds since 1970. Windows applies
/// the PC's current zone rules, exactly as the Explorer does.
#[cfg(windows)]
pub fn local_midnight_unix(year: i32, month: u32, day: u32) -> Option<u64> {
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::System::Time::{SystemTimeToFileTime, TzSpecificLocalTimeToSystemTime};

    if !(1601..=9998).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    if day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let local = SYSTEMTIME {
        wYear: year as u16,
        wMonth: month as u16,
        wDayOfWeek: 0,
        wDay: day as u16,
        wHour: 0,
        wMinute: 0,
        wSecond: 0,
        wMilliseconds: 0,
    };
    let mut utc = SYSTEMTIME::default();
    // SAFETY: both structures are locals that outlive the calls.
    if unsafe { TzSpecificLocalTimeToSystemTime(None, &local, &mut utc) }.is_err() {
        return None;
    }
    let mut filetime = FILETIME::default();
    // SAFETY: `utc` is a valid SYSTEMTIME and `filetime` a local of the type
    // the call writes.
    if unsafe { SystemTimeToFileTime(&utc, &mut filetime) }.is_err() {
        return None;
    }
    let ticks = (u64::from(filetime.dwHighDateTime) << 32) | u64::from(filetime.dwLowDateTime);
    Some(fs_service::filetime_to_unix(ticks))
}

#[cfg(not(windows))]
pub fn local_midnight_unix(_year: i32, _month: u32, _day: u32) -> Option<u64> {
    None
}

#[cfg(windows)]
pub fn unix_to_local_date(unix: u64) -> Option<CivilDate> {
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};

    let ticks = unix.checked_add(11_644_473_600)?.checked_mul(10_000_000)?;
    let file_time = FILETIME {
        dwLowDateTime: (ticks & 0xffff_ffff) as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    let mut utc = SYSTEMTIME::default();
    // SAFETY: both structures are locals that outlive the calls.
    if unsafe { FileTimeToSystemTime(&file_time, &mut utc) }.is_err() {
        return None;
    }
    let mut local = SYSTEMTIME::default();
    // SAFETY: same; `None` asks for the current zone.
    if unsafe { SystemTimeToTzSpecificLocalTime(None, &utc, &mut local) }.is_err() {
        return None;
    }
    Some(CivilDate {
        year: local.wYear as i32,
        month: u32::from(local.wMonth),
        day: u32::from(local.wDay),
    })
}

#[cfg(not(windows))]
pub fn unix_to_local_date(_unix: u64) -> Option<CivilDate> {
    None
}

fn current_month() -> (i32, u32) {
    let now = unix_now();
    let date = unix_to_local_date(now)
        .unwrap_or_else(|| civil_from_days((now / 86_400) as i64));
    (date.year, date.month)
}

fn resolve_month(request: &IndexedViewQuery) -> Result<(i32, u32), String> {
    match &request.month {
        Some(month) => parse_month(month).ok_or_else(|| "views.invalid".to_string()),
        None => Ok(current_month()),
    }
}

fn day_range(year: i32, month: u32, day: u32) -> Result<(u64, u64), String> {
    let from = local_midnight_unix(year, month, day).ok_or_else(|| "views.invalid".to_string())?;
    let next = next_day(year, month, day);
    let next_from =
        local_midnight_unix(next.year, next.month, next.day).ok_or_else(|| "views.invalid".to_string())?;
    if next_from <= from {
        return Err("views.invalid".to_string());
    }
    Ok((from, next_from - 1))
}

fn month_range(year: i32, month: u32) -> Result<(u64, u64), String> {
    let from = local_midnight_unix(year, month, 1).ok_or_else(|| "views.invalid".to_string())?;
    let (next_year, next_month_value) = next_month(year, month);
    let next_from = local_midnight_unix(next_year, next_month_value, 1)
        .ok_or_else(|| "views.invalid".to_string())?;
    if next_from <= from {
        return Err("views.invalid".to_string());
    }
    Ok((from, next_from - 1))
}

fn year_range(year: i32) -> Result<(u64, u64), String> {
    let from = local_midnight_unix(year, 1, 1).ok_or_else(|| "views.invalid".to_string())?;
    let next_from =
        local_midnight_unix(year + 1, 1, 1).ok_or_else(|| "views.invalid".to_string())?;
    if next_from <= from {
        return Err("views.invalid".to_string());
    }
    Ok((from, next_from - 1))
}

fn timeline_window(year: i32, month: u32, group: ViewGroup) -> Result<(u64, u64), String> {
    match group {
        ViewGroup::Day | ViewGroup::Week => month_range(year, month),
        ViewGroup::Month => year_range(year),
        ViewGroup::Year => year_range(year.saturating_sub(11)),
    }
}

// ---------------------------------------------------------------------------
// Filters over the canonical query
// ---------------------------------------------------------------------------

fn compose(existing: Option<SearchFilter>, extra: SearchFilter) -> SearchFilter {
    match existing {
        None => extra,
        Some(SearchFilter::All { mut clauses })
            if clauses.len() + 2 <= MAX_FILTER_CLAUSES =>
        {
            clauses.push(extra);
            SearchFilter::All { clauses }
        }
        Some(existing) => SearchFilter::All {
            clauses: vec![existing, extra],
        },
    }
}

fn date_filter(field: DateField, from: u64, to: u64) -> SearchFilter {
    SearchFilter::Date {
        field,
        from_unix: Some(from),
        to_unix: Some(to),
    }
}

/// The additive `MissingDate` variant of the 11a filter AST. A plain
/// `Date { None, None }` means "no date constraint" in that contract, so it
/// cannot select undated rows; `IS NULL` needs its own typed clause.
fn missing_filter(field: DateField) -> SearchFilter {
    SearchFilter::MissingDate { field }
}

fn kind_filter(kind: ViewKind) -> SearchFilter {
    if kind == ViewKind::Other {
        SearchFilter::ExtList {
            values: ViewKind::known_extensions(),
            exclude: true,
        }
    } else {
        SearchFilter::ExtList {
            values: kind.extensions().iter().map(|value| value.to_string()).collect(),
            exclude: false,
        }
    }
}

fn count_where(
    source: &dyn ViewSearch,
    base: &SearchQuery,
    extra: SearchFilter,
    cancel: &CancellationToken,
) -> Result<(u32, u64, u64), String> {
    let mut query = base.clone();
    query.filter = Some(compose(base.filter.clone(), extra));
    let page = source.search_view(&query, 0, 1, cancel)?;
    Ok((page.total_estimate, page.total_bytes, page.generation))
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

fn timeline_buckets(
    source: &dyn ViewSearch,
    request: &IndexedViewQuery,
    (year, month): (i32, u32),
    cancel: &CancellationToken,
) -> Result<(Vec<ViewBucket>, u64), String> {
    let field = request.date_source.field();
    let mut ranges: Vec<(String, u64, u64)> = Vec::new();
    match request.group {
        ViewGroup::Day | ViewGroup::Week => {
            // Week buckets are folded from real day counts in the UI, so the
            // PC's first-day-of-week setting never changes a native count.
            for day in 1..=days_in_month(year, month) {
                let (from, to) = day_range(year, month, day)?;
                ranges.push((format!("{year:04}-{month:02}-{day:02}"), from, to));
            }
        }
        ViewGroup::Month => {
            for value in 1..=12 {
                let (from, to) = month_range(year, value)?;
                ranges.push((format!("{year:04}-{value:02}"), from, to));
            }
        }
        ViewGroup::Year => {
            for value in (year.saturating_sub(11))..=year {
                let (from, to) = year_range(value)?;
                ranges.push((format!("{value:04}"), from, to));
            }
        }
    }
    let mut buckets = Vec::with_capacity(ranges.len() + 1);
    let mut generation = 0;
    for (id, from, to) in ranges {
        let (count, bytes, current) =
            count_where(source, &request.query, date_filter(field, from, to), cancel)?;
        if generation == 0 {
            generation = current;
        } else if generation != current {
            return Err("views.invalid".to_string());
        }
        buckets.push(ViewBucket {
            id,
            label_key: None,
            date_from_unix: Some(from),
            date_to_unix: Some(to),
            count,
            total_bytes: bytes,
        });
    }
    let (count, bytes, current) =
        count_where(source, &request.query, missing_filter(field), cancel)?;
    if generation == 0 {
        generation = current;
    } else if generation != current {
        return Err("views.invalid".to_string());
    }
    buckets.push(ViewBucket {
        id: UNDATED_ID.to_string(),
        label_key: Some("views.undated".to_string()),
        date_from_unix: None,
        date_to_unix: None,
        count,
        total_bytes: bytes,
    });
    Ok((buckets, generation))
}

fn calendar_buckets(
    source: &dyn ViewSearch,
    request: &IndexedViewQuery,
    (year, month): (i32, u32),
    cancel: &CancellationToken,
) -> Result<(Vec<ViewBucket>, u64), String> {
    let field = request.date_source.field();
    let mut buckets = Vec::with_capacity(31);
    let mut generation = 0;
    for day in 1..=days_in_month(year, month) {
        let (from, to) = day_range(year, month, day)?;
        let (count, bytes, current) =
            count_where(source, &request.query, date_filter(field, from, to), cancel)?;
        if generation == 0 {
            generation = current;
        } else if generation != current {
            return Err("views.invalid".to_string());
        }
        buckets.push(ViewBucket {
            id: format!("{year:04}-{month:02}-{day:02}"),
            label_key: None,
            date_from_unix: Some(from),
            date_to_unix: Some(to),
            count,
            total_bytes: bytes,
        });
    }
    Ok((buckets, generation))
}

fn kind_buckets(
    source: &dyn ViewSearch,
    request: &IndexedViewQuery,
    cancel: &CancellationToken,
) -> Result<(Vec<ViewBucket>, u64), String> {
    let mut buckets = Vec::with_capacity(ViewKind::ALL.len());
    let mut generation = 0;
    for kind in ViewKind::ALL {
        let (count, bytes, current) =
            count_where(source, &request.query, kind_filter(kind), cancel)?;
        if generation == 0 {
            generation = current;
        } else if generation != current {
            return Err("views.invalid".to_string());
        }
        buckets.push(ViewBucket {
            id: kind.id().to_string(),
            label_key: Some(kind.label_key().to_string()),
            date_from_unix: None,
            date_to_unix: None,
            count,
            total_bytes: bytes,
        });
    }
    Ok((buckets, generation))
}

fn compute_buckets(
    source: &dyn ViewSearch,
    request: &IndexedViewQuery,
    month: (i32, u32),
    cancel: &CancellationToken,
) -> Result<(Vec<ViewBucket>, u64), String> {
    let (buckets, generation) = match request.view {
        IndexedView::Timeline => timeline_buckets(source, request, month, cancel)?,
        IndexedView::Calendar => calendar_buckets(source, request, month, cancel)?,
        IndexedView::ByKind => kind_buckets(source, request, cancel)?,
        IndexedView::RecentActivity | IndexedView::Map => {
            return Err("views.invalid".to_string())
        }
    };
    if buckets.len() > MAX_VIEW_BUCKETS {
        return Err("views.invalid".to_string());
    }
    Ok((buckets, generation))
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

fn results_query(
    request: &IndexedViewQuery,
    (year, month): (i32, u32),
) -> Result<Option<SearchQuery>, String> {
    match request.view {
        IndexedView::Timeline => {
            let field = request.date_source.field();
            let (from, to) = timeline_window(year, month, request.group)?;
            let mut query = request.query.clone();
            query.filter = Some(compose(
                request.query.filter.clone(),
                SearchFilter::Any {
                    clauses: vec![date_filter(field, from, to), missing_filter(field)],
                },
            ));
            query.sort.direction = SortDirection::Descending;
            query.sort_date = Some(field);
            Ok(Some(query))
        }
        IndexedView::Calendar => {
            let field = request.date_source.field();
            let (from, to) = month_range(year, month)?;
            let mut query = request.query.clone();
            query.filter = Some(compose(
                request.query.filter.clone(),
                date_filter(field, from, to),
            ));
            Ok(Some(query))
        }
        IndexedView::ByKind => match request.kind {
            Some(kind) => {
                let mut query = request.query.clone();
                query.filter = Some(compose(
                    request.query.filter.clone(),
                    kind_filter(kind),
                ));
                Ok(Some(query))
            }
            None => Ok(None),
        },
        IndexedView::RecentActivity | IndexedView::Map => {
            Err("views.invalid".to_string())
        }
    }
}

fn trim_to_limit(page: &mut IndexedViewPage) -> Result<(), String> {
    while serde_json::to_vec(page)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
        > MAX_VIEW_PAGE_BYTES
    {
        if page.results.pop().is_none() {
            return Err("views.invalid".to_string());
        }
        page.complete = false;
    }
    Ok(())
}

pub fn indexed_view_page(
    source: &dyn ViewSearch,
    cursors: &ViewCursorStore,
    request: &IndexedViewQuery,
    cancel: &CancellationToken,
) -> Result<IndexedViewPage, String> {
    request.validate()?;
    if matches!(
        request.view,
        IndexedView::RecentActivity | IndexedView::Map
    ) {
        return Err("views.invalid".to_string());
    }
    let month = resolve_month(request)?;
    let base = request.without_cursor();
    let fingerprint =
        serde_json::to_string(&base).map_err(|_| "views.invalid".to_string())?;
    let (offset, expected_generation, buckets) = match &request.cursor {
        Some(cursor) => {
            let taken = cursors.take(cursor, &fingerprint)?;
            (taken.offset, Some(taken.generation), taken.buckets)
        }
        None => {
            let (buckets, generation) = compute_buckets(source, &base, month, cancel)?;
            (0, Some(generation), buckets)
        }
    };
    let query = results_query(&base, month)?;
    let page = match &query {
        Some(query) => Some(source.search_view(query, offset, MAX_VIEW_RESULTS, cancel)?),
        None => None,
    };
    let generation = match (&page, expected_generation) {
        (Some(page), Some(expected)) if page.generation != expected => {
            return Err("views.invalid".to_string())
        }
        (Some(page), _) => page.generation,
        (None, Some(expected)) => expected,
        (None, None) => return Err("views.invalid".to_string()),
    };
    let complete = page.as_ref().map(|page| page.complete).unwrap_or(true);
    let results = page.map(|page| page.results).unwrap_or_default();
    let mut output = IndexedViewPage {
        buckets,
        results,
        next_cursor: None,
        complete,
        generation,
    };
    trim_to_limit(&mut output)?;
    if !output.complete && !output.results.is_empty() {
        let offset_after = offset + output.results.len();
        output.next_cursor = Some(cursors.insert(
            &fingerprint,
            generation,
            offset_after,
            output.buckets.clone(),
        )?);
    }
    Ok(output)
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Start one indexed-view page (first page or `next_cursor`) as a shared job.
#[tauri::command]
pub fn indexed_view_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: IndexedViewQuery,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request.validate()?;
    if matches!(
        request.view,
        IndexedView::RecentActivity | IndexedView::Map
    ) {
        return Err("views.invalid".to_string());
    }
    let token = jobs.begin(&request_id, 0)?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let state = work_app.state::<SearchIndexState>();
        let cursors = work_app.state::<ViewCursorStore>();
        let source = SearchViewSource {
            app: &work_app,
            state: &state,
        };
        let page = indexed_view_page(&source, &cursors, &request, context.token())?;
        serde_json::to_value(page).map_err(|_| "views.invalid".to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::source_stamp::FileIdentityKey;
    use fs_service::ItemKind;
    use search_index::types::{ExplorerItem, SearchCoverage, SearchResult};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct FakeSearch {
        generation: AtomicU64,
        calls: Mutex<Vec<SearchQuery>>,
        rows: usize,
        snippet: usize,
    }

    impl FakeSearch {
        fn new(generation: u64, rows: usize, snippet: usize) -> Self {
            Self {
                generation: AtomicU64::new(generation),
                calls: Mutex::new(Vec::new()),
                rows,
                snippet,
            }
        }

        fn calls(&self) -> Vec<SearchQuery> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl ViewSearch for FakeSearch {
        fn search_view(
            &self,
            query: &SearchQuery,
            offset: usize,
            limit: usize,
            _cancel: &CancellationToken,
        ) -> Result<SearchPage, String> {
            self.calls.lock().unwrap().push(query.clone());
            let undated = query.filter.as_ref().is_some_and(has_missing);
            let total = if undated { 2 } else { 1 };
            let results = if query.sort_date.is_some() {
                (0..self.rows.min(limit))
                    .map(|index| result(offset + index, self.snippet))
                    .collect()
            } else {
                Vec::new()
            };
            Ok(SearchPage {
                results,
                next_cursor: None,
                next_offset: None,
                generation: self.generation.load(Ordering::Relaxed),
                total_estimate: total,
                total_bytes: 10,
                total_exact: true,
                complete: false,
                coverage: SearchCoverage::Complete,
                skipped_count: 0,
            })
        }
    }

    fn has_missing(filter: &SearchFilter) -> bool {
        match filter {
            SearchFilter::MissingDate { .. } => true,
            SearchFilter::All { clauses } | SearchFilter::Any { clauses } => {
                clauses.iter().any(has_missing)
            }
            SearchFilter::Not { clause } => has_missing(clause),
            _ => false,
        }
    }

    fn has_ext_list(filter: &SearchFilter, exclude: bool) -> bool {
        match filter {
            SearchFilter::ExtList { exclude: value, .. } => *value == exclude,
            SearchFilter::All { clauses } | SearchFilter::Any { clauses } => {
                clauses.iter().any(|clause| has_ext_list(clause, exclude))
            }
            SearchFilter::Not { clause } => has_ext_list(clause, exclude),
            _ => false,
        }
    }

    fn result(index: usize, snippet: usize) -> SearchResult {
        SearchResult {
            item: ExplorerItem {
                path: format!("C:\\Photos\\{index}.jpg"),
                name: format!("{index}.jpg"),
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
                file_id: format!("{index:016x}"),
                path_key: format!("c:\\photos\\{index}.jpg"),
                stable: true,
            },
            found_by: search_index::types::SearchMode::Name,
            snippet: if snippet == 0 {
                None
            } else {
                Some("x".repeat(snippet))
            },
            content_truncated: false,
            metadata_available: false,
            created_unix: 1_700_000_000,
            date_taken_unix: Some(1_700_000_000),
        }
    }

    fn cancel() -> CancellationToken {
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))
    }

    fn request(view: IndexedView) -> IndexedViewQuery {
        IndexedViewQuery {
            view,
            query: SearchQuery::default(),
            date_source: crate::smart_view_types::DateSource::Modified,
            group: ViewGroup::Day,
            month: Some("2026-11".to_string()),
            kind: None,
            cursor: None,
        }
    }

    #[test]
    fn timeline_puts_missing_dates_in_undated_and_sorts_date_desc() {
        let source = FakeSearch::new(7, 3, 0);
        let cursors = ViewCursorStore::default();
        let page = indexed_view_page(&source, &cursors, &request(IndexedView::Timeline), &cancel())
            .unwrap();
        let undated = page
            .buckets
            .iter()
            .find(|bucket| bucket.id == UNDATED_ID)
            .unwrap();
        assert_eq!(undated.count, 2);
        assert_eq!(undated.label_key.as_deref(), Some("views.undated"));
        assert_eq!(page.buckets.len(), 31);
        let calls = source.calls();
        let results = calls.iter().find(|query| query.sort_date.is_some()).unwrap();
        assert_eq!(results.sort_date, Some(DateField::Modified));
        assert_eq!(results.sort.direction, SortDirection::Descending);
        assert!(results.filter.as_ref().is_some_and(has_missing));
    }

    #[test]
    fn calendar_returns_one_count_per_day_of_the_local_month() {
        let source = FakeSearch::new(7, 0, 0);
        let cursors = ViewCursorStore::default();
        let page = indexed_view_page(&source, &cursors, &request(IndexedView::Calendar), &cancel())
            .unwrap();
        assert_eq!(page.buckets.len(), 30);
        assert_eq!(page.buckets[0].id, "2026-11-01");
        assert_eq!(page.buckets[29].id, "2026-11-30");
        assert!(page.buckets.iter().all(|bucket| bucket.count == 1));
    }

    #[test]
    fn by_kind_shows_all_groups_and_other_excludes_known_extensions() {
        let source = FakeSearch::new(7, 0, 0);
        let cursors = ViewCursorStore::default();
        let mut query = request(IndexedView::ByKind);
        let page = indexed_view_page(&source, &cursors, &query, &cancel()).unwrap();
        assert_eq!(page.buckets.len(), ViewKind::ALL.len());
        assert!(page.buckets.iter().all(|bucket| bucket.label_key.is_some()));
        assert!(page.results.is_empty());

        query.kind = Some(ViewKind::Other);
        indexed_view_page(&source, &cursors, &query, &cancel()).unwrap();
        let calls = source.calls();
        let results = calls.last().unwrap();
        assert!(results
            .filter
            .as_ref()
            .is_some_and(|filter| has_ext_list(filter, true)));
    }

    #[test]
    fn a_stale_generation_or_changed_query_refuses_the_cursor() {
        let source = FakeSearch::new(7, MAX_VIEW_RESULTS, 0);
        let cursors = ViewCursorStore::default();
        let page = indexed_view_page(&source, &cursors, &request(IndexedView::Timeline), &cancel())
            .unwrap();
        let cursor = page.next_cursor.expect("a full page asks for more");

        let changed_month = IndexedViewQuery {
            month: Some("2026-12".to_string()),
            cursor: Some(cursor),
            ..request(IndexedView::Timeline)
        };
        assert_eq!(
            indexed_view_page(&source, &cursors, &changed_month, &cancel()).unwrap_err(),
            "views.invalid"
        );

        let fresh = indexed_view_page(&source, &cursors, &request(IndexedView::Timeline), &cancel())
            .unwrap()
            .next_cursor
            .expect("a full page asks for more");
        source.generation.store(8, Ordering::Relaxed);
        let stale = IndexedViewQuery {
            cursor: Some(fresh),
            ..request(IndexedView::Timeline)
        };
        assert_eq!(
            indexed_view_page(&source, &cursors, &stale, &cancel()).unwrap_err(),
            "views.invalid"
        );
    }

    #[test]
    fn a_page_never_exceeds_768_kib() {
        let source = FakeSearch::new(7, MAX_VIEW_RESULTS, 6_000);
        let cursors = ViewCursorStore::default();
        let page = indexed_view_page(&source, &cursors, &request(IndexedView::Timeline), &cancel())
            .unwrap();
        let bytes = serde_json::to_vec(&page).unwrap().len();
        assert!(bytes <= MAX_VIEW_PAGE_BYTES);
        assert!(!page.complete);
        assert!(page.next_cursor.is_some());
        assert!(page.results.len() < MAX_VIEW_RESULTS);
    }

    #[test]
    fn civil_dates_round_trip_across_leap_years() {
        let days = days_from_civil(2000, 2, 29);
        assert_eq!(
            civil_from_days(days),
            CivilDate {
                year: 2000,
                month: 2,
                day: 29
            }
        );
        assert_eq!(days_in_month(1900, 2), 28);
        assert_eq!(next_day(2026, 12, 31).year, 2027);
        assert_eq!(next_day(2026, 12, 31).month, 1);
    }

    #[cfg(windows)]
    #[test]
    fn the_local_month_boundary_is_one_second_before_the_next_month() {
        let (from, to) = month_range(2026, 10).unwrap();
        let start = local_midnight_unix(2026, 11, 1).unwrap();
        assert_eq!(to + 1, start);
        assert_eq!(
            unix_to_local_date(to),
            Some(CivilDate {
                year: 2026,
                month: 10,
                day: 31
            })
        );
        assert_eq!(
            unix_to_local_date(from),
            Some(CivilDate {
                year: 2026,
                month: 10,
                day: 1
            })
        );
    }
}
