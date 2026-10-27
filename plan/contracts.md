# Integration contracts

These are the plug-in points every feature builds on. Design all of them in Step 00 (in `ARCHITECTURE.md`, with interface sketches), build each one in the step shown, and extend them instead of replacing them. If a feature needs something no contract offers, stop and propose a contract change first.

| Contract | What it does | Built in |
|---|---|---|
| Setup window + dependency manifest | A tiny native launcher reads a signed manifest of required components (pinned versions, sources, sizes, checksums), checks them in milliseconds, installs or repairs only what's missing, then starts the main app; hosts the first-run choices, including the optional-pack checklist | 01a (pack downloads wired in 12a) |
| Design tokens + theme engine | Tokens measured from Figma become CSS variables; themes are token overrides; per-file-type accent tokens; theme adapters restyle third-party parts | 01b |
| Settings + i18n | One JSON settings file with a schema and migrations; translation files with ICU messages; runtime language switch; locale-aware formatting | 01b |
| Help system | Offline help center opened in a tab; one page per feature per language (`help/<lang>/<feature>.md`), searchable; F1 opens the page for the current context; "?" buttons in panels and dialogs link to their page; a "What's new" page per release | 01b (every step adds pages) |
| Security base | Tauri capabilities per webview, strict Content Security Policy, isolation pattern, validated commands, sandboxed frames for untrusted content, low-privilege helper processes (see `rules.md`) | 01b (helper processes from 04a) |
| Crash capture | Local panic and crash handler with logs and minidumps (never uploaded), session file saved every few seconds | 01b (recovery UI in 09c) |
| Command registry | Every action is a command (id, label key, icon, shortcut, enabled-when rule, risk level, help page, run). Command bar, menus, ribbons, shortcuts, drag and drop, the command palette, and the AI assistant are all just callers of it | 02 |
| File-system service (Rust) | List, stat, watch, and read ranges; all disk access; streamed and cancellable; handles the edge cases in `rules.md` (long paths, links, placeholders, permissions) | 02 |
| Menus from commands | Right-click menus, command bar, and ribbons are built from command lists, so they can later be edited by the user | 03a (editor in 10b) |
| Job runner + background scheduler | Background jobs with progress, cancel, pause, retry, logs, and priority (foreground, normal, background); runs external engines in helper processes; powers file operations, conversions, indexing, scans, and pack installs; one queue UI; background tasks obey the Background work settings | 03b (settings v1 in 07a, full page in 12a) |
| Undo stack | One app-wide undo/redo history for file and tab operations, shared by Ctrl+Z, undo toasts, "Recent actions", and the assistant's action log | 03b |
| Drag-and-drop service | One system for every drag: files, tabs, and content (text, cells, images) between Explorer tabs, file tabs, tab groups, the shelf, and other apps, resolved to commands | 03b (tabs in 09a) |
| Handler registry + open pipeline | File types register a handler: type detection, thumbnail, metadata, viewer (lazy), editor (lazy), ribbon, conversions, help page, speed tier. The pipeline is: detect, fast preview, mount, upgrade to editor, with cancel, priorities, and prefetch | 04a |
| Default apps | For file types without a handler, opens the app the user chose (remembered per type); manages "Open with" and Settings > Default apps | 04a |
| Cache store | SQLite metadata plus a disk cache (oldest removed first) for thumbnails, first-page renders, metadata, and OCR text, keyed by path, size, modified time, and handler version; sizes reported to App storage | 04a (filled from 07a) |
| Ribbon framework | Data-driven ribbons and toolbars (tabs, groups, controls bound to commands or engine state); themed, translated, keyboard accessible, key tips; dockable on any side | 04b (docking in 05) |
| Layout engine | Layout as JSON data; docking of bars and panels; presets; default preset follows the Figma layout | 05 |
| View modes | Details, List, Icons, Tiles, Content, Column view, and later views (Timeline, Calendar...) as pluggable views over the same item source | 05 (more in 11b) |
| Version store | Automatic local snapshots of files before the app, the converter, or AI features change them; browse, compare, restore; space limits | 06b (used by every editor) |
| Archive service | Browse, preview, extract, and create archives (with passwords) as if they were folders | 06c |
| Metadata service | Type-specific information (EXIF, media info, document properties) for the Details pane, columns, search, and tags | 07a |
| OCR service | Text recognition for images and scanned PDFs, cached, used by viewers, search, and AI | 07b |
| Converter registry | Converters declare inputs, outputs, and options; the UI is generated from them; they run through the job runner | 08a |
| Privacy cleaner (optional, off unless asked) | Per-format "remove hidden information" operations, usable from Share, Convert, Properties, batch presets, and the assistant | 08b (Office and media in 12b) |
| Release pipeline | GitHub Actions build of the installer and portable zip, SHA-256 checksums, release notes from the changelog, draft release for my approval | 08c (polished in 16) |
| Tab sessions | Tabs, groups, split views, and their state saved and restored; saved groups | 09a |
| Encrypted containers | Locked folders using reviewed encryption | 09e |
| Setup files | Export and import of themes, layouts, menus, and other customizations as one file | 10b |
| Index service | File-name index, content index, and metadata index, updated by the file watcher; used by search, views, tags, storage tools, and AI | 11a |
| Search modes | Pluggable search modes (Name, Content, Filters, Regex, and AI modes) sharing one result list and saved searches | 11a (AI modes in 17c) |
| Tag store | Tags and colors for files and folders, kept when files are renamed or moved, usable in search, views, Home, and the assistant | 11b |
| Pack manager + App storage manager | Optional packs: manifest, sizes, checksum and signature checks, install, update, remove, offline installer; App storage page listing packs, caches, indexes, and history with sizes and clear buttons | 12a |
| Engine adapters | Wrappers mapping our commands and ribbon state to an engine (FFmpeg, the LibreOffice-based Office engine) | 12b (Office editing in 20a) |
| Local AI runtime | Runs local models in a helper process with GPU or CPU, memory limits, idle unload, and cancel; models install as packs | 14c |
| AI evaluation harness | Test sets and automatic scoring for every AI feature, in English and Spanish, run by the test suite | 17a |
| Assistant tools | The typed tool list the assistant may call, generated from the command registry with risk levels and permissions | 17a |
