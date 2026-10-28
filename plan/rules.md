# Rules for every step

These apply to all work, in every step. If a step file seems to contradict them, these rules win; tell me about the conflict.

## 1. Everything is settings-driven

Nothing about layout, look, or language is hardcoded. Use a settings schema, design tokens, and translation files. Every toolbar and ribbon is our own data-driven component: movable to any side, themeable, translatable, keyboard accessible, and built from commands in the command registry.

## 2. Language: everything in the user's chosen language

- Every word the user sees comes from translation files: menus, ribbons, buttons, tooltips, messages, errors, toasts, dialogs, help pages, templates, default file and folder names the app creates (for example "Pasted image 2026-10-27 13-15.png"), the setup window, and AI answers by default.
- The Figma file's text is example content in Spanish. Don't copy it as the source of truth: write proper strings for every supported language, using the clearest wording for each.
- In this plan, UI names are written in English (Home, Insert, Review...). They are labels to translate, not fixed text.
- Locale-aware formatting everywhere: dates, times, numbers, file sizes, sorting (natural sort), and plural forms (ICU message format).
- A lint check fails the build if any user-visible text is hardcoded. A pseudo-locale (stretched, accented text) is used in tests to catch truncation and missing translations.

## 3. Feedback and discoverability

- **Skeleton loaders:** anything that isn't ready within 0.1 s shows a skeleton shaped like the real content (gray file rows and thumbnail tiles, a page outline for PDFs and documents, a grid for sheets, a toolbar outline for ribbons still loading, text lines for AI answers), with a subtle shimmer that respects reduced motion. Skeletons are replaced in place without layout jumps. Spinners only for small inline actions, and only after 0.15 s. Anything over 1 s also says what it's doing; anything that can take over 10 s runs as a background job with progress and Cancel (see `speed.md`).
- **Shortcut hints:** every tooltip shows the command's shortcut (for example "Copy  Ctrl+C"), and so do menus and the command palette. Pressing and releasing Alt shows Office-style key tips over ribbon tabs and buttons. A "Keyboard shortcuts" sheet (Ctrl+/) lists all shortcuts for the current tab, searchable. Hints always reflect remapped shortcuts and the keyboard layout, and can be turned off.
- **Undo toasts:** after any action that changes files or tabs (recycle, move, copy over, rename, bulk rename, convert over an existing file, privacy clean, closing a group, tagging, AI actions), show a small toast: what happened, an "Undo" button, and the shortcut ("Moved 12 items to the Recycle Bin. Undo (Ctrl+Z)"). It stays about 8 s, pauses while hovered or focused, stacks without covering content, and is announced to screen readers. Undo from the toast and Ctrl+Z use the same undo stack. If an action can't be undone (for example a permanent delete), say so before it runs. A "Recent actions" list keeps the last actions so I can undo after the toast is gone.
- **Help pages:** every user-visible feature has a help page (see the help system in `contracts.md`), written in plain language in every app language, reachable with F1 or the "?" button in that feature's panel or dialog. A step is not done until its help pages exist.

## 4. Safety and quality

- Never lose data: autosave and recovery, unsaved-changes prompts, conversions create new files by default, deletes go to the Recycle Bin, file operations are undoable, and any change the app makes to an existing file goes through the version store first.
- Treat every file as untrusted: no macro execution, no scripts, no remote content by default, detect when an extension doesn't match the real file type, stream or memory-map big files, set size and memory limits on every parser (protection against zip bombs and decompression bombs).
- File tabs are isolated (separate webview or process where possible) so a crash or freeze in one never takes down the Explorer tab. Core browsing never requires admin rights.
- Accessibility basics from day one (screen-reader labels, full keyboard navigation, visible focus, high contrast); the full accessibility settings come in Step 10c.
- Clean modular code, strict typing, unit tests for core logic, a short README per module. Logs stay local.

## 5. Sandboxing and security (how "sandboxed webviews" works)

- **Tauri permissions:** use Tauri 2's capabilities system so each window and webview can call only the commands it needs (for example, a PDF viewer can request pages of its own file, but can't list folders or delete files). No broad shell or file-system plugins exposed to the UI; all disk access goes through our own Rust commands.
- **Validate every message:** every command from the UI to Rust has typed, validated input (serde types, length limits), resolves paths to their real location (canonicalize, follow junctions and links safely), and checks them against what that tab is allowed to touch. Never trust a path, size, or ID just because the UI sent it.
- **Strict Content Security Policy:** only our own bundled code runs (`default-src 'self'`, no remote scripts, no `eval`, `object-src 'none'`, no inline scripts except hashed ones). No navigation to external sites inside the app; links open in the default browser after confirmation.
- **Untrusted content in an isolated frame:** HTML files, SVG, Markdown with embedded HTML, email bodies, notebooks, and anything else that can contain markup is rendered in a sandboxed frame or separate webview with scripts disabled, a unique origin, no access to the app's commands, and no network. File bytes are served through a custom protocol with the correct content type, never injected into the app's own page.
- **Isolation pattern:** use Tauri's isolation pattern so every message from a webview to Rust passes a check that can reject unexpected calls.
- **Risky parsers in separate low-privilege processes:** image decoding of unusual formats, archives, PDF rendering, Office conversion, media tools, and AI models run in helper processes started with restricted rights (Windows job objects with memory and CPU limits; AppContainer or a restricted token where it works), no network access, and only the files they need. If one crashes or misbehaves, it's killed and restarted without affecting the app.
- **Release builds:** developer tools disabled, debug commands removed, dependency audit clean.
- **Mark of the Web:** files downloaded from the internet open in protected view (Step 04a).

## 6. File-system edge cases (handle them everywhere)

- **Online-only files from sync apps:** some folders may contain placeholders for files stored only in the cloud (from any sync app). Opening such a file normally is fine, but background work (thumbnails, OCR, indexing, hashing, folder sizes, AI indexing, previews on hover) must detect these placeholders (Windows "recall on data access" attributes) and skip them, so the app never triggers large downloads on its own. Show a small cloud icon for them.
- **Long paths:** support paths longer than 260 characters everywhere (Windows long-path APIs).
- **Reserved and tricky names:** handle names like CON, NUL, COM1, trailing dots and spaces, and unusual Unicode; refuse to create invalid names with a clear message.
- **Links and loops:** symbolic links, junctions, and mount points are shown as such; recursive operations (copy, search, size, scan) detect loops and never follow them endlessly.
- **Slow and removable drives:** network drives and USB drives never block the UI; timeouts and "still loading" states; drives that disappear mid-operation end the job cleanly with a report.
- **Permissions:** when an operation needs admin rights (for example writing into Program Files), ask through the normal Windows permission prompt for that single operation; never run the whole app as admin. Access-denied errors skip the item and continue, listing problems at the end instead of failing the whole job.
- **Hidden and system files:** respected according to the user's settings; system files are never modified without a clear warning.
- **Files in use:** handled with "What's using this file?" (Step 09c).

## 7. Opening files the app doesn't handle

- Any file type without a built-in handler (including types whose handler comes in a later step) opens with an app the user chooses: the first time, show the Windows "Open with" choice; remember the choice per file type (changeable in Settings > Default apps).
- The text/hex viewer is available only as an explicit command ("Open as text" / "Open as hex"), never as the automatic fallback.

## 8. Background work and app storage

- All background work (thumbnails, indexing, OCR, AI indexing, folder sizes, scans, version cleanup) runs at low priority through the job runner and respects the Background work settings: on/off per task, only when idle, only on AC power, pause while a full-screen app runs, CPU limit, and a global "Pause all background work" button.
- Everything the app stores (caches, indexes, version history, packs, models, logs) is listed with its size in Settings > App storage, where it can be cleared or removed. No hidden storage.
- Optional packs are chosen once in the setup window's first-run checklist and afterwards only in App storage. When a feature needs a pack that isn't installed, show a short message explaining what's needed and its size, with a button that opens App storage.

## 9. Where large files live (never in the Git repository)

- Never commit model weights, installers, packs, or any file over about 50 MB, and don't use Git LFS for them (GitHub rejects files over 100 MB, and the free LFS quota is only 10 GiB of storage and 10 GiB of downloads per month).
- Base AI models are downloaded by the pack manager from their official Hugging Face repositories, pinned to an exact commit and verified by SHA-256. We never re-host them.
- Our own fine-tuned LoRA adapters (if any) and converted files go on our free Hugging Face organization page, or as GitHub Release assets (each under 2 GiB), with the base model's license and notices.
- The repository holds only code, scripts, small test files, evaluation and training data (small text files), help pages, and the signed manifests (`dependencies.json`, pack manifests) with URLs, versions, sizes, and checksums.
- A CI check fails if any committed file is over 50 MB; `.gitignore` covers model formats (`*.gguf`, `*.onnx`, `*.safetensors`, `*.bin`, `*.pt`).

## 10. Licensing gate (the app is MIT)

- OK to bundle: MIT, BSD, ISC, Apache-2.0, Zlib, Unlicense/CC0, open font licenses (SIL OFL), and MPL-2.0 (changes to MPL-licensed files must stay open).
- LGPL: only as separate, user-replaceable DLLs or programs, with notices and source links.
- Never bundle or link: GPL, AGPL, "source-available", "royalty-free with conditions", "free with limits", non-commercial, or paid-tier components (examples: Pandoc, MuPDF, Ghostscript, Poppler, ONLYOFFICE, SuperDoc, x264/x265, Univer Pro, Slint's royalty-free license, Piper TTS since its 2025 GPL relicense). If a great GPL tool exists (for example Pandoc), detect a copy the user installed themselves and call it as a separate program, with a clear "not included" note.
- AI model weights follow the same rule: only MIT, BSD, Apache-2.0, or similarly permissive licenses; never non-commercial ones.
- Re-verify each license and the project's maintenance status before using a component. Keep `THIRD_PARTY_LICENSES` (name, version, license, how used). Flag anything borderline (I'm not a lawyer).
- Don't ship Microsoft fonts, icons, or logos, and don't use Microsoft trademarks in the app; "Word-style" is fine only as a description. For patent-encumbered codecs (H.264, HEVC, AAC) prefer the OS's or the GPU's encoders and decoders over bundled ones.

## 11. Known issues and severity

Every defect, deferral, and speed miss is recorded in `KNOWN_ISSUES.md` at
the repository root (ID, severity, step found, plain-language description,
workaround, target step or milestone). Fixed issues move to its "Fixed"
section with the fixing commit. Speed misses are always logged there
instead of being silently relaxed.

- **Blocker:** data loss or corruption, a security or sandbox hole, a crash
  or freeze in a normal flow, a broken core feature, a license problem, or
  an accessibility barrier that blocks a main flow. Must be fixed before
  the step is done; never deferred.
- **Major:** a speed-tier miss in something users do every day, a feature
  that works only partly, or a serious usability or accessibility problem
  with a workaround. May be deferred to a later step only with the owner's
  approval, but must be fixed before the next milestone release (v0.1,
  v0.2, ...).
- **Minor:** cosmetic problems, one-time costs (for example the first run
  after installing), rare edge cases, and placeholders. May wait; reviewed
  at every milestone.
- When unsure about severity, choose the higher one and ask the owner.
- Every step report lists new, open, and fixed known issues. A milestone
  release cannot be published with any Blocker or Major issue open.
