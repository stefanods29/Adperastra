# Status

The agent updates this file at the end of every step (AGENTS.md section 4).

**Current step:** `03b` (in progress), then `P2` (adopt plan v2, see `plan/steps/step-P2.md`), then `04a`.
**Last tag:** `v0.0.5-step03a`
**Next step tag:** `v0.0.6-step03b`

## Steps

States: `done`, `in progress`, `waiting for owner`, `ready` (full recipe with the code: build it by copying exactly), `guide` (precise guide without code: every decision, the order of the work and the tests are given; you write the code exactly as it describes), `outline` (not written yet: stop and tell the owner, see `plan/EXPANDING.md`).

Guides for the steps after 05a are written into `plan/steps/` (`plan/EXPANDING.md`). If the next step's file is missing or its state is `outline`, stop and tell the owner, unless the decisions log below gives you the planner role (AGENTS.md section 5, "A step without a guide").

| Step | Name | State | Tag |
|---|---|---|---|
| 00 | Plan, design inventory, contracts, Git setup | done | v0.0.1-step00 |
| 01a | Setup window and first-run pack checklist | done | v0.0.2-step01a |
| 01b | App shell, tokens, theme, languages, help, security base | done | v0.0.3-step01b |
| 02 | Browse folders, Home page, command registry | done | v0.0.4-step02 |
| 03a | Selection, Details pane, command bar, right-click menu | done | v0.0.5-step03a |
| 03b | File operations, jobs, undo, drag and drop, paste as file | in progress | v0.0.6-step03b |
| P2 | Adopt plan v2 (tools and plan files, no app changes) | ready | (none) |
| 04a | File tabs, file access, file-type handlers, image viewer | ready | v0.0.7-step04a |
| 04b | Ribbon framework, text and code viewer, Markdown viewer | ready | v0.0.8-step04b |
| 04c | Audio and video player, protected view, Open as text/hex, Default apps | ready | v0.0.9-step04c |
| 05a | View modes: List, Icons, Tiles, Content | guide | v0.0.10-step05a |
| 05b | Column view | guide | v0.0.11-step05b |
| 05c | Movable toolbars and panels, layout presets | guide | v0.0.12-step05c |
| 05d | Appearance, built-in themes, Settings page | guide | v0.0.13-step05d |
| 06a | Text editing | guide | v0.0.14-step06a |
| 06b | Version history | guide | v0.0.15-step06b |
| 06c | Templates in the New menu | guide | v0.0.16-step06c |
| 06d | Archives: open, browse, extract | guide | v0.0.17-step06d |
| 06e | Archives: create, passwords, RAR | outline | v0.0.18-step06e |
| 06f | Tables (CSV), JSON, fonts, hex search | outline | v0.0.19-step06f |
| 07a | Thumbnails, cache store, helper process, background work v1 | outline | v0.0.20-step07a |
| 07b | Quick preview and rich file info | outline | v0.0.21-step07b |
| 07c | Gallery | outline | v0.0.22-step07c |
| 07d | PDF viewer | outline | v0.0.23-step07d |
| 07e | Copy text from images and scans (OCR) | outline | v0.0.24-step07e |
| 07f | More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite | outline | v0.0.25-step07f |
| 07g | More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD | outline | v0.0.26-step07g |
| 08a | Converter 1: Quick Convert, job queue, image formats | outline | v0.0.27-step08a |
| 08b | Converter 2: PDF, documents, sheets, archives, batch presets | outline | v0.0.28-step08b |
| 08c | Privacy cleaner | outline | v0.0.29-step08c |
| 08d | First release (v0.1) | outline | v0.1.0 |
| 09a | More tabs and sessions | outline | v0.1.1-step09a |
| 09b | Tab groups and saved groups | outline | v0.1.2-step09b |
| 09c | Dragging between tabs, content between tabs, opening files from Windows | outline | v0.1.3-step09c |
| 09d | Explorer extras and the command palette | outline | v0.1.4-step09d |
| 09e | Bulk rename and batch actions | outline | v0.1.5-step09e |
| 09f | Copy window and conflict window | outline | v0.1.6-step09f |
| 09g | "What's using this file?" and the shelf | outline | v0.1.7-step09g |
| 09h | Crash recovery, report a problem, safe mode | outline | v0.1.8-step09h |
| 09i | Split view | outline | v0.1.9-step09i |
| 09j | Disk images and clipboard history | outline | v0.1.10-step09j |
| 09k | Locked folders | outline | v0.1.11-step09k |
| 10a | Themes: editor, day and night, wallpaper accent | outline | v0.1.12-step10a |
| 10b | Toolbar and keyboard customization | outline | v0.1.13-step10b |
| 10c | Tab options, date and size formats, behavior, profiles, portable mode | outline | v0.1.14-step10c |
| 10d | Folder colors, icons, backgrounds, column sets | outline | v0.1.15-step10d |
| 10e | Menu editor, Home, sidebar and status bar customization, setup files | outline | v0.1.16-step10e |
| 10f | Accessibility (v0.2) | outline | v0.2.0 |
| 11a | Search index, search modes, speed pass | outline | v0.2.1-step11a |
| 11b | Tags, smart folders, views | outline | v0.2.2-step11b |
| 11c | Storage view, duplicate finder, folder sizes | outline | v0.2.3-step11c |
| 12a | Pack manager, App storage, Background work page | outline | v0.2.4-step12a |
| 12b | Converter 3 (media, documents), privacy cleaner 2 | outline | v0.2.5-step12b |
| 13 | Accurate Office viewers (v0.3) | outline | v0.3.0 |
| 14a | PDF tools | outline | v0.3.1-step14a |
| 14b | Basic image editor | outline | v0.3.2-step14b |
| 14c | Local AI runtime and AI upscaling | outline | v0.3.3-step14c |
| 15 | Audio and video basics | outline | v0.3.4-step15 |
| 16 | Windows integration and release polish (v0.4) | outline | v0.4.0 |
| 17a | AI assistant: core, safety, models, evaluation | outline | v0.4.1-step17a |
| 17b | Local AI actions | outline | v0.4.2-step17b |
| 17c | AI search and organizing | outline | v0.4.3-step17c |
| 17d | AI for scans and PDFs, writing suggestions (v0.5) | outline | v0.5.0 |
| 18a | Advanced image editor: layers and selections | outline | v0.5.1-step18a |
| 18b | Advanced image editor: painting, filters, project format | outline | v0.5.2-step18b |
| 19a | Video timeline: tracks and clips | outline | v0.5.3-step19a |
| 19b | Video timeline: effects, audio, export | outline | v0.5.4-step19b |
| 20a | Office editing: engine spikes and integration | outline | v0.5.5-step20a |
| 20b | Word-style editing | outline | v0.5.6-step20b |
| 20c | AI for documents | outline | v0.5.7-step20c |
| 21a | Excel-style editing | outline | v0.5.8-step21a |
| 21b | AI for sheets | outline | v0.5.9-step21b |
| 22a | PowerPoint-style editing | outline | v0.5.10-step22a |
| 22b | AI for decks and the style library (v1.0) | outline | v1.0.0 |

## Owner decisions log (newest first)

- 2026-10-30: `plan/` is the only plan folder. The `adperastra-plan-*` folders were deleted, and the files Step P2 still needs (the new agent files and scripts) moved to `plan/p2-files/` until P2 puts them in place. Plan changes go directly into `plan/`, in their own `docs(plan)` commit; older entries that mention plan folders or plan updates no longer apply.
- 2026-10-30: Speed checks that are merely unreliable (timeouts that come and go, noisy numbers) do not block a step; only a result that is clearly slow for the user does. The narrow click space in the address bar with long paths is accepted. The one slow recycle + restore measurement (2.2 s) is left for later.

- 2026-10-29: Continuous work. The agent goes from step to step without waiting for the owner. When a step's checks pass and no Blocker or Major is left open, it merges the step into `testing`, puts it on `main` through a pull request once CI passes, tags it, tells the owner in one short message, and starts the next step. When something breaks, it fixes the cause itself and writes down what it changed; it stops only in the cases in AGENTS.md section 5. Publishing a GitHub release still needs the owner's yes. The owner checks finished steps afterwards, and problems they report become `F` tasks. This replaces "The owner still checks and approves every step" in the planner-role entry below.
- 2026-10-29: The coding agent also has the planner role. It builds the steps in this file's order; for every step still in `outline` it first writes the guide itself (`plan/EXPANDING.md`, into `plan/steps/` on the step branch, its own `docs(plan)` commit), then builds it. The owner still checks and approves every step. Never commit `CLAUDE.md`, `.claude/` or `.mcp.json` (excluded on purpose in `.git/info/exclude`), and commit messages never name AI tools.
- 2026-10-29: The "bzip2-1.0.6" license is allowed (`plan/rules.md` R-LIC-1). Step 06e adds bzip2 archives (`.bz2`, `.tbz`, `.tbz2`, `.tar.bz2`) and bzip2-compressed entries in zip and 7z files.
- 2026-10-29: The plan zips are kept extracted in `adperastra-plan-*` folders inside the repository folder and never committed. Step 05a is written as a guide. The planner writes the next guides into the newest plan folder (`adperastra-plan-v2.1`), and the coding agent copies them in when the owner asks (AGENTS.md section 8).
- 2026-10-29: Steps P2, 04a, 04b and 04c have full recipes with the code. From 05a on, steps are written as precise guides (every decision, the order of the work, names, types, tests; no full code), delivered in plan updates.
- 2026-10-28: Plan v2 adopted: prescriptive recipes, `scripts/gate.ps1`, generated pseudo-locale, IPC check; v1 steps 04a-10c split into smaller steps (`plan/roadmap.md` lists where every v1 feature went).
