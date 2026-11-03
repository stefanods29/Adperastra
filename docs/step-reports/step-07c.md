# Step 07c report — Photo Gallery

Date: 2026-11-03 (America/Lima). Status: local integration on `codex/integrate-handoffs`;
final packaged-app verification is pending. No remote operation, `main` change, release or tag
has been made.

## How to try it

Open `build\Adperastra\Adperastra.exe` after packaging. Choose **Gallery** in the navigation
pane, then **Add picture folder…** and pick a folder with pictures. Keep **Include subfolders**
on to include its folders. Switch the grouping between **Date taken** and **Date modified**.

## Owner checklist

1. Add two overlapping folders (one inside the other) and confirm each picture appears once.
2. Remove one folder: it must disappear from the Gallery while the folder and its pictures
   remain on disk. Restart and confirm the remaining choices persist.
3. Use the keyboard: arrows move the focus, Enter opens, Space shows the quick preview, and
   Home/End/Page keys keep the focus visible. Repeat in Spanish dark and with 200% zoom.
4. Point the Gallery at a folder with a broken picture and an unreadable subfolder: the grid
   must keep the readable pictures and show the translated partial notice with the count.
5. Add an already-existing online-only cloud placeholder folder: its pictures keep the cloud
   tile and are not downloaded by background work.
6. Confirm F1 opens **The Gallery** help page in both languages, and that the developer
   **Components** tab is still reachable and unchanged.

## What is integrated

- The Explorer location `gallery` now mounts the photo Gallery; the developer `gallery`
  `TabKind` stays as **Components** with the same session identity and demo contents.
- Up to 32 local picture folders (each path capped at 32,768 UTF-16 units), duplicate
  normalized roots refused, overlapping roots allowed and deduplicated by stable identity.
- Breadth-first, bounded background discovery: two directory workers, a 256-folder queue,
  depth 64, 250,000 discovered candidates, visited identity set, no reparse descent, and
  online-only entries visible without content access. Limits and access errors return an exact
  skipped count and reason instead of claiming complete coverage.
- Stable date ordering (modified descending, then normalized path), UTC group keys and local
  month labels; date taken falls back to modified and the grouping does not move rows under
  an active selection or pointer.
- 256-row, 768 KiB pages with generation-bound cursors; the UI virtualizes the grid and keeps
  selection/focus while pages append.
- 160 px thumbnails in 184×216 cells through the existing 07a `FileThumbnail`; quick preview
  through 07b; Enter/double-click opens through the normal file-tab pipeline.
- Settings schema 13 stores only `sources` and `date_source`. Add/Remove are the two
  `gallery.*` commands; removal never touches the file system.
- Watchers only on authorized roots while the Gallery is active, with 250 ms coalescing and
  release on close/inactive.
- English/Spanish Gallery keys and **The Gallery** help in both languages; pseudo-locale
  generated. No new external library: `notify` was already locked through `fs-service`.

## Integration corrections

- Declared the `gallery_source` module that the scan and watcher use.
- The submitted scan called a non-existent `list_dir_with_ids_cancellable`; the existing
  `fs_service::list_dir_cancellable` already uses Windows IDs and is the canonical call.
- Moved the Gallery command callbacks before the stable `actions` memo that reads them.
- Fixed two submitted test expectations that named `p0`/`p1` while the fixture list was
  `[p1, p2]`; the component behavior was correct, the expected paths were not.
- Avoided a false positive in the translation linter by comparing `top` with the cell bottom
  instead of writing a literal `<` in a TSX file, and replaced the test-only `aria-label`
  template queries with attribute lookups.

## Verification

- Focused Gallery suites: 45 tests across 4 files pass (grid/content, dates, sources, settings).
- `cargo check --workspace --all-targets`, `npm run build`, `npm run lint:i18n` (1,054 keys,
  48 help pages, 137 TSX files) and `npm run lint:ipc` (115 commands, 116 calls) pass.
- Final full gate: `GATE PASSED` with 614 Rust tests across 51 binaries and 639 UI tests
  across 114 files, translations 1,054 keys/48 help pages/137 TSX files, IPC 115 commands
  and 116 calls, and the production UI build.

## Speed and screenshots

Pending the packaged release build: `step07c.gallery.first-grid`, cached open,
selection, grid scroll and the cancellable discovery job, plus the Gallery screenshots in
English light, Spanish dark and pseudo light. No speed or screenshot value is claimed before
it is measured.

## Known issues and remaining acceptance

No Blocker or Major is open for the paths this step changes. Real cloud-placeholder, physical
folder and restart scenarios remain owner environment checks. The retained fixture manifest
and any created test folders stay outside the repository.

## Next steps

07d PDF viewer and the webview helper transport, then 08a conversion and snapshots.
