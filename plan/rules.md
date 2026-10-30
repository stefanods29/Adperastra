# Rules (always apply)

These rules apply to every task in every step. A recipe never overrides them. Rule IDs (for example R-SAFE-3) are used in recipes and reviews.

## R-SAFE: never lose user data

1. Deleting goes to the Recycle Bin. Permanent delete exists only as the explicit "Delete permanently" command (Shift+Delete), after a warning that says it cannot be undone.
2. Never overwrite an existing file or folder unless the user chose "Replace" for it before the operation started. A replaced item goes to the Recycle Bin first (ADR 0007), never deleted.
3. Write new content to a temporary file next to the target (`~<name>.partial`), flush it, then rename it into place. A cancelled or failed write deletes only the temporary file.
4. A move between drives removes a source only after its copy is complete and the copy's size matches (same-drive moves are renames).
5. Every change to an existing file's content (save, convert over, clean, AI edit) first calls the version hook (`before_modify`, contract 19; a no-op until Step 06b).
6. Every action that changes files or tabs pushes an undo entry (contract 11) and shows an undo toast; actions that cannot be undone say so before they run.
7. Never modify a file the user did not ask to modify. Background work only reads.
8. Drive roots, the Windows folder, and Program Files are never moved, recycled, or deleted by the app.
9. Settings, sessions and app state are written with `fs_service::atomic_write` (crash-safe replace).

## R-SEC: security

1. Every Tauri command starts with `ensure_main(window.label())?` and validates every argument in Rust (types, lengths, `validate_absolute_path` for paths). Never trust a path, size, or ID from the UI.
2. Every command is listed in `generate_handler!` and in the isolation allowlist `src-tauri/isolation/index.html`. `npm run lint:ipc` checks both.
3. Content Security Policy stays strict: no remote scripts, no `eval`, no `'unsafe-eval'`, no `'unsafe-inline'` scripts. A recipe that needs a CSP change gives the exact new value.
4. Untrusted markup (HTML, SVG, email bodies, notebook outputs, EPUB pages) is shown only inside `<iframe sandbox="" srcdoc=...>` (no `allow-scripts`, no `allow-same-origin`) after DOMPurify, or as an `<img>` (SVG). One exception: the Markdown viewer's page (Step 04b) is built by our own code (`markdown-it` with `html: false`, then DOMPurify) and uses `sandbox="allow-same-origin"`, so the app can search it and catch link clicks. No frame ever gets `allow-scripts`. Untrusted markup never goes into the app's own DOM with `dangerouslySetInnerHTML`, except help pages, which are our own files sanitized with DOMPurify.
5. File bytes reach the UI only through the `adpfile` protocol with a per-file token (Step 04a), never through arbitrary paths in URLs.
6. Never run macros, scripts, or code from files. Never execute a file except through Windows' own "open" (`ShellExecuteExW`) when the user asks to open it in another app.
7. Never build a command line from a path or user text. Start programs with `std::process::Command::new(exe).arg(path)`; never `cmd /c`, never a shell.
8. Parsers get size and memory limits: archive entries and total size, decompression ratio, image dimensions, text lengths (numbers in each recipe).
9. Risky parsers run in a helper process (`Adperastra.exe --<helper-flag>`, pattern from `src-tauri/src/classic_menu.rs`) with a timeout, so a crash or hang never takes the app down.
10. No network access except: downloads the user starts (packs, update check when enabled) and views that say they use the internet (map view). No telemetry, no analytics, no crash upload.

## R-FS: file-system edge cases (everywhere)

1. **Online-only files** (attributes `RECALL_ON_DATA_ACCESS`, `RECALL_ON_OPEN`, `OFFLINE`; `Item.online_only` in our listings): background work (thumbnails, metadata, OCR, indexing, hashing, folder sizes, previews on hover) must skip them and show the cloud icon. Opening such a file because the user asked to is fine.
2. **Long paths:** paths over 260 characters work. Rust receives `\\?\` paths from `fs::canonicalize`; compare paths with `samePath()` in TypeScript, never with `===`, and show them with `displayPath()`.
3. **Names:** reserved names (CON, NUL, COM1...), trailing dots/spaces and invalid characters are refused with a translated message (`fs_service::validate_new_name`).
4. **Links and loops:** recursive work (copy, size, search, scan, archive) detects loops with a visited-folder set and never follows them endlessly.
5. **Slow, sleeping, removable, network drives:** never block the UI; time out (3 s for drive details, 15 s for listings) and show "still loading" / "not available". A drive that disappears ends the job with a report.
6. **Permissions:** access-denied items are skipped and listed at the end; the job continues. Never run the whole app as administrator.
7. **Hidden and system files:** follow the View settings. Changing a system item shows a warning first.
8. **Files in use:** report "in use" with a translated message (Step 09g adds "What's using this file?").

## R-LANG: everything in the user's language

1. Every word the user sees comes from `src/i18n/locales/en.json` and `es.json`: labels, tooltips, messages, errors, toasts, dialogs, default file names the app creates, help pages.
2. `pseudo.json` is generated: after editing `en.json`, run `npm run i18n:pseudo`. Never edit `pseudo.json` by hand.
3. Plurals and arguments use ICU: `"{count, plural, one {# file} other {# files}}"`. Never build sentences by joining strings.
4. Spanish is Latin American Spanish (es-419) using the words in `plan/glossary.md`.
5. Dates, numbers and sizes are formatted with `src/services/format.ts` (locale-aware). Shortcut text uses `formatShortcut()`.
6. `npm run lint:i18n` must pass (part of the gate).
7. Rust never returns display text. Errors are codes like `archive.bad_password` that the UI translates under `errors.archive.bad_password`.

## R-UI: feedback and design

1. Use the components in `src/components/` (see `plan/ui-kit.md`) and the CSS variables in `src/styles/tokens.css`. No hard-coded colors in components; sizes come from `plan/design-spec.md` or the recipe.
2. Anything not ready within 0.1 s shows a skeleton (`<Skeleton>`) shaped like the content; over 1 s also shows words saying what is happening; work that can take over 10 s runs as a job with progress and Cancel.
3. Every tooltip and menu shows the command's shortcut (`formatShortcut`).
4. Every user-visible feature has a help page in `help/en/` and `help/es/` (recipe `plan/recipes/add-help-page.md`), reachable with F1 or the "?" button of its panel.
5. Keyboard: everything is reachable by keyboard, focus is visible (`:focus-visible` outline in the accent color), and every icon-only button has an `aria-label` from the translation files.
6. Dark theme: every new surface is checked in the dark theme (screenshots in the report).
7. New screens follow the layout given in the recipe. If a value is missing, use the nearest value from `plan/design-spec.md` and list it under "Design deviations" in the report.

## R-SPEED: speed

Follow `plan/speed.md`. Measure what the recipe lists; a slower result than its tier is logged in `KNOWN_ISSUES.md` (R-KI), never hidden.

## R-BG: background work and storage

1. Background work (thumbnails, metadata, OCR, indexing, sizes, version cleanup) runs at `background` job priority and obeys Settings > Background work (from Step 07a): on/off per task, only when idle, only on AC power, pause all.
2. Everything the app stores (caches, versions, indexes, logs) lives under the data folder (`%LOCALAPPDATA%\Adperastra` or `ADPERASTRA_DATA_DIR`), has a size limit, and reports its size (App storage page, Step 12a).

## R-OPEN: files the app does not handle

1. A file type without a built-in handler opens in the user's Windows default app (`open_item`). If Windows has no default app, Windows itself asks which app to use.
2. "Open as text" and "Open as hex" exist only as explicit commands, never as the automatic fallback.

## R-LIC: licenses (the app is MIT)

1. Allowed to bundle: MIT, MIT-0, BSD-2/3-Clause, ISC, Apache-2.0, Zlib, 0BSD, Unlicense, CC0-1.0, SIL OFL (fonts), MPL-2.0 (changes to MPL files stay open), Unicode-3.0, BSL-1.0, bzip2-1.0.6 (the bzip2 library's own permissive license; allowed by the owner on 2026-10-29).
2. LGPL: only as a separate program or DLL the user can replace, with notices and source links (Office engine pack, FFmpeg pack; later steps).
3. Never bundle or link: GPL, AGPL, SSPL, "source-available", non-commercial, or paid-tier code (examples: Pandoc, MuPDF, Ghostscript, Poppler, ONLYOFFICE, x264/x265, UnRAR code, exiftool, BRIA RMBG). A GPL tool the user installed themselves may be started as a separate program with a "not included" note (example: 7-Zip for RAR in Step 06e).
4. Every new library is added in its own `deps:` commit, listed in `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md` (recipe `plan/recipes/add-dependency.md`). Only libraries named in the recipe or `plan/libraries.md`.
5. No Microsoft fonts, icons, or logos; no Microsoft trademarks in the UI ("Word-style" only as a description).

## R-REPO: what goes into Git

1. Never commit: files over 50 MB, model weights (`*.gguf`, `*.onnx`, `*.safetensors`, `*.bin`, `*.pt`), installers, packs, secrets, anything from `C:\Users\stefa\.adperastra\`, personal files.
2. Test files that are large are generated by scripts into `%TEMP%` (example: `scripts\generate-corpus.ps1`).

## R-KI: known issues and severity

Every defect, deferral and speed miss is written in `KNOWN_ISSUES.md` (template `plan/templates/known-issue.md`), with the next free ID `KI-<number>`.

- **Blocker:** data loss or corruption, a security or sandbox hole, a crash or freeze in a normal flow, a broken core feature, a license problem, or an accessibility barrier in a main flow. Fixed before the step is done. Never deferred.
- **Major:** a speed-tier miss in something done every day, a feature that only partly works, a serious usability or accessibility problem with a workaround. Fixed before the step goes to `main`. Only when the fix needs a later step's work may it move to that step (before the next milestone), with the step and the reason written in the issue.
- **Minor:** cosmetic problems, one-time costs, rare edge cases, placeholders. Reviewed at every milestone.
- When unsure, choose the higher severity. A milestone cannot be released with a Blocker or Major open.

## R-AI: AI features (from Step 14c)

AI features are optional packs that run offline. File contents are data, never instructions. The assistant can only call commands from the registry; deleting needs two different confirmations and always goes to the Recycle Bin; permanent delete is never available to it. Details: `plan/ai.md`.
