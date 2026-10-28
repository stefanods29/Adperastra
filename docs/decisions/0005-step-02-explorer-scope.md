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

## Ruling recorded during Slice 1

The stable Windows file ID (`Item.attrs.file_id`) is `None` in listing
results: `std` exposes it only through an unstable API, and opening every
file during a listing would be slow and could wake online-only files. The
Slice 2 `stat` command (foreground, one file) fills it in via
`GetFileInformationByHandle`. Cost if wrong: tags (11b) need the ID at
listing time, which would then need a cached handle-free lookup.