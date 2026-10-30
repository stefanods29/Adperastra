# UI kit: existing components and when to use them

Use these before writing anything new. Import from `src/components/<Name>`. All take translated strings (call `t()` before passing text) unless the prop name ends in `Key`.

| Component | Props | Use it for |
|---|---|---|
| `Button` | `variant?: "primary" \| "default" \| "subtle"`, plus normal button props | Any text button. `primary` uses the current accent (one per dialog or bar: Save, Share, Convert, Extract) |
| `IconButton` | `icon`, `labelKey`, `onClick`, `disabled?`, `pressed?`, `shortcut?`, `keyTip?`, `showKeyTip?`, `className?` | Icon-only buttons in bars; it adds the translated tooltip and `aria-label` from `labelKey` |
| `SplitButton` | `label`, `onClick`, `items: {id,label,disabled?}[]`, `onSelect`, `variant?`, `disabled?` | A main action with a small menu of variants ("Save a copy ▾", "Extract ▾") |
| `DropdownMenu` | `label?`, `ariaLabel`, `icon?`, `items`, `onSelect`, `disabled?` | Simple choice lists not backed by commands (for example the "+" new tab menu) |
| `Menu` | `entries: MenuEntry[]`, `ctx`, `lookup`, `anchor`, `onRun`, `onClose`, `ariaLabel`, `focusFirst?`, `nested?` | Every menu backed by commands (right-click menus, command-bar dropdowns, ribbon dropdowns). Entries are data from `src/commands/menus.ts` |
| `Dialog` | `title`, `onClose`, `children` | Every modal dialog. Escape and clicking outside close it. Put buttons in a `<div className="adp-dialog-actions">` at the end of `children` |
| `Toast` / `ToastStack` | `toasts: {id, message, showUndo?, shortcutHint?}[]`, `onDismiss`, `onUndo?` | Undo toasts and short notices. 8 s, pauses on hover |
| `ProgressBar` | `value?` (0-100; omit for indeterminate), `label?` | Job progress, loading of large files |
| `Skeleton` | `variant?: "rows" \| "tiles"`, `count?` | Anything not ready within 0.1 s. Viewers that need another shape add a CSS class next to it (recipes say which) |
| `Tooltip` | `label`, `shortcut?`, `placement?`, `children` | Tooltips on custom controls (IconButton already has one) |
| `Switch` | `checked`, `onChange`, `label?`, `disabled?` | On/off settings |
| `Slider` | `value`, `min`, `max`, `onChange`, `label?`, `disabled?` | Zoom, sizes, quality |
| `TextInput` | `value`, `onChange`, `placeholder?`, `ariaLabel?`, `type?`, `disabled?` | Text fields in dialogs and settings |
| `SearchBox` | `value`, `onChange`, `placeholder?` | Search fields in bars and panels |
| `Breadcrumb` | `segments: {id,label}[]`, `onNavigate` | Paths inside things (archive folders, PDF outline paths) |
| `ListRow` | `icon`, `name`, `meta?`, `selected?`, `onClick?` | Simple lists in panels (version list, recent actions) |
| `NavItem` | `icon`, `label`, `active?`, `pinned?`, `onClick?`, `dropPath?`, `dropName?` | Navigation pane entries; `dropPath` makes it a drop target |
| `HelpButton` | `onOpenHelp` | The "?" button at the end of a bar, panel, or dialog title |
| `KeyTip` | `letter`, `visible?` | Alt key-tip badges (the ribbon uses it) |
| `ToolbarDock` (Step 05c, `src/layout/ToolbarDock.tsx`) | `toolbar`, `children`, `contentClassName?` | Every toolbar (command bar, ribbons, later editors' toolbars): places it on the side and in the style the layout chooses, with auto-hide and the toolbar right-click menu. A toolbar reads `ToolbarLayoutContext` (`src/layout/toolbarLayout.ts`) to draw itself horizontally or vertically |
| `TabStrip` (Step 05c, `src/layout/TabStrip.tsx`) | `tabs`, `activeId`, `side`, `collapsed`, `label`, `onActivate`, `onClose`, `onNewTab`, `onToggleCollapsed` | The only place that draws tabs (row at the top or bottom, column on a side) |
| `Flyout` (Step 05c, `src/layout/Flyout.tsx`) | `icon`, `label`, `opensTo`, `children` | A small panel opened by an icon button, for controls that do not fit (ribbon lists in an icons-only side column) |
| `VersionHistoryDialog` (Step 06b, `src/versions/VersionHistoryDialog.tsx`) | `path`, `name`, `currentModified`, `currentSize`, `versionsEnabled`, `hasUnsavedChanges?`, `onOpenCopy`, `onRestored`, `onShowWindowsVersions`, `onClose` | The version history of one file, from any place that shows a file (Explorer, editors) |
| `UnsavedDialog` (Step 06a, `src/views/UnsavedDialog.tsx`) | `names`, `onSave`, `onDontSave`, `onCancel` | Asking before unsaved changes are lost; usually through `useUnsavedChanges` |
| Theme preview (Step 05d) | an element with `data-theme-preview="<id>"` | Draws its children with that theme's tokens (the theme cards in Settings use it) |
| Settings sections (Step 05d) | `src/views/settings/*Settings.tsx` + a row in `src/views/settings/sections.ts` | Every settings section: a `section.adp-settings-section` with an `h3` and a `HelpButton`; the page adds search, the section list and the reset button |
| `Tooltip` placements | `placement?: "above" \| "below" \| "right" \| "left"` | `right` and `left` (Step 05c) for vertical toolbars; use `tooltipPlacement(layout)` inside toolbars |

## Explorer parts (reuse, do not copy)

| Part | File | Notes |
|---|---|---|
| File list (Details view) | `src/views/explorer/FileList.tsx` | Virtualized rows, selection, keyboard, type-ahead, rename box. View modes (Step 05a) add sibling components that take the same props |
| Item views (Step 05a) | `src/views/explorer/views/ItemView.tsx` | Shows a folder in the chosen view: `FileList` (Details), `FileGrid` (icons, Tiles, Content), `ListModeView` (List), `ColumnView` (Columns, Step 05b, needs `columnOptions`). A new view takes `ItemViewProps` and uses `useItemInteractions` (`src/views/explorer/views/useItemInteractions.ts`) so selection, keyboard, rename and menus behave the same |
| Column view parts (Step 05b) | `src/views/explorer/views/ColumnPane.tsx`, `ColumnRow.tsx`, `ColumnPreview.tsx` | One column of any role (`parent`, `active`, `child`), keyed by folder so it keeps its rows when its role changes; the row content; the file preview column (Step 07b adds real previews there) |
| Command bar | `src/views/explorer/CommandBar.tsx` | Built from `BarEntry[]` data; collapses into "See more" |
| Details pane | `src/views/explorer/DetailsPane.tsx` | Sections are added by later steps (preview, metadata, versions, privacy) |
| Address bar | `src/views/explorer/AddressBar.tsx` | Breadcrumb with typing; file tabs reuse it read-only (Step 04a) |
| Rename box | `src/views/explorer/RenameInput.tsx` | Inline rename with validation |
| File operation dialogs | `src/views/explorer/FileOpDialogs.tsx` | Conflict and permanent-delete dialogs |
| Jobs panel | `src/views/explorer/JobsPanel.tsx` | Progress card for running jobs. From 06d any job joins it through ExplorerHome's `trackJob` (`TrackJobOptions`: verb key, count, `start`, `outcome`, and `reasonArea` for translating skipped reasons under `errors.<area>.*`); conversions (08a) reuse it |
| Archive tab parts (Step 06d) | `src/handlers/archive/` | `ArchiveView` shows the Explorer's `FileList` (Details) fed with items that are not on disk (`toExplorerItem`), a `Breadcrumb` path bar and notes; a model for other folder-like viewers |
| File-type tiles | `src/views/explorer/fileTile.ts` | Colored type tiles and their accent per extension |

## Layout values to reuse (from `plan/design-spec.md`)

| Thing | Value |
|---|---|
| Tab bar height | 40 px |
| Address row height | 56 px |
| Command bar / viewer toolbar height | 48 px |
| Navigation pane width | 196 px, items 184 x 36 |
| File rows | 28 px |
| Status bar height | 28 px |
| Office-style header row | 40 px; ribbon tab row 34 px; ribbon body 112 px |
| Properties panel (image editor, side panels) | 300 px wide |
| Default corner radius | 4 px (`--adp-radius-sm`); cards 8 px (`--adp-radius-lg`); window 10 px |
| Font | Inter, body 12 px, commands 13 px |
| Icons | Lucide, 16 px in bars and menus, stroke 1.4 if set explicitly |
