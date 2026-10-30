# Roadmap

Difficulty: ★ very easy ... ★★★★★ very hard. Each step depends only on earlier steps. Every step ends with a merge to `main` and a tag, without waiting for the owner, who checks it afterwards (AGENTS.md section 4).

Tags: steps get `v0.<milestone>.<n>-step<id>` (for example `v0.0.7-step04a`); a milestone release gets `v0.1.0`, `v0.2.0`, ... After a milestone, numbering continues from it (the step after `v0.1.0` is `v0.1.1-step09a`).

## Milestones

| Version | After step | What users get |
|---|---|---|
| v0.1 | 08d | Fast explorer with tabs, file operations with undo, viewers for most files, text editing, version history, archives, PDF viewer, OCR, converter, privacy cleaner |
| v0.2 | 10f | More tabs and tab groups, command palette, bulk rename, copy window, shelf, split view, locked folders, full customization, accessibility |
| v0.3 | 13 | Search modes, tags, views, storage tools, optional packs, App storage, media and document conversion, Office viewing |
| v0.4 | 16 | PDF and image editing, AI upscaling, audio/video basics, Windows integration |
| v0.5 | 17d | Optional offline AI assistant and AI features |
| v1.0 | 22b | Advanced image editor, video timeline, Word-, Excel- and PowerPoint-style editing |

## Steps

| Step | Name | ★ | Needs | Builds (contracts) | State |
|---|---|---|---|---|---|
| 00-03b | Plan, setup window, app shell, browsing, selection and menus, file operations | ★-★★ | | 1-12, 37 | done |
| P2 | Adopt plan v2 | ★ | 03b | gate script, IPC check, pseudo generator | ready |
| 04a | File tabs, file access, file-type handlers, image viewer | ★★ | P2 | 13 handler registry + open pipeline, file access protocol | ready |
| 04b | Ribbon framework, text and code viewer, Markdown viewer | ★★ | 04a | 16 ribbon framework | ready |
| 04c | Audio and video player, protected view, Open as text/hex, Default apps | ★★ | 04b | 14 default apps, Mark of the Web | ready |
| 05a | View modes: List, Icons, Tiles, Content | ★★ | 04c | 18 view modes | guide |
| 05b | Column view | ★★★ | 05a | 18 | guide |
| 05c | Movable toolbars and panels, layout presets | ★★★ | 05b | 17 layout engine | guide |
| 05d | Appearance, built-in themes, Settings page | ★★ | 05c | 2 themes | guide |
| 06a | Text editing | ★★ | 05d | 19 version hook (no-op) | guide |
| 06b | Version history | ★★★ | 06a | 19 version store | guide |
| 06c | Templates in the New menu | ★★ | 06b | templates | guide |
| 06d | Archives: open, browse, extract | ★★★ | 06c | 20 archive service, generic job table, first helper process | guide |
| 06e | Archives: create, passwords, RAR | ★★★ | 06d | 20 | outline |
| 06f | Tables (CSV), JSON, fonts, hex search | ★★ | 06e | handlers | outline |
| 07a | Thumbnails, cache store, helper process, background work v1 | ★★★ | 06f | 15 cache store, helper processes | outline |
| 07b | Quick preview and rich file info | ★★★ | 07a | 21 metadata service | outline |
| 07c | Gallery | ★★ | 07b | | outline |
| 07d | PDF viewer | ★★★ | 07c | PDF engine | outline |
| 07e | Copy text from images and scans (OCR) | ★★★ | 07d | 22 OCR service | outline |
| 07f | More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite | ★★★ | 07e | handlers | outline |
| 07g | More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD | ★★★ | 07f | handlers | outline |
| 08a | Converter 1: Quick Convert, job queue, image formats | ★★★ | 07g | 23 converter registry | outline |
| 08b | Converter 2: PDF, documents, sheets, archives, batch presets | ★★★ | 08a | 23 | outline |
| 08c | Privacy cleaner | ★★★ | 08b | 24 privacy cleaner | outline |
| 08d | First release (v0.1) | ★★ | 08c | 25 release pipeline | outline |
| 09a | More tabs and sessions | ★★★ | 08d | 26 tab sessions | outline |
| 09b | Tab groups and saved groups | ★★★ | 09a | 26 | outline |
| 09c | Dragging between tabs, content between tabs, opening files from Windows | ★★★ | 09b | 12 (tabs, content) | outline |
| 09d | Explorer extras and the command palette | ★★★ | 09c | palette | outline |
| 09e | Bulk rename and batch actions | ★★★ | 09d | | outline |
| 09f | Copy window and conflict window | ★★★ | 09e | 10 (pause, verify, queue) | outline |
| 09g | "What's using this file?" and the shelf | ★★★ | 09f | shelf | outline |
| 09h | Crash recovery, report a problem, safe mode | ★★★ | 09g | 6 recovery UI | outline |
| 09i | Split view | ★★★ | 09h | split view | outline |
| 09j | Disk images and clipboard history | ★★★ | 09i | | outline |
| 09k | Locked folders | ★★★★ | 09j | 27 encrypted containers | outline |
| 10a | Themes: editor, day and night, wallpaper accent | ★★★ | 09k | theme editor | outline |
| 10b | Toolbar and keyboard customization | ★★★ | 10a | shortcut maps | outline |
| 10c | Tab options, date and size formats, behavior, profiles, portable mode | ★★★ | 10b | profiles | outline |
| 10d | Folder colors, icons, backgrounds, column sets | ★★★ | 10c | folder customization | outline |
| 10e | Menu editor, Home, sidebar and status bar customization, setup files | ★★★ | 10d | 28 setup files | outline |
| 10f | Accessibility (v0.2) | ★★★ | 10e | accessibility settings | outline |
| 11a | Search index, search modes, speed pass | ★★★★ | 10f | 29, 30 | outline |
| 11b | Tags, smart folders, views | ★★★ | 11a | 31 | outline |
| 11c | Storage view, duplicate finder, folder sizes | ★★★ | 11a | storage scanner | outline |
| 12a | Pack manager, App storage, Background work page | ★★★★ | 11c | 32 | outline |
| 12b | Converter 3 (media, documents), privacy cleaner 2 | ★★★★ | 12a | 33 engine adapters | outline |
| 13 | Accurate Office viewers (v0.3) | ★★★★ | 12b | | outline |
| 14a | PDF tools | ★★★★ | 13 | PDF edit mode | outline |
| 14b | Basic image editor | ★★★★ | 14a | image edit mode | outline |
| 14c | Local AI runtime and AI upscaling | ★★★★ | 14b | 34 | outline |
| 15 | Audio and video basics | ★★★★ | 14c | media edit mode | outline |
| 16 | Windows integration and release polish (v0.4) | ★★★★ | 15 | shell integration | outline |
| 17a | AI assistant: core, safety, models, evaluation | ★★★★ | 16 | 35, 36 | outline |
| 17b | Local AI actions | ★★★★ | 17a | | outline |
| 17c | AI search and organizing | ★★★★ | 17b | embeddings index | outline |
| 17d | AI for scans and PDFs, writing suggestions (v0.5) | ★★★★ | 17c | | outline |
| 18a | Advanced image editor: layers and selections | ★★★★★ | 17d | | outline |
| 18b | Advanced image editor: painting, filters, project format | ★★★★★ | 18a | | outline |
| 19a | Video timeline: tracks and clips | ★★★★★ | 18b | | outline |
| 19b | Video timeline: effects, audio, export | ★★★★★ | 19a | | outline |
| 20a | Office editing: engine spikes and integration | ★★★★★ | 19b | Office engine adapter | outline |
| 20b | Word-style editing | ★★★★★ | 20a | | outline |
| 20c | AI for documents | ★★★★ | 20b | | outline |
| 21a | Excel-style editing | ★★★★★ | 20c | | outline |
| 21b | AI for sheets | ★★★★ | 21a | | outline |
| 22a | PowerPoint-style editing | ★★★★★ | 21b | | outline |
| 22b | AI for decks and the style library (v1.0) | ★★★★ | 22a | | outline |

## Where the v1 plan's features went

Nothing from the v1 plan was dropped. Moves:

| v1 step | Feature | Now in |
|---|---|---|
| 04a | File tabs, open pipeline, handler registry | 04a |
| 04a | Default apps fallback and Settings > Default apps | 04a (fallback), 04c (settings page) |
| 04a | Protected view (Mark of the Web) | 04c |
| 04a | Cache store, helper processes | 07a (first used there) |
| 04b | Ribbon framework, text/code, Markdown | 04b |
| 04b | Images | 04a |
| 04b | Audio and video player, file-open benchmark | 04c |
| 05 | View modes | 05a; Column view 05b |
| 05 | Toolbar/panel positions, toolbar modes, layout presets | 05c |
| 05 | Appearance, themes, Settings page | 05d |
| 06a | Text editing | 06a; templates 06c |
| 06b | Version history | 06b |
| 06c | Archives | 06d (read: zip, 7z, tar, gzip, xz), 06e (create, passwords, RAR through the user's 7-Zip, bzip2) |
| 06c | CSV, JSON, hex, basic fonts | 06f (full font preview moved here from v1 07c); the hex viewer itself arrives in 04c (Open as hex), 06f adds search and Go to offset |
| 07a | Thumbnails, background work v1 | 07a; quick preview and rich info 07b; Gallery 07c |
| 07b | PDF viewer, OCR | 07d, 07e |
| 07c | More previewers | 07f, 07g (draw.io files open in the user's chosen app; fonts in 06f) |
| 08a | Converter | 08a (images), 08b (PDF, documents, sheets, archives, presets) |
| 08b | Privacy cleaner | 08c |
| 08c | First release | 08d |
| 09a | Explorer extras | 09d |
| 09a | More tabs, sessions | 09a; groups 09b; drag between tabs and content 09c; single instance 09c |
| 09b | Command palette | 09d; bulk rename and batch actions 09e |
| 09c | Copy window, conflicts | 09f; "What's using this file?" and shelf 09g; crash recovery 09h |
| 09d | Split view | 09i; disk images and clipboard history 09j; Open in Terminal was finished in 03a |
| 09e | Locked folders | 09k |
| 10a | Theme editor, day/night, accents | 10a; toolbars and keyboard 10b; tab options, formats, behavior, profiles 10c |
| 10b | Folders, backgrounds, column sets | 10d; menus, Home, sidebar, status bar, setups 10e |
| 10c | Accessibility | 10f |
| 06b | "Previous versions" from Windows | 06b (opens Windows' own Properties sheet, which has the Previous Versions tab) |
| 03a/16 | "Show more options", Share | finished in 03a |
