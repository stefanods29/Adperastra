# Step 03a Implementation Plan

> Native (inline) execution, slice by slice, tests first where the logic is pure. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Selecting files feels like Windows 11 (click, Ctrl/Shift, keyboard, type-ahead, F2 and one-step rename), and every action is reachable from a Figma-style command bar, a right-click menu, and a Details pane, all built from the command registry.

**Architecture:** A pure TypeScript selection model feeds a richer `CommandContext` (contract 7). Menus are data (`MenuDef`, contract 9) drawn by one renderer used for the right-click menu, the command bar dropdowns, and the overflow menu. Rust adds thin validated commands for item details, rename, and Windows shell actions (open, open with, properties, share, terminal). The classic Windows menu ("Show more options") runs in a separate helper process so a slow or crashing shell extension can never freeze or crash the app.

**Spec:** `plan/steps/step-03a.md`; contracts `ARCHITECTURE.md` rows 7 and 9; design approved by the owner on 2026-10-28 (preview shown in chat, recorded in `DESIGN_DEVIATIONS.md`).

## Global Constraints

- Branch `step-03a-selection-details-menus` from `testing`; tag `v0.0.5-step03a`. Conventional Commits with `[step-03a]`; dependencies and new `windows` crate features in their own `deps:` commits.
- Owner decisions 2026-10-28: Step 02 approved and closed first; the 03a design preview is approved; Cut, Copy, Paste, Delete, and New are shown disabled until Step 03b, and the List and icon views are shown disabled until Step 05 (logged in KNOWN_ISSUES.md); rename works now and its Undo arrives with the undo stack in 03b (approved Major deferral); "Show more options" opens the real classic Windows menu in a separate process.
- Rename never overwrites: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`, so an existing target fails with a clear message.
- Item details come from `GetFileAttributesExW` (no file open), so selecting an online-only file never downloads it.
- Opening a file uses the Windows default app until the open pipeline (Step 04a).
- All user-visible text from locale files (EN/ES + pseudo); i18n lint must pass.
- Speed: selection, menus, the Details pane basics, and type-ahead are Instant tier (0.1 s); measured in the packaged app.

## Review Focus

- A slow, hung, or crashing shell extension never blocks or crashes the app (helper process + timeout).
- Paths and names from the UI are validated in Rust; rename stays inside the item's own folder.
- Settings v2 files migrate to v3 without losing language or theme.
- Online-only placeholders are never read by details or selection.

---

### Slice 1: Rust commands and data

- [ ] Settings schema v3: `explorer { show_hidden, show_extensions, item_checkboxes, details_pane, group_by }` with a v2 migration (Rust + TS).
- [ ] Explorer state v2: `favorites` list (add/remove), v1 files still load.
- [ ] `item_details(path)`: created/modified/accessed times and attributes via `GetFileAttributesExW`.
- [ ] `rename_item(path, new_name)`: validated name, same folder, no overwrite, case-only renames allowed.
- [ ] Shell actions: `open_item`, `open_with_dialog`, `show_properties`, `open_in_terminal` (Windows Terminal, PowerShell fallback).
- [ ] Isolation allowlist updated; tests for validation, rename, details, migrations.

### Slice 2: Selection model and the file list

- [ ] `selection.ts` (pure): click, Ctrl, Shift ranges, select all/none/invert, keyboard focus moves, type-ahead, summary (count and size).
- [ ] FileList: multi-select, keyboard, type-ahead, item checkboxes, hidden filter, extension toggle, group by; Home lists use the same rows.
- [ ] Status bar: item count, selection count, and size.

### Slice 3: Menus from commands, command bar, right-click menu

- [ ] `MenuDef` + one `Menu` renderer (keyboard, submenus, checks, shortcuts, viewport clamping).
- [ ] Command bar as approved (New, Cut/Copy/Paste/Rename/Share/Delete, Sort, View, overflow, Details toggle), collapsing into the overflow menu when narrow; tooltips with shortcuts.
- [ ] Right-click menus for items and empty space; Context-menu key and Shift+F10.

### Slice 4: Details pane, rename, favorites

- [ ] Details pane (single, multiple, nothing selected), instant from listing data, extra fields filled from `item_details`.
- [ ] Inline rename (F2, one-step click), name-only selection, instant validation, error bubble.
- [ ] Add to / remove from favorites; Home Favorites list.

### Slice 5: Share and the classic menu

- [ ] Share sheet through `IDataTransferManagerInterop`.
- [ ] "Show more options": helper mode of the app executable, menu at the click point, timeout and cancel, keeps running while a dialog it opened is visible.

### Slice 6: Help, records, verification

- [ ] Help pages (EN/ES): selecting files, the Details pane, the command bar, the right-click menu; favorites added to the Home page help.
- [ ] KNOWN_ISSUES, DESIGN_DEVIATIONS, CHANGELOG, ADR 0006.
- [ ] Speed numbers in the packaged app; screenshots next to the Figma frame; step report; plan review.
