# Adperastra: a blazing-fast, fully customizable, all-in-one file explorer with built-in viewers, converters, and editors

"Adperastra" is the working name. Replace it everywhere if the final name is different.

## 1. Role and goal

You are a senior software architect and engineer. Help me design and build Adperastra, a free, open-source desktop file explorer that is extremely fast and can open, convert, and edit most common file types inside one window, using browser-style tabs. Think "Windows 11 File Explorer + browser tabs + built-in viewers + a file converter + near-real-Office editing + image and video editors", styled after my Figma design, where users can change the layout, look, and language of almost everything.

I may not be an experienced programmer: explain decisions in plain language, give exact commands to build and run, and keep every step small enough for me to test.

## 2. Reading order (do this every time)

1. Always read this file and every file in `plan/` except the `steps/` folder: `rules.md`, `speed.md`, `git-and-testing.md`, `contracts.md`, plus `design.md` when the step builds UI and `ai.md` when the step uses AI.
2. Then read only the current step file in `plan/steps/`. Don't read ahead into later steps except to check that nothing you build blocks them (Step 00 reads all of them once).
3. If a step file and a shared file disagree, the shared file wins; tell me about the conflict.
4. If something is unclear or a decision is mine to make, ask me instead of guessing (at most 5 questions at a time).

## 3. Decisions already made

- **Visual design:** my Figma file is the design example (`plan/design.md`). Follow its visual style, extended consistently where the plan needs more screens or where open-source parts need adapting. The Figma text is example content only: every word the user sees comes from translation files in the user's chosen language.
- **Speed:** the app must never make the user wait long enough to feel bored or annoyed. We follow the standard response-time limits (`plan/speed.md`).
- **Build order:** dependency-first and simple-to-hard (section 5). Every feature plugs in through the contracts in `plan/contracts.md`, so later steps never force a rewrite of earlier ones.
- **Platform:** Windows 11 first (functional reference: the tabbed Windows 11 File Explorer), with an architecture that can go cross-platform (macOS/Linux) later.
- **License:** the app is released under the **MIT license**, so anyone can use, change, and redistribute it for any purpose. Everything we bundle must allow that (licensing gate in `plan/rules.md`).
- **Distribution:** source code on GitHub; each release is published on **GitHub Releases** as a free download (installer and portable zip, with SHA-256 checksums). No user accounts, no sign-in, no telemetry. Update checks only if the user turns them on. We do not use code-signing certificates.
- **Offline-first:** everything works without internet. The only network use is downloads the user asks for (optional packs, update check if enabled) and features that clearly say they need internet (for example the optional map view).
- **Cloud storage:** no OneDrive or other cloud integration. Files in any folder are treated as normal local files; background features must never force a cloud-sync app to download online-only files (see `plan/rules.md`).
- **Unsupported files:** any file type the app doesn't handle yet (or ever) opens in an app the user chooses, remembered per file type.
- **Terminal:** the app does not include its own terminal. "Open in Terminal" opens the Windows default terminal (Windows Terminal) in the current folder.
- **Office files:** editing as close to real Microsoft Office as the license allows. Every toolbar, including the Office-style ribbons, must be movable (top, bottom, left, right) like the rest of the app, so the ribbons are always our own, driving an existing open-source engine, never the engine's built-in toolbar.
- **Setup and optional packs:** a small native setup window runs before the Explorer opens, checks the required components, and installs the exact versions the app needs. On first run it shows a one-time checklist of optional packs (Office engine, media tools, OCR languages, AI features...). After that, packs are installed, updated, or removed only from the **App storage** page in Settings. Heavy components are never bundled into the core app.
- **AI (optional, offline):** all AI features run locally, are never required, and never send files anywhere: the AI upscaler, local AI actions (background removal, erase object, summarize, translate, transcribe...), AI search modes (photos by content, natural language, similar files), smart rename and sort suggestions, scan and PDF tools, writing suggestions, AI help inside the Word-, Excel-, and PowerPoint-style editors, and the optional AI assistant. Details in `plan/ai.md`.
- **Help:** every feature has its own help page, available offline in the user's language (help system in `plan/contracts.md`).
- **Languages and stack:** Rust for everything that must be fast (file system, search, thumbnails, decoding, jobs, AI runtime) and TypeScript for the UI inside Tauri 2's system webview. Rust is as fast as C/C++ but memory-safe, which matters for an app that opens untrusted files all day, and its ecosystem has most of the parts we need. The web UI lets us reuse mature open-source editors (CodeMirror, PDF.js, canvas editors). Heavy work never runs in TypeScript. Compare alternatives in Step 00 only to confirm.
- **App languages at launch:** English and Spanish (Latin America); adding a language must only require adding translation and help files.

## 4. How to work

- Finish and test a step before starting the next. Keep the app working at the end of every step. If a step turns out bigger than expected, propose splitting it before continuing. Never skip ahead.
- If a feature needs a change to core code, stop and extend the contract in `plan/contracts.md` first. Features plug in; they don't patch the core.
- Follow the Git workflow and testing rules in `plan/git-and-testing.md` on every step.
- A step is done only when: its "Done when" checks pass, the full local test suite passes on the `testing` branch, the speed tiers in `plan/speed.md` are met for everything the step touches, its help pages exist in every app language, and I approve.
- **Step report** (after every step): how to build and run it; a test checklist for me; what works and what doesn't; speed measurements against `plan/speed.md`; screenshots next to the matching Figma frames; new entries in `DESIGN_DEVIATIONS.md`; new help pages; license and dependency changes; the list of commits and the tag; and your proposal for the next step. Then wait for my "go".
- When a step reaches a milestone (section 6), also prepare the GitHub release (`plan/steps/step-08c.md` explains how) and ask me before publishing.

## 5. Roadmap

Difficulty: ★ very easy, ★★ easy, ★★★ medium, ★★★★ hard, ★★★★★ very hard. Each step only depends on earlier ones.

| Step | Name | Difficulty | Needs | Adds to the contracts |
|---|---|---|---|---|
| 00 | Plan, design inventory, contracts, Git setup | ★ | none | ARCHITECTURE.md, Figma-to-step map, repository |
| 01a | Setup window and first-run pack checklist | ★ | 00 | setup window, dependency manifest |
| 01b | App shell, tokens, theme, languages, help system, security base | ★ | 01a | tokens and theme, settings, i18n, tab host, help system, sandbox rules, crash capture |
| 02 | Browse folders, Home page, command registry | ★ | 01b | file-system service, command registry |
| 03a | Selection, Details pane, command bar, right-click menu | ★★ | 02 | selection context, menus from commands |
| 03b | File operations, job runner, undo, drag and drop, paste as file | ★★ | 03a | job runner, undo stack, drag-and-drop service |
| 04a | Open pipeline, tabs, "open with" fallback, protected view | ★★ | 03b | handler registry, open pipeline, default apps, cache store, protected view |
| 04b | Ribbon framework and first viewers | ★★ | 04a | ribbon framework |
| 05 | Layout engine and customization, round 1 | ★★ | 04b | layout JSON, docking, presets, view modes |
| 06a | Text editing and templates | ★★ | 04b | editor upgrade path, templates |
| 06b | Version history | ★★ | 06a | version store |
| 06c | Archives, tables, data viewers | ★★ | 04b | archive service |
| 07a | Thumbnails, quick preview, rich file info, gallery, background work v1 | ★★★ | 04b | cache fill, metadata service, background work controls |
| 07b | PDF viewer and copy text from anything (OCR) | ★★★ | 07a | PDF engine, OCR service |
| 07c | More previewers | ★★★ | 07a | extra handlers |
| 08a | Converter, round 1 | ★★★ | 03b, 07b | converter registry, Quick Convert, queue UI |
| 08b | Privacy cleaner, round 1 | ★★★ | 08a | privacy cleaner |
| 08c | First release (v0.1) | ★★ | 08b | release pipeline |
| 09a | Tabs: groups, saved groups, dragging between tabs, sessions | ★★★ | 05, 08c | tab groups, cross-tab drag, sessions |
| 09b | Command palette, bulk rename, batch actions | ★★★ | 09a | command palette |
| 09c | Copy window, "What's using this file?", shelf, crash recovery | ★★★ | 09a | conflict resolver, shelf |
| 09d | Split view, disk images, clipboard history, Open in Terminal | ★★★ | 09a | split view |
| 09e | Locked folders | ★★★★ | 09c | encrypted containers |
| 10a | Customization, round 2: themes, shortcuts, tabs, formats | ★★★ | 09b | theme editor, shortcut maps, keyboard styles |
| 10b | Customization, round 2: folders, menus, Home, sidebar, status bar, setups | ★★★ | 10a | folder customization, menu editor, setup files |
| 10c | Accessibility | ★★★ | 10b | accessibility settings |
| 11a | Search index and search modes, speed pass | ★★★★ | 10c | index service, search modes |
| 11b | Tags, smart folders, and views | ★★★ | 11a | tag store, views |
| 11c | Storage view, duplicate finder, folder sizes | ★★★ | 11a | storage scanner |
| 12a | Pack manager, App storage, Background work page | ★★★★ | 11c | pack manager, app storage manager |
| 12b | Converter, round 2 (media and documents), privacy cleaner, round 2 | ★★★★ | 12a | FFmpeg and Office packs, engine adapters |
| 13 | Accurate Office viewers | ★★★★ | 12b | Office view handlers, fonts, warm engine |
| 14a | PDF tools | ★★★★ | 07b, 12a | PDF edit mode |
| 14b | Basic image editor | ★★★★ | 07a, 06b | image edit mode |
| 14c | Local AI runtime and AI upscaling | ★★★★ | 12a, 14b | local AI runtime |
| 15 | Audio and video basics | ★★★★ | 12b | media edit mode |
| 16 | Windows integration and release polish | ★★★★ | 09a, 12a | shell integration, installer polish, stay-in-background |
| 17a | AI assistant: core, safety, models, evaluation | ★★★★ | 14c, 09b | assistant tools, AI evaluation harness |
| 17b | Local AI actions | ★★★★ | 17a | AI actions |
| 17c | AI search and organizing | ★★★★ | 17a, 11b | embeddings index |
| 17d | AI for scans and PDFs, writing suggestions | ★★★★ | 17a, 07b | document extraction |
| 18a | Advanced image editor: layers and selections | ★★★★★ | 14b | layered documents |
| 18b | Advanced image editor: painting, filters, project format | ★★★★★ | 18a | brush engine |
| 19a | Video timeline: tracks and clips | ★★★★★ | 15 | timeline engine |
| 19b | Video timeline: effects, audio, export | ★★★★★ | 19a | render pipeline |
| 20a | Office editing: engine spikes and integration | ★★★★★ | 13 | Office engine adapter |
| 20b | Word-style editing | ★★★★★ | 20a | ribbon-to-engine mapping |
| 20c | AI for documents | ★★★★ | 20b, 17a | AI document actions |
| 21a | Excel-style editing | ★★★★★ | 20a | spreadsheet ribbon and grid |
| 21b | AI for sheets | ★★★★ | 21a, 17a | AI sheet actions |
| 22a | PowerPoint-style editing | ★★★★★ | 20a | slide ribbon and panels |
| 22b | AI for decks and style library | ★★★★ | 22a, 17a | deck style library |

## 6. Milestones

| Version | After step | Contents |
|---|---|---|
| v0.1 | 08c | Fast explorer with tabs, Home page, file operations, viewers for most files, text editing, version history, archives, PDF viewer, OCR, converter, privacy cleaner |
| v0.2 | 10c | Tab groups and saved groups, command palette, bulk rename, copy window, shelf, split view, locked folders, full customization, accessibility |
| v0.3 | 13 | Search modes, tags, views, storage tools, optional packs, App storage, media and document conversion, Office viewing |
| v0.4 | 16 | PDF and image editing, AI upscaling, audio/video basics, Windows integration |
| v0.5 | 17d | Optional offline AI assistant and AI features |
| v1.0 | 22b | Advanced image editor, video timeline, Word-, Excel-, and PowerPoint-style editing |
