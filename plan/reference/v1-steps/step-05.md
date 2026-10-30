# Step 05: Layout engine and customization, round 1 (★★)

**Needs:** 04b. **Builds:** layout engine, docking, presets, view modes.

## Tasks
- **Toolbar position:** the Explorer command bar and all file ribbons can be docked Top (default, as in Figma), Bottom, Left, or Right. On the sides they become a vertical strip (icons with optional labels, groups open as flyouts, overflow in •••). Show me the side and bottom designs for approval first (`design.md`, rule 7).
- **Panels:** tab bar top, bottom, or vertical on the left or right (collapsible); navigation pane left, right, or hidden; Details pane right, bottom, or hidden. Toolbar modes: full, compact, collapsed/auto-hide, icon-only.
- **View modes as a customizable option:** Details, List, Icons (small, medium, large, extra large), Tiles, Content, and **Column view** (macOS Finder-style "Miller columns": each folder opens in a new column to the right, with a preview of the selected file in the last column). Each view mode can be enabled or hidden in Settings > Views, set as the default, remembered per folder, and reordered in the View menu. Column view supports keyboard arrows, type-ahead, and drag and drop like the other views, and stays virtualized for large folders.
- **Appearance:** UI scale (75-200%), density (compact, comfortable, spacious), corner radius, animation level (full, reduced, off), and at least 6 built-in themes (the Figma theme as default, plus Light, Dark, AMOLED black, High contrast, and one more), designed and shown to me first.
- **Settings page:** searchable, with live preview, reset to default, and import/export of the settings file; each section links to its help page.
- **Layout presets:** "Adperastra" (the Figma layout, default), "Minimal", and "Office classic", plus user-saved presets. Layouts are data (JSON) so free drag-and-drop docking can be added later without a rewrite.

## Parts to consider
dockview or FlexLayout (MIT) for movable panels.

## Help pages
Moving toolbars and panels; view modes and Column view; themes and appearance; layout presets; the Settings page.

## Done when
I can move the toolbar to any side and it applies to the Explorer and file tabs; Column view works with keyboard and drag and drop; themes and presets switch within the Fast tier; everything survives a restart.
