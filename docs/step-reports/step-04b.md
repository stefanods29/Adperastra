# Step 04b report - Ribbon framework, text and code viewer, Markdown viewer

Dates: 2026-10-30. Status: **built and committed on local branch `step-04b-ribbon-text-markdown`; the gate passed on `f421c67`; the owner's hand checks, the speed run and the screenshots are still to do**. Nothing was pushed and `main` was not touched (owner's local-only decision, 2026-10-30).

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

Packing uses the owner's signing key, so the owner runs these two commands.

## Owner checklist

Create the test files first (they go to `%TEMP%\adperastra-04b`):

```powershell
$dir = Join-Path $env:TEMP "adperastra-04b"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path "$dir\notes.txt" -Value @("First line", "Second line with a word to find", "Third line, word again") -Encoding utf8
Set-Content -Path "$dir\README" -Value @("Read me first.", "This file has no extension.") -Encoding utf8
[IO.File]::WriteAllBytes("$dir\accents-1252.txt", [byte[]](0x43,0x61,0x6E,0x63,0x69,0xF3,0x6E,0x2C,0x20,0x61,0xF1,0x6F,0x2C,0x20,0x63,0x61,0x66,0xE9,0x0D,0x0A))
Set-Content -Path "$dir\safety-test.md" -Value @("# Safety test", "", "Some **bold** text.", "", "<script>alert(1)</script>", "", "![remote picture](https://example.com/x.png)", "", "[web link](https://example.com)", "", "[local file](file:///C:/Windows/notepad.exe)") -Encoding utf8
Set-Content -Path "$dir\hello.bat" -Value @("@echo Hello from a script", "@pause") -Encoding ascii
Set-Content -Path "$dir\page.html" -Value "<h1>Hello</h1>" -Encoding utf8
Copy-Item -Path "src\App.tsx" -Destination "$dir\App.tsx"
$line = "2026-10-29 12:00:00 INFO worker processed an item in 42 ms, line"
[IO.File]::WriteAllLines("$dir\big-50mb.log", [string[]](1..800000 | ForEach-Object { "$line $_" }))
```

Then open the folder `%TEMP%\adperastra-04b` in Adperastra and check:

1. Double-click `notes.txt`: it opens in a tab with line numbers. The status bar shows "Ln 1, Col 1", "4 lines" (the empty line after the last line break counts), "UTF-8", "Windows (CRLF)" and the size.
2. Double-click `App.tsx`: code colors. Switch to the dark theme: the colors are easy to read.
3. In `notes.txt` press Ctrl+F: the search box at the top right is focused. Type `word`: the first "word" is selected and all are highlighted. Enter and F3 go to the next one; Shift+F3 to the previous one; Esc clears the search.
4. View > Word wrap and Line numbers turn on and off. Ctrl+= and Ctrl+- change the text size; Ctrl+0 resets it. Close and start the app again: the tab comes back with the same settings.
5. Type letters, press Delete, and paste in the text: nothing changes. Ctrl+A then Ctrl+C copies the text.
6. `accents-1252.txt` shows "Canción, año, café" and the status bar says Windows-1252. Choose UTF-8 in View > Encoding: the accents break. Choose Windows-1252 again: they are back.
7. `big-50mb.log` (about 56 MB) opens at once with the note "This file is large...". Next part (or Alt+Page Down) moves on and the status bar says "Part 2 of 56". Previous part (or Alt+Page Up) goes back.
8. `README` opens as text.
9. `safety-test.md` opens as a formatted page: "<script>alert(1)</script>" shows as text, nothing pops up, and no picture loads. View > Source shows the colored source; View > Reading view goes back.
10. In the reading view click "web link": a dialog shows the address; Cancel does nothing; Open link opens the browser. The "local file" line is plain text, not a link.
11. Ctrl+F and type `text` in the Markdown tab: the match is highlighted and the status bar shows "1 match". Ctrl+= makes the page bigger without jumping back to the top.
12. Hold Alt in a text tab: letters appear on the ribbon; Alt+W turns word wrap on or off. In a picture tab, Alt+R turns the picture right.
13. Picture tab: Rotate left and Rotate right turn the picture; Actual size shows 100 %; Fit fits it again. Restart the app: the rotation is kept.
14. Double-click `page.html`: it opens in the browser. Double-click `hello.bat`: it opens as text (nothing runs). Right-click `hello.bat` > Open in Windows app: a console window says "Hello from a script".
15. Spanish and dark theme: repeat 1, 3, 9 and 12.

## What works

- A ribbon in file tabs (contract 16): one row of grouped buttons built from commands, with Alt key tips; the row of ribbon tabs appears only with more than one tab. Viewers run their own command shortcuts only while their tab is active and never take plain keys while typing in a text field.
- A search box on file tabs for viewers that can search: Ctrl+F focuses it, Enter or F3 goes to the next match, Shift+Enter or Shift+F3 to the previous one, Esc clears; the counter grows so a new search starts at the first match.
- Text and code viewer: CodeMirror 6, read-only (caret, selection, Ctrl+A and Ctrl+C work); colors for about 30 languages, loaded only when a file of that type opens; word wrap, line numbers, zoom (Ctrl+= / Ctrl+- / Ctrl+0), 12 encodings with a byte-order mark first, then UTF-8, then Windows-1252; the status bar shows line and column, lines, encoding, line endings and size.
- Large files: above 10 MB the file opens read-only in 1 MB parts read with HTTP `Range` requests; Previous part / Next part (Alt+Page Up / Alt+Page Down) and a translated notice; no size limit.
- Markdown viewer: `markdown-it` (`html: false`, linkify) then DOMPurify in `<iframe sandbox="allow-same-origin">`; Reading view and Source view (colored CodeMirror); page search with the CSS Custom Highlight API; web, mail and `mailto` links ask first and then open in the default app, other links do nothing; files over 5 MB open in the text viewer.
- Text files without a known extension (README, LICENSE) are detected from their first 8 KB (UTF-16 byte-order mark, or no zero bytes and at most 1 % control characters) and open as text.
- Open pipeline: programs, shortcuts and web pages always open in Windows (`ALWAYS_WINDOWS`); scripts (.bat, .cmd, .ps1, .vbs, .js) open as text so they never run by accident; Right-click > Open in Windows app still runs them on purpose.
- Picture viewer: the 04a features on the ribbon, plus Rotate left, Rotate right (view only) and Actual size; the rotation is kept in the tab's saved state.
- Per-tab view state: text (word wrap, line numbers, zoom), Markdown (reading or source, zoom) and picture (fit or zoom, rotation).
- Help pages "The ribbon", "Viewing text and code" and "Viewing Markdown" in English and Spanish.

## Not in this step (on purpose)

- Editing or saving text, version history and templates: Steps 06a-06c.
- "Open as text/hex", audio and video, protected view, and Settings > Default apps: Step 04c.
- Ribbon in the Explorer tab (it keeps its command bar) and pictures from the Markdown file's folder in Reading view: later steps.
- `.html` files open in Windows, not in a web preview (decision D8). Audio and video players, and web page preview: Step 04c and later.

## Decisions and plan changes made during the step

- The step followed the recipe as written; the file lists of the task commits match the task "Files" lists, with no extra source file.
- **One fix beyond the recipe (F1):** typing in the search box of the Markdown reading view read `CSS.highlights` without checking that the engine has a `CSS` object; an older engine without the CSS Custom Highlight API threw an error instead of showing results. `findInPage` now checks for `win.CSS` first and reports no matches when the API is missing, with a new test. Recorded as KI-031 (Minor, fixed in this step).
- **Measurement recipe adaptation:** the T10 step asked to replace the literal `step: "04a",` with `step: "04b",` in `scripts/measure-ui.mjs`. That literal no longer exists: the script takes the step id as its 9th argument (`-Step`, set by `scripts/measure-ui.ps1`), so only the two 04b measurement rows and the two new screenshots were added. The 04b rows run under the step id passed by the runner.
- Decision D6 is implemented as given: the ribbon is data (`RibbonDef`), the frame is `ViewerFrame`, and `useCommandShortcuts(commands, ctx, active)` keeps viewer shortcuts inside their tab.
- The 04a design-deviation note ("search arrives with the text viewer in Step 04b") is now satisfied: file tabs show the search box for viewers with `supportsFind`.
- No new entry in `DESIGN_DEVIATIONS.md`; the ribbon uses the tokens and sizes of `plan/design-spec.md` and contract 16, and the screenshots are pending.

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open a 5 MB log in the text viewer (first view) | Fast (1 s) | pending | pending |
| Open a Markdown file (first view) | Fast (1 s) | pending | pending |
| Earlier rows (selection, menus, folder open, image tab) | as before | pending | not more than 20 % slower than `docs/benchmarks/<date>-ui-step04a.json` |

Raw numbers: `docs/benchmarks/<date>-ui-step04b.json` (pending; not run in this session).

## Checks by hand

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| Owner steps 1-15 above | waiting | waiting | waiting for the owner |

## Verification

- `.\scripts\gate.ps1` (without `-Package`): **GATE PASSED** on commit `f421c67` - Rust formatting (`cargo fmt --check`), clippy with warnings as errors, 158 Rust tests, translations (420 keys, 24 help pages, 47 tsx files), the Tauri IPC check (52 commands, 51 invoke calls), 129 UI tests (28 files) and the UI type check and build.
- CodeMirror 6 was added exactly as the recipe lists; `npm ls @codemirror/state @codemirror/view @codemirror/language` shows one version of each (`state@6.7.6`, `view@6.43.15`, `language@6.13.1`, all others `deduped`). `npm audit --omit=dev` was part of T1 and reported no high or critical problems.
- New tests:
  - UI: `ribbon.test.tsx` - "draws toggles, disables unavailable commands and runs on click and Alt+letter", "matches modifiers exactly", "treats Ctrl+= and Ctrl++ alike".
  - UI: `textEncoding.test.ts` - byte-order marks, UTF-8 with a character cut at the sample end, Windows-1252 fallback, skipping the mark, line-ending names.
  - UI: `textLanguages.test.ts` - file names to languages, loading a modern and a legacy language.
  - UI: `textFind.test.ts` - first match while typing, next and previous, the current match while the text grows, read-only.
  - UI: `markdownRender.test.ts` - headings/lists/code/tables, no HTML or scripts from the file, refused colors, zoom scaling, and "finds nothing when the engine has no Custom Highlight API" (F1).
  - UI: `openPipeline.test.ts` - text/code/logs/Markdown open in the app, big Markdown to the text viewer, programs/shortcuts/web pages in Windows.
  - Rust: `text_is_recognized_by_content` (`src-tauri/src/files.rs`) and `allows_only_web_and_mail_links` (`src-tauri/src/links.rs`).
- Not run in this session: `.\scripts\gate.ps1 -Package`, the speed run, the screenshots, and the owner's hand checks.

## Screenshots

`docs/screenshots/step-04b/`: `13-text-tab` and `14-markdown-tab` (new) plus all earlier screens, in English light, Spanish dark and the pseudo-locale - **pending** (the measurement script now captures the two new shots). Compared with `plan/design/screens/01-explorer-home.png`: pending.

## Known issues

- New: none found by the automated checks.
- Fixed: KI-031 (Minor, Markdown page search on engines without the CSS Custom Highlight API; commit `f421c67`).
- Still open: KI-001, KI-002, KI-004, KI-005, KI-009, KI-015, KI-016, KI-024, KI-030 (Minor); KI-003 (Major, after-reboot startup measurement, not touched by this step).
- The owner's 15 hand checks are still waiting; problems they report become `F` tasks.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: no new entry for this step.
- New dependencies: CodeMirror 6 (MIT) - `@codemirror/state` 6.7.6, `view` 6.43.15, `language` 6.13.1, `commands` 6.11.1, `search` 6.7.2, `lang-javascript` 6.2.5, `lang-json` 6.0.2, `lang-html` 6.4.12, `lang-css` 6.3.1, `lang-xml` 6.1.0, `lang-markdown` 6.5.2, `lang-python` 6.2.1, `lang-rust` 6.0.2, `lang-sql` 6.10.0, `lang-java` 6.0.2, `lang-cpp` 6.0.3, `lang-yaml` 6.1.3, `legacy-modes` 6.5.5, `@lezer/highlight` 1.2.5 and the `@lezer` parsers they use (all MIT). Recorded in `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md` in the `deps:` commit `23a61c3`.

## Commits

```
f421c67 fix(markdown): guard the page search when the engine lacks the highlight API [step-04b/F1]
9dcf21f test(bench): measure opening a 5 MB log and a Markdown file [step-04b/T10]
897b2ec feat(viewer): Markdown viewer with reading view, source view and safe links [step-04b/T9]
86842e3 feat(viewer): text and code viewer with colors, search, encodings and large-file parts [step-04b/T8]
467ae85 feat(links): open web and mail links in the default browser or mail app [step-04b/T7]
1d20d19 feat(files): recognize text files that have no known extension [step-04b/T6]
8251d8f feat(viewer): picture viewer ribbon with rotate and actual size [step-04b/T5]
9168d68 feat(ribbon): ribbon framework with key tips and command shortcuts [step-04b/T4]
ca4bcd0 feat(tabs): search box on file tabs for viewers that can search [step-04b/T3]
9c62544 refactor(commands): commands can use a context type of their own [step-04b/T2]
23a61c3 deps: add CodeMirror 6 (MIT) for the text viewer [step-04b/T1]
```

Planned local tag: `v0.0.8-step04b` (the owner decides when it moves to `main`).

## Next step

Step 04c: Audio and video player, protected view, Open as text/hex, Default apps (from `plan/STATUS.md`).
