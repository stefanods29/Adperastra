# ADR 0005: Step 02 Explorer scope decisions

Status: accepted (Step 02, owner decisions 2026-10-28).

## Decision

- **Icons:** Step 02 uses the Figma file-type tiles. In Step 07a, add real
  Windows shell icons for `.exe`, `.lnk`, and any type without a tile. In
  Step 10a, let the user choose the icon style (Figma tiles or Windows
  icons) as part of icon packs.
- **Favorites:** the Home "Recent | Favorites" switch shows an empty
  placeholder for Favorites in Step 02. Star/favourite for files arrives
  with selection (03a) or later; pins are not silently reused as favorites.
- **Gallery / Network:** translated placeholder states in Step 02
  (Gallery is built in 07a).
- **Explorer state:** pinned folders and our own recent-folder history live
  in a separate `explorer-state.json` beside `settings.json` (schema v1,
  atomic write), not inside the settings file.
- **Clarification (final review):** "the navigation pane updates live" means the open folder's view, the pin/unpin state, and the This PC drive list update live. Changes *inside* a pinned folder do not alter the nav pane (its entries are folder names, not contents), so pinned folders' contents are not watched; a pinned folder itself being renamed externally is KI-009.
- **Watching:** `watch(path)` is implemented in Step 02 with the `notify`
  crate (8.2.1, CC0-1.0). The open folder and navigation pane update live;
  events are coalesced and batched; watching stops when leaving a folder.
  Bursts over the cap collapse to one rescan event.
- **Drives:** This PC updates when drives are added or removed. Per-drive
  details load asynchronously with a timeout; slow, sleeping, or
  disconnected drives show "still loading" / "not available" and never
  block the UI (plan/rules.md section 6).
- **Speed proof:** besides the Rust folder-listing benchmark, Step 02
  measures end-to-end time from opening a folder to the first rows painted
  on screen for a 100,000-item folder, and reports both against the Fast
  tier (1 s).

## Ruling recorded during Slice 1 (superseded below)

The stable Windows file ID (`Item.attrs.file_id`) is `None` in listing
results: `std` exposes it only through an unstable API, and opening every
file during a listing would be slow and could wake online-only files.

## Amendment (owner change 1, 2026-10-28): file IDs from the enumeration

That ruling is superseded. Listing now uses
`GetFileInformationByHandleEx` on the directory handle with
`FileIdExtdDirectoryInfo`, falling back to `FileIdBothDirectoryInfo`
(Microsoft Learn: `nf-winbase-getfileinformationbyhandleex`,
`ns-winbase-file_id_extd_dir_info`, `ns-winbase-file_id_both_dir_info`),
which returns file IDs, attributes (including recall-on-data-access
bits), sizes, and times in the same enumeration - no per-file opens and
online-only files are never woken. If either class reports a >64-bit ID
the 64-bit class is used instead of truncating; if the fast enumeration
is unavailable on a volume, listing falls back to the `std` path with no
IDs.

Benchmark on the generated 100,100-item folder (release build, 9 runs,
median): enumeration 97.2 ms vs `std` 101.8 ms, with 100,100/100,100 file
IDs filled - so the enumeration stays as `list_dir` and `list_dir_std`
is kept only for comparison. Raw numbers:
`docs/benchmarks/2026-10-28-folder-listing-step02.json`.

Stability: `Item.attrs.file_id_stable` is true only for NTFS/ReFS on a
local drive. On FAT/FAT32/exFAT (IDs derive from directory-entry offsets
and can change, per the Microsoft remarks above) and on network drives,
it is false and consumers (tags, Step 11b) must fall back to the path.
## Amendment (Slice 4 finding): IPC transport for streamed data

Tauri `Channel` messages never reached the frontend in this app
(Rust listed 57 items, channel sends reported no error, the JS handler
received 0) - the isolation pattern (plan/rules.md section 5) is the
suspected boundary. Streamed listings therefore use plain invoke
commands the isolation hook already allows: `list_dir_start` runs the
listing on a blocking thread and `list_dir_poll` drains queued batches
of 512 until done, with `list_dir_cancel` setting the token. Folder
watch uses Tauri events (`watch-events`), the same transport the
open-help flow already proved in Step 01b. If a later Tauri version or a
different webview layout makes Channel reliable, this can be revisited;
the service interface (`startListDir` handle with completion promise)
will not need to change.