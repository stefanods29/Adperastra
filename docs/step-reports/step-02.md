# Step 02 report - Browse folders, Home page, and the command registry

Dates: 2026-10-28. Status: implemented on branch `step-02-browse-folders`, awaiting owner approval. Proposed tag after approval: `v0.0.4-step02`.

## Owner decisions and additions (all implemented)

- One step sliced internally; Figma file-type tiles now, real Windows shell icons for `.exe`/`.lnk`/types without a tile in 07a, icon-style choice in 10a (ADR 0005).
- Favorites on Home is an empty placeholder; Gallery and Network are translated placeholder states.
- Pinned folders and own recent-folder history in a separate `explorer-state.json`.
- **Addition 1:** `watch(path)` implemented now (notify crate): the open folder updates live (verified: creating a file in Documents moved the count 57 -> 58 without a manual refresh), events coalesced/batched at 250 ms with a rescan cap, watching stops on leaving the folder.
- **Addition 2:** end-to-end folder-open time measured in the packaged app, not only the Rust benchmark (see Speed).
- **Addition 3:** This PC updates when drives change (logical-drive polling every 2 s, which never touches a sleeping drive); per-drive label/space loads asynchronously with a 3 s timeout and "still loading" / "not available" states.
- **File-ID ruling reversed (owner change 1):** listings enumerate with `GetFileInformationByHandleEx` (`FileIdExtdDirectoryInfo`, fallback `FileIdBothDirectoryInfo`), returning file IDs, attributes including recall-on-data-access bits, sizes and times from the directory handle - no per-file opens, online-only files never woken. `file_id_stable` is true only for NTFS/ReFS on local drives; FAT/exFAT and network drives fall back to path keys (ADR 0005).

## How to build and run

```powershell
.\scripts\package-app.ps1
.\build\Adperastra\Adperastra.exe        # or AdperastraSetup.exe
$env:CARGO_TARGET_DIR="$env:TEMP\adperastra-target"; cargo test --workspace
npm test; npm run lint:i18n; npm run build
.\scripts\generate-corpus.ps1            # 100k-item test folder in %TEMP%
.\scripts\measure-folder-open.ps1        # end-to-end first-rows timing
```

App data for this step: `%LOCALAPPDATA%\Adperastra` (settings/session) plus the new `explorer-state.json` there.

## What works

- Browse drives and folders with Back/Forward/Up/Refresh, pin/unpin, type a path, breadcrumb segment jumps, sibling-folder chevron menus, history dropdown, Ctrl+L / Alt+D to edit the path.
- Virtualized Details list (Name, Date modified, Type, Size), natural sort, column sorting, folder-scoped name filtering, Figma type tiles, hidden/link/online-only badges, skeleton rows, "still loading" after 1 s and a timeout state after 15 s that never blocks the UI.
- Home: collapsible Quick access (Windows known folders with Windows-language names, plus pinned folders), Recent (Windows Recent shortcuts resolved, missing targets skipped, merged with our visited folders, with sizes), Favorites placeholder.
- This PC: drive cards with label, used-space bar and free/total, live on plug/unplug.
- Command registry v1: Back, Forward, Up, Refresh, Open, Go to path, Pin/Unpin - each with label key, icon, shortcut, enabled-when rule, risk level and help page.
- Help: four new pages per language (browsing folders, Home page, pinning folders, address bar); F1 in Explorer opens Browsing folders; the folder "?" opens the same, Home's "?" opens the Home page.

## What deliberately does not work yet

- Double-clicking a **file** does nothing yet - opening files is Step 04a. The Gallery and Network pages are placeholders (07a / later). Right-click menus, the command bar, multi-select and file operations are Steps 03a/03b. Opening the 100k corpus folder shows folders first, then files, exactly like Windows Explorer grouping.

## Speed (development PC in docs/benchmarks/MACHINE.md)

| Interaction | Tier | Measured | Result |
|---|---|---|---|
| Open 100,100-item folder, first rows painted (end-to-end, packaged app) | Fast 1 s | 358-458 ms, median 383 ms (4 runs, scripts/measure-folder-open.ps1) | Pass |
| Rust enumerate + sort 100,100 items with file IDs | Fast 1 s | 97-107 ms median (fs-bench, release) | Pass |
| Clicks, nav buttons, search filtering, tab focus | Instant 0.1 s | immediate in manual use; filtering is local over loaded items | Pass (manual) |
| Scrolling a 100k list | Smooth 16 ms/frame | ~30 rows in the DOM at any time (TanStack Virtual) | Pass (by construction) |

Raw numbers: `docs/benchmarks/2026-10-28-folder-listing-step02.json`, `docs/benchmarks/2026-10-28-folder-open-e2e-step02.json`. Note the end-to-end number was 1.11-1.26 s before poll responses were capped at 8 batches; that fix is commit `05d9545`.

## Verification

- `cargo test --workspace`: 47 tests pass (fs-service 12 incl. a live watcher test and file-ID enumeration on NTFS; app 20 incl. command validation and poll draining; setup suites unchanged). `cargo clippy --workspace --all-targets` clean, `cargo fmt --check` clean.
- `npm test`: 25/25 (command registry, navigation history, path helpers, tile/format helpers, ExplorerHome and AddressBar render tests). `npm run build` passes; `npm run lint:i18n` passes (134 keys, EN/ES parity, no hardcoded text found).
- Packaged app driven by UI automation: Home renders real data; Documents lists 57 items; a file created externally appears (58) via watch; This PC shows C: with 147.7 GB free of 909.1 GB; Spanish UI verified; pseudo-locale run done (stretching reveals no missing keys; tab label ellipsizes).
- Screenshots next to the Figma frame (`plan/design/screens/01-explorer-home.png`): `docs/screenshots/step-02/` - 01/02 dark from Slice 4, 03 Home EN light, 04 folder EN light, 05 This PC EN light, 06 Home ES light, 07 Home pseudo light. Structure matches the frame (nav pane, command area replaced by the address row until 03a, Quick access grid 3 columns, Recent|Favorites pills, Name/Date/Type/Size columns). Remaining visual differences are logged in DESIGN_DEVIATIONS.md.

## Findings fixed inside the step (worth knowing)

- Tauri `Channel` batches never reached the frontend under the isolation pattern (probe: Rust listed 57 items, sends succeeded, JS received 0). Transport changed to start/poll invoke commands for lists and Tauri events for watch - both already allowed by the isolation hook. ADR 0005 records the ruling.
- First end-to-end measurement (1.11-1.26 s) showed the first poll was delivering all 196 batches in one IPC response; capping polls at 8 batches (4,096 items) makes first paint independent of folder size.
- An early screenshot caught the Home blocks missing after a refactor; a render regression test (explorerHome.test.tsx) now pins them.

## Known issues

New: KI-009 (Minor) - a pinned folder renamed/deleted outside the app stays stale in the nav pane until unpinned or restarted; target 07a.
Open from before: KI-001/KI-002 (Minor, one-time start costs), KI-003 (Major, after-reboot cold start still unmeasured - owner runs scripts\measure-startup.ps1 after a reboot; due before v0.1), KI-004 (Minor, placeholder icon), KI-005 (Minor, snap flyout visual confirmation).

## Design deviations and licenses

DESIGN_DEVIATIONS.md: two new entries (Explorer folder view/This PC designed from tokens, pending approval here; file-type tiles instead of shell icons, owner-approved 2026-10-28).
Dependencies added, each in its own `deps:` commit with license: `notify` 8.2.1 (CC0-1.0), `windows` 0.61 features for fs-service (MIT/Apache-2.0), `@tanstack/react-virtual` 3.14.23 (MIT). THIRD_PARTY_LICENSES.md and docs/dependency-and-license-table.md updated. No file over 50 MB committed; the 100k corpus lives in %TEMP%.

## Commits (branch step-02-browse-folders, from testing cb33be6)

1756a3f plan+ADR, da10212 deps notify, a6f24ad fs-service core, 6430288 plan check-off, d208bae/084c234 deps windows, 0052b05 file-ID enumeration, 9d1ddea fs bench, 7f61fd5 deps fs-service wiring, a6cd41c fmt, 5f46b91 Tauri backend, 02c54be TS service+registry, 7def98e deps TanStack Virtual, 754af76 Channel transport fix, 65b0bba Explorer UI, 47e0556 Home+help, 040981f Ctrl+L/Alt+D, 05d9545 poll cap, 641b09f recent sizes, 300e4bd bench scripts+screenshots, c106e3c fmt, plus this report's docs commit.

## Proposal for the next step

Step 03a (selection, Details pane, command bar, right-click menu) on top of the registry: menus and the command bar are generated from the same commands registered here, selection context extends `CommandContext`, and KI-009's stale-pin verification can ride along if you want it earlier than 07a. After your approval I will merge to `testing`, run the full local suite there, and only then open the PR to `main` and tag `v0.0.4-step02`.