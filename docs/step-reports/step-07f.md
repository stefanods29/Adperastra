# Step 07f report - More previewers 1: e-books, notebooks, email, subtitles, logs and SQLite

Dates: 2026-11-03 (America/Lima). Status: locally integrated and committed on
`integrate-handoffs`; packaged-app checks, speed runs, screenshots and the owner's
checks are still to do. No remote operation, `main` change, release or tag has been made.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

Open an `.epub`/`.mobi`/`.azw3`, an `.ipynb`, an `.eml`, an `.srt`/`.vtt`, a `.log`, or a
`.sqlite`/`.sqlite3`/`.db` file and double-click it. The book's reading settings live in the
book ribbon; the other viewers are read-only.

## Owner checklist

1. Open a two-chapter EPUB with one local picture. The table of contents lists both chapters,
   **Next**/**Previous** move within a chapter and then to the next one, the picture appears,
   and the reading font size (12-32) and theme (App/Light/Dark) change the page at once and
   are remembered when the tab is reopened.
2. Open a MOBI/AZW3 sample: the text and chapters must read correctly. Pictures inside a MOBI
   book are not shown (KI-097); text must never be blank. Confirm `..`-style or remote
   resources in a malicious EPUB never load and no script runs.
3. Open a Jupyter notebook with two code and two Markdown cells, saved text/PNG output and one
   JavaScript output. Code is shown as text and never runs; the saved picture appears; the
   JavaScript output shows the translated "cannot be displayed safely" note.
4. Open an `.eml` with plain text, HTML, a CID image, one attachment and a remote image. The
   HTML view shows no remote image (the translated note appears), **Plain text** switches
   views, the attachment is listed without being extracted, and **Open** only saves it after
   you click. A missing part shows a translated message and Retry.
5. Open an SRT and a VTT file: cues show the exact start/end times (1,250 ms shows
   `00:00:01.250`), malformed blocks are skipped with a note, and Ctrl+F finds literal text
   without running any markup.
6. Open a 100,000-line log with ANSI colors and one very long line. The first screen appears
   quickly, scrolling stays smooth, **Follow new lines** appends only new lines, and the
   oversized line is explicitly marked as shortened. Check every level label, including
   "None".
7. Open a SQLite database read-only: the table picker lists its tables, Unicode text, NULL and
   BLOB values are labelled, the integer `9007199254740993` is exact, and nothing in the
   source folder changes (no `-wal`/`-shm` appears). A database with a live `-wal` file shows
   the translated "close it in its other app" message. Confirm there is no SQL box and no
   write action.
8. Check Default apps in Settings: the six new viewers appear as their own groups, and a
   `.db` file whose content is not SQLite still opens in your chosen Windows app.
9. Repeat the main flows in Spanish dark, in the pseudo-locale, at 200 % zoom, and with only
   the keyboard (tab order, arrows, Home/End/Page, visible focus).

## What is integrated

- Six read-only lazy handlers with `editable: false`, `supportsFind: true` and their own help
  slugs, registered before the generic text/table/JSON handlers: E-book (`epub`, `mobi`,
  `azw3`), Notebook (`ipynb`), Email (`eml`), Subtitles (`srt`, `vtt`), Log (`log`) and
  SQLite (`sqlite`, `sqlite3`, `db`). `priorityExtensions` lets the specific viewer win over
  generic `text/plain`/`application/json`; `contentExtensions` keeps a `.db` that is not
  SQLite in the user's chosen app.
- A second parser-only WebView helper (`book-helper.html`, kind `Book`) on the 07d host.
  foliate-js 1.0.1 is imported parser-only (`epub.js`, `mobi.js`); no renderer, viewer,
  paginator or bundled ZIP module. Pages are app-built and shown in
  `<iframe sandbox="">` after DOMPurify; no frame ever gets `allow-scripts`.
- EPUB: the existing archive helper lists and extracts bounded entries; long entry paths are
  mapped to short grant names and the map stays in the private payload. MOBI/AZW3: a
  file-like range adapter re-reads only the requested 78-byte header/record ranges, with
  `fflate`'s streaming `Unzlib` bounded by 16 MiB/ratio 500/per-book 512 MiB and cancellation
  between pushes.
- Deterministic page building: at most 4,000 Unicode scalars or 24 block elements per page,
  splitting long paragraphs at the last whitespace; images stand alone (16 MiB decoded/4 MiB
  encoded) and are shown only through memory cache leases.
- Notebook: bounded JSON in the `--extra-viewer-helper` process; code and Markdown are text,
  outputs use an explicit MIME allowlist, and executable/widget outputs become a translated
  unsupported note. Email: `mail-parser` reads headers/bodies/attachments; remote images,
  active links/forms and `cid:` escapes are removed; attachments are metadata only until an
  explicit Open creates an app-owned copy. Subtitles: SRT/WEBVTT with exact millisecond
  checks and malformed blocks counted. Logs: ranged 1 MiB windows, 1,000-line blocks,
  ANSI stripping, UTF-8/UTF-16 line ends and explicit truncation. SQLite: read-only
  `mode=ro&immutable=1`, `query_only`, `trusted_schema=OFF`, no extension loading, a live WAL
  sidecar refused, a VM-step budget and 2 s statement limit, no writes to the source.
- Every session binds the 07a source stamp, revalidates it before each page, and closes
  through the shared job table; eight native sessions plus two book helpers, leases and
  cursors released on page change/close. Page responses stay within the 768 KiB budget and no
  file bytes travel as JSON.
- Settings schema 15 (`reading.font_px`, `reading.theme`), the book ribbon controls, English
  and Spanish text, six help pages per language and the simplified pseudo-locale.

## Not in this step (on purpose)

- No book thumbnail or cover provider (not claimed; a later optional provider can reuse the
  page/helper).
- No MOBI inline images (see KI-097), no fixed-layout scale-to-fit (KI-098), no DRM or
  encrypted books (they keep the chosen-app fallback), no notebook code execution, mail
  sending or SQL console.
- MSG files and `.drawio` diagrams stay in the user's chosen Windows app; this step adopts no
  MSG parser or diagram editor.

## Decisions and plan changes made during the step

- `fflate` is **0.8.3**, not the guide's 0.8.2: 0.8.3 fixes GHSA-px8p-9vwx-vf98 (an infinite
  loop on malformed ZIP64 data). Recorded in `plan/libraries.md`, `THIRD_PARTY_LICENSES.md`
  and `docs/dependency-and-license-table.md`, with the version correction written down.
- The handoff's gap 11 (book host must start on the main thread) does not apply: 07d's
  `start_webview_helper` only spawns a child process, and the WebView2 window is created
  inside that child's own event loop. Book parsing therefore stays on the blocking job thread
  and nothing was marshaled to the main thread.
- The native OPF loader keeps only HTML/XML spine items while foliate keeps every manifest
  item in the spine, so `BookBackend` now refuses a book whose helper and native section
  counts differ (`extra_view.unsupported`) instead of silently showing the wrong chapter.
  Four unit tests cover the count, the 5,000-section cap and the MOBI case.
- Producer APIs were reconciled as found: `mail-parser` accessors are trait methods
  (`MimeHeaders`), `subtype()` is optional, `Address::Group` holds a `Vec`, and the extra
  `PartType` variants are handled; a plain-text EML is only shown as plain text (the library's
  `body_html(0)` converts text to HTML, so the real `PartType::Html` part is used).
  `rusqlite::types::ValueRef` is the public path; `SqliteReader` has a manual `Debug` that
  never logs the connection. `run_archive_helper` returns a 3-tuple, the SQLite row cap is
  `MAX_SQLITE_ROWS_PER_PAGE`, and the helper input types live in `webview_helper_types`.
- The translation checker flagged markup-looking text in JSX; HTML fixtures moved to
  `src/__tests__/step07fFixtures.ts` and two JSX conditions were hoisted into variables.
  No check was weakened.

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| `step07f.open.book` | Fast 1 s | not measured yet | Pending |
| `step07f.open.notebook` | Fast 1 s | not measured yet | Pending |
| `step07f.open.email` | Fast 1 s | not measured yet | Pending |
| `step07f.open.subtitle` | Fast 1 s | not measured yet | Pending |
| `step07f.open.log` | Fast 1 s | not measured yet | Pending |
| `step07f.open.sqlite` | Fast 1 s | not measured yet | Pending |
| Next page (each viewer) | Fast 1 s | not measured yet | Pending |
| Row selection/controls | Instant 0.1 s | not measured yet | Pending |
| Scrolling | Smooth 16 ms | not measured yet | Pending |

Raw numbers: `docs/benchmarks/step-07f.json` (to be written with the packaged run).

## Checks by hand

The owner fills this table (or tells you the results in chat and you copy them). Until then,
every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| EPUB two chapters, TOC, image, font/theme memory | waiting | waiting | Pending |
| MOBI/AZW3 text and chapter navigation | waiting | waiting | Pending |
| Malicious EPUB resource/script never runs | waiting | waiting | Pending |
| Notebook outputs: saved PNG, unsupported note, no code run | waiting | waiting | Pending |
| Email plain/HTML toggle, CID, attachment on click, remote blocked | waiting | waiting | Pending |
| SRT/VTT exact times, malformed note, literal find | waiting | waiting | Pending |
| 100,000-line log, follow, long-line note, level labels | waiting | waiting | Pending |
| SQLite tables, NULL/BLOB, exact integer, no source change, WAL message | waiting | waiting | Pending |
| Default apps groups and non-SQLite `.db` fallback | waiting | waiting | Pending |
| Keyboard, 200 % zoom, pseudo-locale, focus outline | waiting | waiting | Pending |

## Verification

- Final full gate: `GATE PASSED` with 798 Rust tests across 51 binaries and 731 UI tests
  across 134 files, translations 1,189 keys/56 help pages/163 TSX files, IPC 136 commands and
  137 checked calls, and the production UI build.
- New Rust tests: `data-views` step07f_* suites (log, mail, notebook, SQLite, subtitle),
  `book_settings` (defaults, per-field fallback, 11/12/32 bounds), `extra_view_sessions`
  (stale stamp, idempotent close, limits, background gate, cursors), `book_loader` (path
  escapes, format detection, resource filtering, bounded attributes) and `book_backend`
  (section-count agreement, empty book, 5,000 cap).
- New UI tests: `extraViewContracts`, `step07f_book`, `step07f_email`, `step07f_handlers`,
  `step07f_active`, `step07f_notebook`, `step07f_subtitle`, `step07f_log`,
  `step07f_sqlite`, `step07f_safeMarkup`, `step07f_help`; `settings`, `defaultApps` and
  `gallerySources` were updated for schema 15 and the six additive handler groups.
- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `npm run
  lint:i18n`, `npm run lint:ipc` and `npm run build` pass.

## Screenshots

Pending the packaged release build: `docs/screenshots/step-07f/` with reservations 69-74
(book, notebook, email, subtitle, log, SQLite) in English light, Spanish dark and pseudo
light. No screenshot is claimed before it is captured.

## Known issues

- New: KI-097 (Major) MOBI inline images are not shown; KI-098 (Minor) fixed-layout EPUB
  pages are paginated like reflowable text.
- Fixed: none in this step (KI-096 stays closed).
- Still open for the touched area: none. The earlier Major issues (KI-087, KI-075, KI-069,
  KI-037, KI-033) belong to other steps and are not made worse here.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none added; the book ribbon uses the existing viewer frame, pane
  and token values, and the other five viewers reuse the table/viewer patterns.
- New dependencies: `mail-parser` 0.11.9 (Apache-2.0 OR MIT), `rusqlite` 0.41 with bundled
  SQLite (MIT; SQLite public domain) and `uuid` 1 (MIT/Apache-2.0) in `data-views`;
  `foliate-js` 1.0.1 (MIT) and `fflate` 0.8.3 (MIT) in npm. All are recorded in
  `plan/libraries.md`, `THIRD_PARTY_LICENSES.md` and
  `docs/dependency-and-license-table.md`. No new Windows feature flags were needed.

## Commits

```
9a9c7d9 deps: add extra-viewer parsers and book helper libraries [step-07f]
c2a377f feat(viewers): add e-book, notebook, email, subtitle, log and SQLite previews [step-07f]
d172086 fix(book): refuse a spine the native loader did not keep [step-07f]
```

## Next step

Step 07g: More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD (from `plan/STATUS.md`).
