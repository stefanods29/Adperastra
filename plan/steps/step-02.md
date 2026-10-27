# Step 02: Browse folders, Home page, and the command registry (★)

**Needs:** 01b. **Builds:** file-system service, command registry. **Figma frames:** File Explorer · Light.

## Tasks
- **Explorer tab layout** from the Figma frame. Functional reference: the Windows 11 File Explorer.
  - Navigation row: Back, Forward, Up, Refresh; an editable breadcrumb address bar (click a segment to jump, click a chevron to list sibling folders, click empty space to type a path, history dropdown, "This PC" root icon); a search box on the right scoped to the current folder ("Search in <folder>"; filename filtering works now, full search arrives in Step 11a).
  - Navigation pane: Home, Gallery (placeholder until Step 07a), pinned folders with pin icons (Desktop, Downloads, Documents, Pictures, Music, Videos, plus my own), This PC with drives, Network. System folder names come from the Windows known-folder APIs so they appear in the user's Windows language. No OneDrive entry.
  - File area: a virtualized, streamed Details list (Name, Date modified, Type, Size) with system icons, column sorting (natural sort order, locale-aware dates, numbers, and sizes), and double-click to enter folders.
- **Home page** (opens by default): the collapsible "Quick access" grid of folder cards, the "Recent | Favorites" switch, and the recent-files list (from the Windows recent-items list plus our own history). Clicking a card or pinned folder opens it in the same tab.
- **Command registry v1** with Back, Forward, Up, Refresh, Open, Go to path, Pin/Unpin. From now on every action is a registered command (with label key, icon, shortcut, enabled-when rule, risk level, and help page).
- **File-system service** in Rust: all disk access off the UI thread, streamed and cancellable, handling the edge cases in `rules.md` section 6 (long paths, reserved names, links, slow drives, online-only placeholders shown with a cloud icon and never read in the background).
- Benchmark harness for folder listing and scrolling (`speed.md`).

## Parts to consider
`windows` crate (MIT/Apache-2.0) for shell APIs (icons, known folders); `walkdir`, `notify`, `rayon`, `tokio`; TanStack Virtual (MIT).

## Help pages
Browsing folders; the Home page; pinning folders; the address bar.

## Done when
I can browse drives and folders, go back/forward/up, type a path, and pin folders; a 100,000-item folder shows its first rows within the Fast tier and scrolls smoothly; the Home page matches the Figma frame.
