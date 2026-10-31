# Step 06c report - Templates in the New menu

Dates: 2026-10-30 to 2026-10-31. Status: all 7 implementation tasks saved, combined with 06b and reviewed locally on `step-06c-templates`; local integration is in progress. No tag or publication. Owner checks and the shared safety/runtime issues remain pending.

## How to try it

Use disposable files only while KI-068/KI-069 remain open. The reviewed release executable is `%TEMP%\adperastra-target\release\Adperastra.exe`, with `help` and `templates` next to it. To open a fresh hand-check profile in PowerShell:

```powershell
$env:ADPERASTRA_DATA_DIR = Join-Path $env:TEMP ('adperastra-hand-check-06bc-' + [guid]::NewGuid().ToString('N'))
& "$env:TEMP\adperastra-target\release\Adperastra.exe"
```

The release was built with `npx -y @tauri-apps/cli@2 build --no-bundle`. The setup/signing package was not run. The automated review's generated data and fixtures are retained, with their paths in the JSON records.

## Owner checklist

Use any folder you can write to (for example `%TEMP%\adp-06c`, an empty folder you create) and a second folder with two of your own files for My templates.

1. **New** lists the nine entries with the separator before **From template…**; on the Home page they are disabled.
2. Create each blank kind: each appears with its name selected; rename it; Ctrl+Z sends it to the Recycle Bin; Ctrl+Y brings it back.
3. Create two Markdown notes: the second is "New note (1).md" (new items count from one). Double-click a `.md`: it opens in a tab and can be edited. Double-click the `.docx`, `.xlsx` and `.pptx`: they open in their Windows apps (or Windows asks which app) and show an empty document.
4. **From template…**: six templates with descriptions. Create each: the Budget and Invoice add up when numbers are typed in their Windows app; the Meeting notes open in a tab.
5. Switch the app to Spanish: the window, the template names and the files' contents are in Spanish ("Carta.docx", "Notas de reunión.md").
6. **Choose folder…** your second folder: its files appear under My templates; create from one: a copy appears; the original is unchanged. **Open folder** shows that folder. Rename the folder in Windows Explorer and reopen the window: the missing-folder note and **Change folder…**.
7. Restart the app: the My templates folder is remembered.
8. Repeat checks 1 and 4 in the dark theme.

## What works

- New folder/text/Markdown/CSV/Document/Spreadsheet/Presentation commands with translated names, numbering from one, Undo and rename selection.
- Three blank Office files and six real templates in English and Spanish, generated from translated text. Budget/invoice contain formulas. Office applications are not bundled.
- The template picker lists built-ins and the saved personal folder, reports missing/unreadable/partial lists, follows keyboard focus and awaits persistence/creation. Copies report byte progress and can be cancelled; originals are unchanged.
- Rust authorizes the actual opened source, pins allowed roots/destination, exclusively creates staging, flushes and publishes by owned handle without replacement. Cancellation/failure cleans only owned staging; bounded name allocation never overwrites an arrival.

## Not in this step (on purpose)

- Office viewers/editors, variables/template editing and archive creation belong to later steps. docx/exceljs/pptxgenjs run only at build time and never ship with the app.

## Decisions and plan changes made during the step

- The owner's local-only batch rules override older per-task gate/push/package instructions. Workers wrote the prescribed tests and ran quick checks; the combined review ran the full gate, repeating it only after a failure or a subsequent correction.
- Every introduced defect is in `KNOWN_ISSUES.md`; recipe corrections, contracts, modules and traps are in a separate `docs(plan)` commit. Existing errors remain documented under the owner's policy.
- The scoped review mode is additive: fresh isolated folders, preserved data, explicit failed results and no legacy cleanup. It verifies 06b/06c only, not all earlier steps. No test app process is left running.
- Unique names follow the owner's one-based decision, correcting the original examples. The final combined measurement order is 06b, then 06c, then 06d.
- The old `template_create` API remains. The UI uses additive `template_create_start` and shared job polling/cancellation; `TemplateCreateOptions` is optional and the service result stays `Promise<string>`.
- `TemplateList.user_error`/`user_skipped` are optional/default diagnostics. Folder save and creation callbacks return promises; App updates confirmed settings only after persistence. The picker no longer remounts by folder key or closes on a failed create.
- `Dialog.className` is additive. Release screenshots found that generic max-width still constrained this picker to 520px; its own width/max-width now match the planned min(640px,92vw) (KI-077).
- New Rust file-copy and tests modules keep the implementation below the per-file limit. Existing tempfile is a dev-dependency of src-tauri; it adds no shipped library.

## Speed (development PC, packaged release build)

Final scoped records are `docs/benchmarks/step-06bc-ui-review-en-light.json`, `step-06bc-ui-review-es-dark.json` and `step-06bc-ui-review-pseudo-light.json`. They record seven runs per interaction, actual conditions, screenshots, file-byte checks, contrast/bounds checks and runtime console failures. Exact final medians:

- en/light: save a small text file with version history (Ctrl+S) **30.1 ms**, open the version history (right-click menu) **29.4 ms**, command bar New menu (with templates) **29.5 ms**.
- es/dark: save a small text file with version history (Ctrl+S) **29.5 ms**, open the version history (right-click menu) **32 ms**, command bar New menu (with templates) **29.4 ms**.
- pseudo/light: save a small text file with version history (Ctrl+S) **29.7 ms**, open the version history (right-click menu) **30.3 ms**, command bar New menu (with templates) **31 ms**.

Every measured action meets its tier (save/history: 1 s; New menu: 0.1 s). `functional_passed` and `console_clean` are separate; an overall false result is not described as a completely passed runtime check.

The earlier `-initial` record documents a verification-runner Escape target error after successful restore/Undo byte checks. It is not a completed speed/regression run. No same-build 06a/06b baseline exists for a valid 20% comparison; all earlier-step performance regression comparisons remain pending.

## Checks by hand

Waiting for the owner; nothing has been clicked in a packaged app yet.

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1. New menu entries and the separator; disabled on Home | waiting | waiting | pending |
| 2. Each blank kind, rename, Ctrl+Z, Ctrl+Y | waiting | waiting | pending |
| 3. Two Markdown notes named "(1)"; each kind opens | waiting | waiting | pending |
| 4. Six templates, contents and formulas, window opens fast | waiting | waiting | pending |
| 5. Spanish window, names and file contents | waiting | waiting | pending |
| 6. My templates: choose, list, create, open, missing folder | waiting | waiting | pending |
| 7. My templates folder remembered after restart | waiting | waiting | pending |
| 8. Checks 1 and 4 in the dark theme | waiting | waiting | pending |

Automated release checks cover a subset and do not fill in the owner's results.

## Verification

- Full `scripts/gate.ps1` passed: **349 Rust tests, 462 UI tests in 87 files**, 855 translation keys, 38 help pages, 84 registered commands / 82 checked invoke calls. Rust formatting and Clippy with warnings as errors, translations, IPC, TypeScript and Vite all passed. No tests are skipped or weakened.
- The combined release app was built with `npx -y @tauri-apps/cli@2 build --no-bundle`; no installer/signing build, remote operation, release or main change occurred.
- Failures were investigated and corrected before saving: the retention size test used out-of-retention dates (only dates corrected, assertions unchanged); CodeMirror normalizes CRLF to LF internally (the test now also asserts the CRLF save choice); a guarded oversized source now returns the required TooLarge result. A targeted test reproduced a colliding pending record overwrite before the no-replace correction.
- Review regressions cover incomplete snapshots, concurrent stores and cleanup, stable IDs/path ownership, exact deduplicated Undo snapshots, history-off restore, pending deletion and quota, bounded verified decompression/open-cache eviction, paged lists, growing preview streams, and Undo retained after a failed editor refresh.
- Template regressions cover exclusive partial ownership, no-replace publication/name exhaustion, junction/source swaps, cancellation/progress, read-only copies, listing failures/skips, keyboard focus, async folder save/create errors and deferred job cancellation. Filesystem tests run against real temporary Windows files.
- `check-06bc-ui.mjs` and the PowerShell wrapper parse successfully. The scoped release check creates fresh retained fixtures and never invokes the legacy permanent-cleanup path.
- Vite still prints the existing main-chunk warning (KI-048); the warning was not suppressed. The release runtime also reports blocked inline-style CSP violations (KI-075), so runtime verification is **not entirely clean** despite completed functional flows.
- Not verified here: real power-loss recovery, multi-GB or external-drive behavior, Windows native save/folder/Properties dialogs, Office applications, Narrator, every owner checklist item, and the full earlier-step speed regression suite.

## Screenshots

`docs/screenshots/step-06c/`: `44-new-menu` and `45-template-window` in English light, Spanish dark and pseudo-locale. The pre-width-correction English screenshot is retained in `docs/screenshots/review-06bc-before/`. All six final images were visually inspected. The dialog measures 640px, its scrollable list and actions remain inside the window, and horizontal bounds pass in all three languages. All 20 functional checks passed per language; the two existing CSP violations in each run still fail the console-clean check.

## Known issues

- Fixed in this review: KI-049–KI-055 (copy safety, diagnostics, focus, progress/cancel, persistence). Picker width is KI-077 (fixed and measured in all three languages).
- KI-070: build-only image-size advisories are unreachable in the text-only template generator; bounded review deferral to 2026-11-07 and before image input/v0.1. No forced override was applied. Production npm audit reports zero; full audit reports 9 moderate and 2 high. The high findings concern JXL/HEIF/ICNS parsing, not only old utility packages.
- Shared existing issues KI-033, KI-037, KI-048, KI-068, KI-069 and KI-075 remain documented. No release clearance is claimed.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md` records the template picker because the design has no corresponding frame. The guide's 640px size is now explicitly enforced.
- Build-only docx 9.15.0, exceljs 4.4.0 and pptxgenjs 4.0.1 are MIT and listed in both license records. The generated 15 template files are included as app resources. The generator adds no images and does not execute user content.

## Commits

```
02a4115 test(speed): New menu and template window screenshots [step-06c/T7]
be93f90 docs(plan): step 06c measurement and screenshot anchors [step-06c/guide]
ce810a4 feat(templates): template window with built-in templates and My templates [step-06c/T6]
6b0fa67 feat(explorer): New menu with Markdown, CSV and Office files [step-06c/T5]
ec05d1e docs(plan): step 06c unique names count from one [step-06c/guide]
5dc2bf7 feat(templates): list templates, create from a template, choose a folder [step-06c/T4]
1427203 feat(templates): built-in templates in English and Spanish [step-06c/T3]
b459878 feat(settings): My templates folder (schema 11) [step-06c/T2]
70e0efd deps: add docx 9.15.0, exceljs 4.4.0, pptxgenjs 4.0.1 (MIT, development only) [step-06c/T1]
```

(`git log testing..HEAD` also lists Step 06b's T1 to T4: those are this branch's baseline, not part of this step.)

The combined local safety correction is identified by `[step-06b/F2]` and `[step-06c/F1]`; plan corrections have their own `docs(plan)` commit.

## Next step

06d is already integrated locally. Next new implementation: 06e, after its outline is expanded into a guide.
