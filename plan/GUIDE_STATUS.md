# Guide and prompt delivery status

Scope: all 54 remaining steps 07a–22b, including seven AI-only steps and the full AI/manual 22b. Owner scope update 2026-11-02 supersedes the earlier non-AI-only packet. This is guide authoring/review, not implementation completion.

Every external coding worker gets one prompt from `plan/prompts/` and its complete guide. Workers write code/tests only; coordinator later executes compilation, installation, generators, tests, packaging, screenshots and benchmarks. The present assignment ends after guides/prompts/review; no application feature is implemented here.

## Reserved counters

Application settings remain schema11. Future settings/screenshot values below are reservations in implementation order, not current application versions. Tags remain the original roadmap tags. Only the coordinator changes these counters and all affected guides together.

| Step | Scope | Full guide | Review | Settings in -> out | Reserved screenshot numbers |
|---|---|---|---|---|---|
| 07a | Thumbnails, cache store, helper process, background work v1 | [step-07a.md](steps/step-07a.md) | reviewed | 11 -> 12 | 57-58 |
| 07b | Quick preview and rich file info | [step-07b.md](steps/step-07b.md) | reviewed | 12 -> 12 | 59-61 |
| 07c | Gallery | [step-07c.md](steps/step-07c.md) | reviewed | 12 -> 13 | 62-63 |
| 07d | PDF viewer | [step-07d.md](steps/step-07d.md) | reviewed | 13 -> 13 | 64-66 |
| 07e | Copy text from images and scans (OCR) | [step-07e.md](steps/step-07e.md) | reviewed | 13 -> 14 | 67-68 |
| 07f | More previewers 1: e-books, notebooks, email, subtitles, logs, SQLite | [step-07f.md](steps/step-07f.md) | reviewed | 14 -> 15 | 69-74 |
| 07g | More previewers 2: 3D models, camera RAW, HEIC/AVIF, PSD | [step-07g.md](steps/step-07g.md) | reviewed | 15 -> 15 | 75-78 |
| 08a | Converter 1: Quick Convert, job queue, image formats | [step-08a.md](steps/step-08a.md) | reviewed | 15 -> 16 | 79-81 |
| 08b | Converter 2: PDF, documents, sheets, archives, batch presets | [step-08b.md](steps/step-08b.md) | reviewed | 16 -> 17 | 82-84 |
| 08c | Privacy cleaner | [step-08c.md](steps/step-08c.md) | reviewed | 17 -> 18 | 85-87 |
| 08d | First release (v0.1) | [step-08d.md](steps/step-08d.md) | reviewed | 18 -> 19 | 88-90 |
| 09a | More tabs and sessions | [step-09a.md](steps/step-09a.md) | reviewed | 19 -> 20 | 91-92 |
| 09b | Tab groups and saved groups | [step-09b.md](steps/step-09b.md) | reviewed | 20 -> 20 | 93-94 |
| 09c | Dragging between tabs, content between tabs, opening files from Windows | [step-09c.md](steps/step-09c.md) | reviewed | 20 -> 21 | 95-96 |
| 09d | Explorer extras and the command palette | [step-09d.md](steps/step-09d.md) | reviewed | 21 -> 22 | 97-98 |
| 09e | Bulk rename and batch actions | [step-09e.md](steps/step-09e.md) | reviewed | 22 -> 22 | 99-100 |
| 09f | Copy window and conflict window | [step-09f.md](steps/step-09f.md) | reviewed | 22 -> 23 | 101-103 |
| 09g | "What's using this file?" and the shelf | [step-09g.md](steps/step-09g.md) | reviewed | 23 -> 24 | 104-105 |
| 09h | Crash recovery, report a problem, safe mode | [step-09h.md](steps/step-09h.md) | reviewed | 24 -> 25 | 106-107 |
| 09i | Split view | [step-09i.md](steps/step-09i.md) | reviewed | 25 -> 25 | 108-109 |
| 09j | Disk images and clipboard history | [step-09j.md](steps/step-09j.md) | reviewed | 25 -> 26 | 110-111 |
| 09k | Locked folders | [step-09k.md](steps/step-09k.md) | reviewed | 26 -> 27 | 112-113 |
| 10a | Themes: editor, day and night, wallpaper accent | [step-10a.md](steps/step-10a.md) | reviewed | 27 -> 28 | 114-116 |
| 10b | Toolbar and keyboard customization | [step-10b.md](steps/step-10b.md) | reviewed | 28 -> 29 | 117-118 |
| 10c | Tab options, date and size formats, behavior, profiles, portable mode | [step-10c.md](steps/step-10c.md) | reviewed | 29 -> 30 | 119-121 |
| 10d | Folder colors, icons, backgrounds, column sets | [step-10d.md](steps/step-10d.md) | reviewed | 30 -> 31 | 122-123 |
| 10e | Menu editor, Home, sidebar and status bar customization, setup files | [step-10e.md](steps/step-10e.md) | reviewed | 31 -> 32 | 124-127 |
| 10f | Accessibility (v0.2) | [step-10f.md](steps/step-10f.md) | reviewed | 32 -> 33 | 128-130 |
| 11a | Search index, search modes, speed pass | [step-11a.md](steps/step-11a.md) | reviewed | 33 -> 34 | 131-133 |
| 11b | Tags, smart folders, views | [step-11b.md](steps/step-11b.md) | reviewed | 34 -> 35 | 134-137 |
| 11c | Storage view, duplicate finder, folder sizes | [step-11c.md](steps/step-11c.md) | reviewed | 35 -> 36 | 138-140 |
| 12a | Pack manager, App storage, Background work page | [step-12a.md](steps/step-12a.md) | reviewed | 36 -> 37 | 141-143 |
| 12b | Converter 3 (media, documents), privacy cleaner 2 | [step-12b.md](steps/step-12b.md) | reviewed | 37 -> 37 | 144-146 |
| 13 | Accurate Office viewers (v0.3) | [step-13.md](steps/step-13.md) | reviewed | 37 -> 38 | 147-149 |
| 14a | PDF tools | [step-14a.md](steps/step-14a.md) | reviewed | 38 -> 39 | 150-152 |
| 14b | Basic image editor | [step-14b.md](steps/step-14b.md) | reviewed | 39 -> 40 | 153-155 |
| 14c | Local AI runtime and AI upscaling | [step-14c.md](steps/step-14c.md) | reviewed | 40 -> 41 | 156-158 |
| 15 | Audio and video basics | [step-15.md](steps/step-15.md) | reviewed | 41 -> 42 | 159-160 |
| 16 | Windows integration and release polish (v0.4) | [step-16.md](steps/step-16.md) | reviewed | 42 -> 43 | 161-162 |
| 17a | AI assistant: core, safety, models, evaluation | [step-17a.md](steps/step-17a.md) | reviewed | 43 -> 44 | 163-166 |
| 17b | Local AI actions | [step-17b.md](steps/step-17b.md) | reviewed | 44 -> 45 | 167-169 |
| 17c | AI search and organizing | [step-17c.md](steps/step-17c.md) | reviewed | 45 -> 46 | 170-172 |
| 17d | AI for scans and PDFs, writing suggestions (v0.5) | [step-17d.md](steps/step-17d.md) | reviewed | 46 -> 47 | 173-175 |
| 18a | Advanced image editor: layers and selections | [step-18a.md](steps/step-18a.md) | reviewed | 47 -> 48 | 176-177 |
| 18b | Advanced image editor: painting, filters, project format | [step-18b.md](steps/step-18b.md) | reviewed | 48 -> 48 | 178-179 |
| 19a | Video timeline: tracks and clips | [step-19a.md](steps/step-19a.md) | reviewed | 48 -> 49 | 180-181 |
| 19b | Video timeline: effects, audio, export | [step-19b.md](steps/step-19b.md) | reviewed | 49 -> 49 | 182-183 |
| 20a | Office editing: engine spikes and integration | [step-20a.md](steps/step-20a.md) | reviewed | 49 -> 50 | 184-185 |
| 20b | Word-style editing | [step-20b.md](steps/step-20b.md) | reviewed | 50 -> 51 | 186-188 |
| 20c | AI for documents | [step-20c.md](steps/step-20c.md) | reviewed | 51 -> 52 | 189-190 |
| 21a | Excel-style editing | [step-21a.md](steps/step-21a.md) | reviewed | 52 -> 53 | 191-193 |
| 21b | AI for sheets | [step-21b.md](steps/step-21b.md) | reviewed | 53 -> 54 | 194-195 |
| 22a | PowerPoint-style editing | [step-22a.md](steps/step-22a.md) | reviewed | 54 -> 55 | 196-198 |
| 22b | AI for decks and the style library (v1.0) | [step-22b.md](steps/step-22b.md) | reviewed | 55 -> 56 | 199-202 |

## Real implementation gates

20a editing-engine binding requires reviewer comparisons and owner choice.16modernWindowsmenuidentity/distribution requires its documented owner decision. Production runtime/model/media/Office packs need exact built artifact hashes/signatures/license and security evidence; source pins are not fabricated pack hashes.09fobject-bound replacement/recycling capability stays false until proved;09kretains originalplaintext andlabels encryptedcopyhonestly.17aAPI mode requires user-entered credentials and explicit request payload consent; Local AI remains available and Meta is the first APIprovider. These gates are explicit in guides; coding workers do not invent their resolution.

Delivered:54 complete guides and54 per-step prompts. Reserved final settings schema56. Next unreserved screenshot number203. No implementation states/tags/releases are marked completed by writing a guide.


## Dispatch files

Open [prompts/README.md](prompts/README.md) for all 54 copy-ready assignments. The [contract manifest](parallel/GUIDE-MANIFEST.json) records each exact guide hash and producer dependencies; [review record](parallel/FINAL-REVIEW.md) distinguishes documentation checks from future code acceptance. All393 tasks are specified for future implementation. No worker has been dispatched by this delivery.
