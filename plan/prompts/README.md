# Prompts for all54 coding steps

Give one AI one step prompt below and access to this repository. Each prompt points to its complete guide, repeats exact dependencies/tasks, fixes file ownership and requires a review handoff. Workers write code and tests only; they do not compile, run tests, install, generate, launch, download or call APIs. The coordinator performs future integration and executed checks.

Use separate writable checkouts. Shared/existing-file edits are proposals for coordinator integration; read [OWNERSHIP.md](../parallel/OWNERSHIP.md). Code writing can overlap across steps; integration stays in roadmap order. These prompts do not dispatch workers automatically. [Contract index](../parallel/CONTRACT-INDEX.md), [guide hashes](../parallel/GUIDE-MANIFEST.json), [guide status](../GUIDE_STATUS.md) and [review record](../parallel/FINAL-REVIEW.md).

All AI steps and full22b are included. The assistant supports Local AI or API key, with Meta first among API providers. No automatic cloud fallback; explicit payload consent and native credentials apply. Some tasks have genuine engine/Windows/pack evidence gates, specified in the guides.

- **07a** — [Thumbnails, cache store, helper process, background work v1](step-07a.md) (8 tasks; [guide](../steps/step-07a.md)).
- **07b** — [Quick preview and rich file info](step-07b.md) (7 tasks; [guide](../steps/step-07b.md)).
- **07c** — [Gallery](step-07c.md) (7 tasks; [guide](../steps/step-07c.md)).
- **07d** — [PDF viewer](step-07d.md) (7 tasks; [guide](../steps/step-07d.md)).
- **07e** — [Copy text from images and scans (OCR)](step-07e.md) (6 tasks; [guide](../steps/step-07e.md)).
- **07f** — [More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite](step-07f.md) (8 tasks; [guide](../steps/step-07f.md)).
- **07g** — [More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD](step-07g.md) (7 tasks; [guide](../steps/step-07g.md)).
- **08a** — [Converter 1: Quick Convert, job queue, image formats](step-08a.md) (8 tasks; [guide](../steps/step-08a.md)).
- **08b** — [Converter 2: PDF, documents, sheets, archives, batch presets](step-08b.md) (7 tasks; [guide](../steps/step-08b.md)).
- **08c** — [Privacy cleaner](step-08c.md) (7 tasks; [guide](../steps/step-08c.md)).
- **08d** — [First release (v0.1)](step-08d.md) (7 tasks; [guide](../steps/step-08d.md)).
- **09a** — [More tabs and sessions](step-09a.md) (7 tasks; [guide](../steps/step-09a.md)).
- **09b** — [Tab groups and saved groups](step-09b.md) (6 tasks; [guide](../steps/step-09b.md)).
- **09c** — [Dragging between tabs, content between tabs, opening files from Windows](step-09c.md) (6 tasks; [guide](../steps/step-09c.md)).
- **09d** — [Explorer extras and the command palette](step-09d.md) (6 tasks; [guide](../steps/step-09d.md)).
- **09e** — [Bulk rename and batch actions](step-09e.md) (7 tasks; [guide](../steps/step-09e.md)).
- **09f** — [Copy window and conflict window](step-09f.md) (7 tasks; [guide](../steps/step-09f.md)).
- **09g** — ["What's using this file?" and the shelf](step-09g.md) (6 tasks; [guide](../steps/step-09g.md)).
- **09h** — [Crash recovery, report a problem, safe mode](step-09h.md) (7 tasks; [guide](../steps/step-09h.md)).
- **09i** — [Split view](step-09i.md) (6 tasks; [guide](../steps/step-09i.md)).
- **09j** — [Disk images and clipboard history](step-09j.md) (7 tasks; [guide](../steps/step-09j.md)).
- **09k** — [Locked folders](step-09k.md) (8 tasks; [guide](../steps/step-09k.md)).
- **10a** — [Themes: editor, day and night, wallpaper accent](step-10a.md) (6 tasks; [guide](../steps/step-10a.md)).
- **10b** — [Toolbar and keyboard customization](step-10b.md) (6 tasks; [guide](../steps/step-10b.md)).
- **10c** — [Tab options, date and size formats, behavior, profiles, portable mode](step-10c.md) (7 tasks; [guide](../steps/step-10c.md)).
- **10d** — [Folder colors, icons, backgrounds, column sets](step-10d.md) (6 tasks; [guide](../steps/step-10d.md)).
- **10e** — [Menu editor, Home, sidebar and status bar customization, setup files](step-10e.md) (7 tasks; [guide](../steps/step-10e.md)).
- **10f** — [Accessibility (v0.2)](step-10f.md) (6 tasks; [guide](../steps/step-10f.md)).
- **11a** — [Search index, search modes, speed pass](step-11a.md) (8 tasks; [guide](../steps/step-11a.md)).
- **11b** — [Tags, smart folders, views](step-11b.md) (7 tasks; [guide](../steps/step-11b.md)).
- **11c** — [Storage view, duplicate finder, folder sizes](step-11c.md) (7 tasks; [guide](../steps/step-11c.md)).
- **12a** — [Pack manager, App storage, Background work page](step-12a.md) (7 tasks; [guide](../steps/step-12a.md)).
- **12b** — [Converter 3 (media, documents), privacy cleaner 2](step-12b.md) (7 tasks; [guide](../steps/step-12b.md)).
- **13** — [Accurate Office viewers (v0.3)](step-13.md) (7 tasks; [guide](../steps/step-13.md)).
- **14a** — [PDF tools](step-14a.md) (7 tasks; [guide](../steps/step-14a.md)).
- **14b** — [Basic image editor](step-14b.md) (7 tasks; [guide](../steps/step-14b.md)).
- **14c** — [Local AI runtime and AI upscaling](step-14c.md) (7 tasks; [guide](../steps/step-14c.md)).
- **15** — [Audio and video basics](step-15.md) (6 tasks; [guide](../steps/step-15.md)).
- **16** — [Windows integration and release polish (v0.4)](step-16.md) (7 tasks; [guide](../steps/step-16.md)).
- **17a** — [AI assistant: core, safety, models, evaluation](step-17a.md) (9 tasks; [guide](../steps/step-17a.md)).
- **17b** — [Local AI actions](step-17b.md) (9 tasks; [guide](../steps/step-17b.md)).
- **17c** — [AI search and organizing](step-17c.md) (8 tasks; [guide](../steps/step-17c.md)).
- **17d** — [AI for scans and PDFs, writing suggestions (v0.5)](step-17d.md) (8 tasks; [guide](../steps/step-17d.md)).
- **18a** — [Advanced image editor: layers and selections](step-18a.md) (7 tasks; [guide](../steps/step-18a.md)).
- **18b** — [Advanced image editor: painting, filters, project format](step-18b.md) (7 tasks; [guide](../steps/step-18b.md)).
- **19a** — [Video timeline: tracks and clips](step-19a.md) (7 tasks; [guide](../steps/step-19a.md)).
- **19b** — [Video timeline: effects, audio, export](step-19b.md) (7 tasks; [guide](../steps/step-19b.md)).
- **20a** — [Office editing: engine spikes and integration](step-20a.md) (8 tasks; [guide](../steps/step-20a.md)).
- **20b** — [Word-style editing](step-20b.md) (8 tasks; [guide](../steps/step-20b.md)).
- **20c** — [AI for documents](step-20c.md) (8 tasks; [guide](../steps/step-20c.md)).
- **21a** — [Excel-style editing](step-21a.md) (8 tasks; [guide](../steps/step-21a.md)).
- **21b** — [AI for sheets](step-21b.md) (8 tasks; [guide](../steps/step-21b.md)).
- **22a** — [PowerPoint-style editing](step-22a.md) (9 tasks; [guide](../steps/step-22a.md)).
- **22b** — [AI for decks and the style library (v1.0)](step-22b.md) (15 tasks; [guide](../steps/step-22b.md)).

This packet stops at guides and prompts. No future feature is marked implemented or tested.
