# Step 02 Implementation Plan

> **For agentic workers:** Native (inline) execution in this session, task by task, TDD per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Browse real folders at Fast tier: Rust FS service + command registry + Home page matching the Figma Explorer frame.

**Architecture:** New `crates/fs-service` crate (pure, unit-tested) behind the contract-8 interface; `src-tauri` holds only thin validated Tauri commands; TS holds a typed service wrapper, the command registry, and the Explorer UI with a virtualized Details list.

**Tech Stack:** Rust (`std::fs`, `windows` crate, `notify`), Tauri 2 Channels, React + `@tanstack/react-virtual`, i18next ICU.

**Spec:** `plan/steps/step-02.md`; contracts `ARCHITECTURE.md` rows 7-8; owner decisions 2026-10-28 (see Global Constraints).

## Global Constraints

- One step, sliced internally; branch `step-02-browse-folders` from `testing`; tag `v0.0.4-step02` at the end. Conventional Commits with `[step-02]`; dependencies in their own `deps:` commits with license noted.
- Icons: Figma file-type tiles now. Real Windows shell icons in 07a for `.exe`/`.lnk`/types without a tile; icon-style choice (tiles vs Windows icons, icon packs) in 10a.
- Favorites on Home: empty placeholder in this step. Gallery and Network: translated placeholder states.
- Pinned folders and own recent-folder history in a separate `explorer-state.json` (not `settings.json`).
- All user-visible text from locale files (EN/ES + pseudo check); i18n lint must pass. No hardcoded UI text.
- Speed: Rust bench and end-to-end (open folder -> first rows painted) both reported against the Fast tier (1 s) for a 100,000-item folder; skeleton within 0.1 s.
- Slow/sleeping/disconnected drives never block the UI: per-drive async load with timeout, "still loading" / "not available" states.
- `watch(path)` now (`notify`): current folder and nav pane update live; events coalesced/batched; watching stops on leaving a folder. This PC drive list updates on drive add/remove.
- Tests: `cargo test --workspace` (with `CARGO_TARGET_DIR=%TEMP%\adperastra-target`), `npm test`, `npm run lint:i18n`, `npm run build`.

## Review Focus

- Online-only placeholders: shown with cloud icon, never read by background work.
- Long paths (>260 chars), reserved names, link loops: never crash, never recurse forever.
- A drive that disappears mid-listing: job ends cleanly with a report, UI does not freeze.
- 100k-item burst of watcher events: coalesced, capped, falls back to one rescan event.
- Paths from the UI are never trusted: canonicalized and length-limited in Rust.

---

### Slice 1: fs-service crate core

**Files:** Create `crates/fs-service/{Cargo.toml,src/lib.rs,src/item.rs,src/sort.rs,src/list.rs,src/watch.rs,src/state.rs}`; modify workspace `Cargo.toml`.

**Interfaces:**
- Produces: `Item { path, name, kind, size, modified_unix, attrs { hidden, system, is_link, online_only, file_id } }`, `ItemKind`, `SortKey/SortDirection`, `list_dir(path, sort) -> Result<Listing>`, `stat_path`, `read_range` (capped), `validate_new_name`, `natural_cmp`, `sort_items`, `FsWatcher { watch(path), unwatch(), drain_batched() }`, `ExplorerState { pinned_folders, recent_folders }` with atomic save/load.
- Consumes: nothing from later slices.

- [x] Tests first (RED): natural sort (`file2 < file10`, case-insensitive), folders-first sort, reserved-name rejection, state round-trip + pin/recent dedup, watcher coalescing, list/stat/read_range on a temp dir, online-only flag false for a normal file.
- [x] Implement minimal crate to pass (GREEN); `cargo test -p fs-service` -> 10/10 passed (9 core + 1 live watcher).
- [x] Commit: `feat(fs): add fs-service crate core (list, sort, watch, state) [step-02]` (+ separate `deps:` commit for `notify`). Commits 1756a3f (plan/ADR), da10212 (deps), a6f24ad (feat).

### Slice 2: Tauri commands, known folders, drives, watch wiring

**Files:** Modify `src-tauri/src/main.rs` (or a new `explorer.rs` module), `src-tauri/Cargo.toml`, `src-tauri/isolation/index.html`, `src-tauri/capabilities/main.json` if needed.

**Interfaces:**
- Produces Tauri commands: `list_dir_start` (Channel batches + request id), `list_dir_cancel`, `fs_stat`, `explorer_state_get/pin/unpin/record_recent`, `list_known_folders`, `list_drives` (fast, metadata-free), `drive_info` (async, timeout), `watch_start/watch_stop` (batched events via Channel), `drives_changed` polling/event source.

- [x] Tests first: command validation (empty/overlong path rejected, non-main window rejected).
- [x] Implement; drive enumeration never waits on a sleeping drive (label/free-space fetched per drive; UI applies the timeout, see Slice 4). Ruling: This PC updates by polling list_drives (cheap logical-drive bitmask, 2 s in the UI) instead of WM_DEVICECHANGE - one mechanism, no window-proc plumbing.
- [x] Watch: one watcher for the open folder (nav pane items do not change when files inside pinned folders change; drives update by polling); polling drain every 250 ms, coalesce, cap with rescan fallback; watch_start replaces and stops the previous watcher.
- [x] Commit per logical unit.

### Slice 3: TS service + command registry

**Files:** Create `src/services/explorer.ts`, `src/commands/registry.ts`, `src/commands/explorerCommands.ts`; tests in `src/__tests__/`.

**Interfaces:**
- Produces: TS mirrors of `Item/Listing/DriveInfo/ExplorerState`; `Command { id, labelKey, icon, shortcut?, risk, helpSlug, enabledWhen(ctx), run(ctx) }`; commands Back, Forward, Up, Refresh, Open, Go to path, Pin/Unpin; navigation history reducer (back/forward stacks).

- [x] Tests first: registry shape (every command has label key/icon/risk/help), enabled-when rules, history reducer.
- [x] Implement; commit.

### Slice 4: Explorer UI

**Files:** Rewrite `src/views/ExplorerHome.tsx`; create `src/views/explorer/{NavPane,AddressBar,FileList,HomePage,DriveList}.tsx` as needed; styles in `src/styles/components.css`; add `@tanstack/react-virtual` (`deps:` commit, MIT).

- [x] Virtualized Details list (Name, Date modified, Type, Size), natural sort via Rust order, column-header sorting, locale-aware formatting, Figma tiles, cloud icon for online-only, skeleton rows after 0.1 s.
- [x] Editable breadcrumb (segment jump, sibling chevron menu, click-empty-space path typing, history dropdown, This PC root), search box filtering filenames in the current folder.
- [x] Nav pane: Home, Gallery placeholder, pinned known folders with pin icons, This PC drives (live add/remove, still-loading/not-available states), Network placeholder. Pin/Unpin for current folder.
- [x] Live updates from watch events without losing selection/scroll; double-click folder navigates; files do not open yet (04a).
- [x] Tests + `npm run build`; commit per unit.

### Slice 5: Home page, help, i18n

**Files:** `src/i18n/locales/{en,es}.json`, `help/en/*.md`, `help/es/*.md`.

- [x] Home: collapsible Quick access cards (pinned folders), Recent (Windows Recent items + own history, existing only, newest first), Favorites empty placeholder; Gallery placeholder page.
- [x] Help pages EN+ES: browsing folders, Home page, pinning folders, address bar; F1/`?` wiring for Explorer contexts.
- [x] i18n lint, pseudo-locale run; commit.

### Slice 6: Benchmarks, screenshots, step report

**Files:** `scripts/generate-corpus.ps1`, `crates/fs-service/src/bin/fs-bench.rs`, `docs/benchmarks/*.json`, `docs/screenshots/step-02/`, `docs/step-reports/step-02.md`, `CHANGELOG.md`, `KNOWN_ISSUES.md`, `DESIGN_DEVIATIONS.md` if needed.

- [x] Generate 100,000-item folder in `%TEMP%` (nothing large committed); Rust bench: enumerate+sort total and first-batch time.
- [x] End-to-end: instrument folder-open -> first rows painted (performance marks in the Explorer view, read from the running app), report both numbers vs Fast tier in the step report table.
- [x] Screenshots vs `plan/design/screens/01-explorer-home.png` at 100%/150%, light/dark, EN/ES.
- [ ] Full suite on `testing` after merge; step report; tag `v0.0.4-step02` after owner approval.