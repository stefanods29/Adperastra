# Step 07f integration plan — more previewers 1

Status: **integrated locally** (`9a9c7d9` deps, `c2a377f` implementation, plus the
section-count fix). The twelve declared gaps are reconciled below; the packaged-app checks,
speed runs, screenshots and the owner's checks remain evidence tasks.

## Why this needs a dedicated pass

The payload adds six read-only viewers (EPUB/MOBI book, notebook, email, subtitle, log,
SQLite), a second WebView helper (`book-helper.html`), seven new commands and settings schema
15. Its own README lists these open items:

1. `HelperAction` book variant names (`BookOpen`/`BookPage`/`BookContents`) must be checked
   against the 07d `HelperAction` enum.
2. The `foliate-js` 1.0.1 parser surface (`EPUB`, `MOBI({unzlib})`, `sections`, `toc`,
   `section.load`) must be verified against the pinned package.
3. Native OPF spine indexes and foliate section indexes must be proven equal on one fixture,
   or the page payload must carry the section href instead.
4. EPUB entry paths can exceed the 07d 255-character grant name; the handoff maps them to
   short `e0…`/`s0…` grants and keeps the map in the private payload.
5. `CacheKind` has no `book_page`/`attachment`; book pages use memory leases, so the first
   page is not disk-cached. Add a kind only if disk caching is required.
6. SQLite table names need the additive `extra_view_sqlite_tables` command.
7. `mail-parser` 0.11.9 accessors (`MimeHeaders`, `Address`, `Addr`, `ContentType`,
   `PartType`, `DateTime::to_rfc3339`) must compile-check; add an explicit 32-level depth walk
   only if the parser exposes `MessagePart::parts`.
8. The 07a/07d producer modules must be present (they are).
9. `HelperInputGrant`/`HelperInputSource` need `Clone`, or the grant list must be moved into
   the host without duplicating the type.
10. Open cancellation must pass a `CancellationToken` into
    `ExtraViewBackendFactory::open`; page cancellation is already bounded at 5 s.
11. A WebView2 helper window may only be created on Tauri's main/event-loop thread. The book
    factory must marshal start through `AppHandle::run_on_main_thread` (or 07d must do it
    internally) and wait for the result; parsing must stay off the main thread.
12. MOBI inline images exposed as data/blob URLs have no lease and are removed by the
    sanitizer; text pages work, image support needs a later private resource-grant route.

## Dependencies to record first

- `mail-parser = "=0.11.9"` (Apache-2.0 OR MIT) in `crates/data-views`.
- `rusqlite` with `bundled` and `hooks` in `crates/data-views` (already in the lock file for
  other crates; confirm the exact version and license).
- `uuid` v4 in `crates/data-views`.
- `fflate 0.8.2` (MIT) and `foliate-js 1.0.1` (MIT) in npm.
- Notices in `THIRD_PARTY_LICENSES.md`, `docs/dependency-and-license-table.md` and
  `plan/libraries.md`; one `deps:` commit before code.

## Suggested batches

1. Data parsers only (`data-views`: ansi/log/mail/markup/notebook/sqlite/subtitle) with their
   tests and the dependency commit. No UI, no commands.
2. Extra-view types/sessions/commands and settings schema 15, with the seven commands and the
   isolation allowlist.
3. Plain handlers (log, subtitle, notebook, email, SQLite) registered before Markdown/text.
4. Book helper and BookView last: prove the foliate parser surface and the main-thread start
   before copying the adapter.
5. Locales, six help pages, CSS imports, measurement rows and screenshots after the code gate.

## Gate for each batch

`cargo fmt --all`, then `.\scripts\gate.ps1`; record corrections in the step report. Never
commit failing code. Keep KI-096 closed and do not reopen it for 07f.

## Resolution of the twelve gaps

| Gap | Result |
|---|---|
| 1 `HelperAction` names | The 07d enum already carries `BookOpen`/`BookPage`/`BookContents`; the adapter compiles unchanged. |
| 2 foliate parser surface | Confirmed against pinned foliate-js 1.0.1: `EPUB` loader, `sections`, `toc`, `MOBI({unzlib})`, `section.load`. Parser-only imports; no view/renderer. |
| 3 spine index alignment | Native loader keeps HTML/XML items; foliate keeps every manifest item. `BookBackend` now refuses a differing count instead of showing the wrong chapter; four unit tests cover it. |
| 4 grant name length | Entries map to short `e<n>` grants and the entry-to-grant map stays in the private payload, as the handoff proposed. |
| 5 no `book_page` cache kind | Book pages use memory leases and are not disk-cached; no kind was fabricated. |
| 6 SQLite table discovery | Additive `extra_view_sqlite_tables` command and `sqliteTables()` service are wired and allowlisted. |
| 7 mail-parser accessors | Compile-checked and corrected: `MimeHeaders` trait methods, optional `subtype()`, `Address::Group(Vec<Group>)`, `PartType::{Html,InlineBinary,Multipart}`, and a real `PartType::Html` part instead of `body_html(0)` so plain text stays plain. |
| 8 producer modules | Present; imports use `webview_helper_types` for grants and the 06e three-value `run_archive_helper`. |
| 9 grant cloning | 07d already derives `Clone` on the grant types. |
| 10 open cancellation | The job token is checked before and after the factory open; a cancel closes the just-created session. A token parameter was not needed for the bounded 15 s open. |
| 11 book host thread | Not applicable: `start_webview_helper` spawns a child process and the WebView2 window is created in that child's own event loop. Parsing stays on the blocking job thread. |
| 12 MOBI inline images | Not implemented; recorded as KI-097 (Major) with a private resource-grant route before v0.1. |

Also recorded: `fflate` 0.8.3 replaces the guide's 0.8.2 for GHSA-px8p-9vwx-vf98; fixed
layout EPUB is not scale-to-fit (KI-098, Minor).
