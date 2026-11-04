# Limited Office editing integration, 2026-11-04

The owner prioritizes usable in-app Office editing and original formatting,
including Excel-style cells. This branch remains local and uncommitted; the
unfinished integration work is preserved. No release or full Office parity is
claimed.

## Proven paths

- The real application executable dispatches the first-party OOXML worker in
  the existing AppContainer. The worker receives a private immutable input,
  not write access to the source document. Snapshot data uses bounded frames.
- `--office-engine-check` passed on disposable DOCX, XLSX and PPTX fixtures:
  edit, repeated capture, undo/redo identities, discard back to source, and
  publication to a new copy. The XLSX check also enumerates actual workbook
  tabs and requests a dense live 6-by-4 cell window through the native binding.
- The first grid standalone build SHA-256 was
  `961b722a0cb8cca2cdcfa186da87a3ffa8da478fdf3cb5cb704c8c4a15925509`.
  Its checks returned copy sizes 9,728 / 7,199 / 102,149 bytes respectively.
- An earlier live Word tab changed text and saved a copy through the native
  Windows file dialog. The original source hash and all untouched ZIP parts
  matched afterwards. The native initial content identity must match the
  registry's document identity; fixing that mismatch enabled the real editor.
- Focused grid/editor tests: 3 files, 10 tests passed after the worksheet
  default change. Worker library tests: 9 passed. The worksheet fixture checks
  leading zeroes, bold/font/fill/alignment, cached formulas, actual sheet names,
  read-only formula/absent targets, stale revisions and viewport bounds.

## Current interface

XLSX uses the existing virtualized SheetEditor, with row/column headings,
formula bar, sheet tabs, selection, zoom and the shared Save a Copy flow.
Only the visible bounded rectangle is fetched; at most 2,000 cells are mounted.
The follow-up defaults worksheets directly to this grid. The later paper
editor replaces the separate Word/PowerPoint text cards with an accurate
render of the live immutable snapshot, with text controls at their rendered
positions. Files first open in preview; explicit Enable editing opens the
controller. Protected-view acceptance is owned by the existing file-tab flow.

The final default-grid build is `build/Adperastra/Adperastra-Office.exe`,
SHA-256 `db5f4dd0938046b3d1ab9cc6a11dabe146bb73daeafb0bb31390ce39e16c69b9`.
Its real native checks passed all three families again, producing copies with
the same verified hashes. The packaging script compiled successfully but
refused to replace the running `Adperastra-Preview.exe`; the final binary was
therefore copied to a new name. Close the running Preview before opening the
Office build: the single-instance mechanism otherwise forwards files to the
already-running older process. No user process was terminated or overwritten.

## Remaining qualification

The full gate passed: formatting, Clippy, Rust workspace tests (999 seconds),
translations, IPC, UI tests and frontend build. No tests were weakened or
disabled. The final review also inverted the initial view and verified that
the new default-grid regression test failed, then restored the source and
verified it passed. The gate's UI phase ran after the original source was
restored.

The full gate and final standalone build logs are outside the repository in
the temporary folder (`adperastra-office-grid-gate.log` and
`adperastra-office-grid-final-package.log`). Do not infer success from a
started process. The live grid interaction check was interrupted by overlapping
user input; no cell-grid screenshot or UI save result is claimed from it.

The later portable editing build adds blank-cell insertion to eligible XLSX
worksheets. The live Excel grid accepted direct typing in empty A5 and saved
the numeric value 7. Live Word and PowerPoint editing also saved separate
copies. All three edited copies are in the Desktop examples folder. Their
original hashes stayed unchanged and each copy changed only its intended
XML part.

The worker edits literal XLSX cells, plain DOCX runs and PPTX text.
Formula evaluation, full number/date formats, theme
colors, merged geometry and source row/column dimensions remain unsupported.
Legacy DOC/XLS/PPT and OpenDocument files retain their existing viewing route.
The local signed Office pack supplies the separate read-only layout view.

## Paper editing follow-up

The paper editor preserves page/slide images and layout around editable text.
Word pages scroll continuously through a virtualized viewport; slides have
navigation and Page Up/Down or arrow shortcuts. Zoom is 50–200 percent.
Only complete, unique text matches are linked to native targets. Duplicate,
ambiguous, mixed-size and unsupported content stays visible and read-only.
These are constrained OOXML text edits, not a full Writer/Impress model.

A real Word page edit saved `WordCheck - Paper Edited.docx` in the Desktop
examples folder. Only `word/document.xml` differed and the original SHA-256
remained `f815894561b59c45d707eb3efc81f2dd0b6d674545fb673c68142fde37437403`.
Its text is `Edited directly on the Word page`.

The live check exposed an edited-snapshot refresh bug: the native spooler
compared the encoded snapshot size with its original disk provenance size.
Snapshot source stamps intentionally retain original provenance. The spooler
now checks original size only for disk input; snapshots already validate their
own exact byte length and SHA-256. The regression
`edited_snapshot_spools_its_own_length_instead_of_original_disk_length` passed.
The previous page remains visible with editing disabled while a new revision
renders. Page rendering bounds and signed-pack verification are unchanged.

The initial paper-editor full gate passed (Rust tests 848 seconds; UI tests
65 seconds). The final follow-up gate passed: formatting, warning-free Clippy,
complete Rust workspace tests (793 seconds), translations, IPC, 410 UI test
files / 2,254 tests (59 seconds), and frontend type check/build. The native
app test target reports 1,632 passed / 9 existing ignored; no tests were
disabled or weakened by this follow-up. The rebuilt live Word revision refresh passed: the
rendered page and its text controls changed to
`Live page refresh verified after editing`. The rebuilt PowerPoint surface
changed its title to `Edited on the original slide`, retained the visible
title/body formatting, and saved `SlidesCheck - Paper Edited.pptx`. Only
`ppt/slides/slide1.xml` changed; every other slide and embedded media part
matched the original, whose SHA-256 stayed
`f0e508408afdb8aedc83928f966fbeb6aaf9fdaaf1201c173d63545eafcd4b94`.
Two Right Arrow presses moved the active slide from 1 to 2 and then 3.
The embedded horse picture was visible on slide 3 of the live edited model.

## Installed local build

The final portable executable is `build/Adperastra-Office-Layout/Adperastra.exe`,
SHA-256 `5f1c77a10f06f8bb90a58f8622cdeae1523c5bd5e6a72da79a54c43ac6ea71e9`.
The Desktop shortcut `Adperastra Office Editing` points to it. Reopening the
saved PowerPoint copy retained the edited title and its original appearance.
The header zoom changed both the page and footer to 125%; footer Fit returned
the page to 100%. Slide status now uses the actual rendered slide count.

Seven superseded executables (893,855,744 bytes total) were moved to the
Recycle Bin under the owner's compilation-cleanup request. Their resolved
paths were checked to remain in the local build folder. Packs, application
data, source documents and saved examples were retained. The signed pack
continues to use the separate portable debug trust policy; this is a local
test installation, not a published or Windows-authenticode-signed release.
