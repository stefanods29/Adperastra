# Step 04a: Open pipeline, tabs, "open with" fallback, and protected view (★★)

**Needs:** 03b. **Builds:** handler registry and open pipeline, default apps, cache store, helper-process sandboxing, protected view. **Figma frames:** all frames with open files (tab bar and navigation row behavior).

## Tasks
- **File tabs:** opening a file (double-click, Enter, "Open") creates a new file tab next to the Explorer tab and switches to it. Closing it returns to the previous tab (normally the Explorer). Middle-click or Ctrl+click opens a background tab. The Explorer tab stays alive in the background (keeps folder, selection, scroll) and shrinks to an icon-only home tab when files are open.
- **Navigation row on every tab** (as in Figma): on a file tab the breadcrumb ends in the file, Up returns to its folder in the Explorer tab, and search looks inside the file. The Explorer command bar appears only on Explorer tabs; file tabs show that file type's header row and ribbon (Step 04b) in its accent color. Switching tabs is within the Instant tier with no flicker.
- **Handler registry and open pipeline** (`contracts.md`): type detection (by content, not just extension), fast preview, mount, upgrade to editor; cancellation and priorities; prefetch on selection or hover. Each handler declares its speed tier and help page.
- **Default apps (fallback):** a file type without a handler (including types whose handler comes in a later step) opens with an app the user chooses: the first time, the Windows "Open with" choice; remembered per type; managed in Settings > Default apps. "Open as text" and "Open as hex" exist only as explicit commands.
- **Cache store v1** (SQLite + disk cache with a size limit).
- **Helper processes:** the infrastructure for running parsers and engines in separate low-privilege processes with memory and CPU limits and no network (`rules.md`, section 5). Untrusted markup is rendered only in sandboxed frames.
- **Protected view for downloaded files:** read the Windows "Mark of the Web" (the Zone.Identifier information browsers and email apps add to downloads). Such files open read-only with a yellow bar: "This file came from the internet. Editing is off to keep you safe. [Enable editing]". In protected view, never run scripts, macros, embedded content, or external links, and load remote content only if I allow it. "Enable editing" lifts the restriction for that file (optionally removing the mark, like "Unblock" in Windows Properties). A small badge on downloaded files in the Details pane and an optional right-click "Scan with Microsoft Defender". Settings: on (default), or trust specific folders. Every handler and editor added later must respect this flag.

## Help pages
Opening files in tabs; choosing apps for other file types; protected view.

## Done when
Opening a file creates a tab and closing returns to the Explorer; an unknown file type asks once which app to use and remembers it; a downloaded file opens in protected view; tab switching stays within the Instant tier.
