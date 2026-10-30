# Step 04c report - Audio and video player, protected view, Open as text or hex, Default apps

Dates: 2026-10-30. Status: built on the local branch `step-04c-media-protected-defaults`; the owner's checks, the speed run, the screenshots, the packaging gate and the merge are still to do (local-only batch).

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

1. Double-click the MP3: the player shows the music icon, the file name and the controls. Press Space: it plays; Space again pauses. The status bar shows the length, "Audio" and the size.
2. While it plays, switch to the Explorer tab: the music keeps playing. Come back and click Pause on the ribbon.
3. Ribbon: Loop turns on and off; Speed 1.5× plays faster. Close the tab and open the MP3 again: Speed and Loop are as you left them.
4. Double-click `Clip.mp4`: the video plays in the tab. Subtitles on the ribbon lists "Clip.srt"; choose it: "Hello from the subtitles" shows in the first seconds. Choose Off: it disappears.
5. Double-click the MKV video: it opens in its Windows app, not in a tab.
6. Hold Alt in the player: P and L key tips show; Alt+P plays and pauses.
7. Double-click `downloaded.md`: the yellow bar says the file came from the internet. Click "web link" on the page: nothing happens.
8. Click Unblock on the bar, then Cancel: nothing changes. Click Unblock again, then Unblock in the dialog: the bar disappears; "web link" now asks before opening. In Windows Explorer, right-click `downloaded.md` > Properties: the Unblock box is gone.
9. Settings > Opening files: turn off Protected view, run the commands above again (they mark `downloaded.md` again) and open it again: no bar. Turn Protected view back on.
10. Right-click `picture.png` > Open as > Open as hex: a tab shows rows with offsets, hex and text; the first row's text starts with ".PNG". Ctrl+= makes it bigger. Double-click `picture.png`, then right-click it > Open as > Open as text: a third tab opens; the picture's tab stays.
11. Right-click `page.html` > Open as > Open as text: the text viewer shows it. Double-click `page.html`: it opens in the browser.
12. Settings > Opening files > Default apps: set Text to "Windows app", then double-click `notes.txt`: it opens in Notepad (or your text app). Set Text back to "Adperastra": it opens in a tab again. Type `mp3` in the search box: only the .mp3 row shows.
13. Right-click a folder: there is no Open as menu.
14. Spanish and dark theme: repeat 1, 7, 10 and 12.

The test files for these checks are created by the PowerShell commands in the step file (`%TEMP%\adperastra-04c`).

## What works

- Settings schema 5: `open.protected_view` (on by default) and `open.open_with`, with Rust and TypeScript validation, migration from schema 4, and the updated measurement script settings.
- Mark of the Web: a file whose `Zone.Identifier` says zone 3 or 4 is marked as downloaded; Unblock removes only that stream (`file_unblock`), never the file's content.
- Protected view bar in file tabs, with the Windows 11 caution colors, a confirmation dialog, error messages and a help page; the Markdown viewer ignores links while protected view is on.
- Subtitle files next to a video (`media_sidecars`), up to 20, limited to a bounded folder scan.
- Audio and video player: MP4/M4V/WebM video and MP3/M4A/AAC/WAV/OGG/Opus/FLAC/WebA audio through the `adpfile` protocol; ribbon Play/Pause/Loop/Speed/Subtitles; speed and loop saved in the tab; a clear message with "Open in Windows app" when a format cannot be played.
- Hex viewer: 16-byte rows with offset, hex and text, 1 MB parts with Alt+Page Up / Alt+Page Down, Ctrl+= / Ctrl+- / Ctrl+0 zoom saved in the tab; never chosen by file type.
- Open as > Open as text / Open as hex in the file right-click menu, limited to 15 files and only for files; a file can be open in its usual viewer and as text or hex at the same time.
- Settings > Opening files: Protected view switch and Default apps with one group per built-in viewer, group and per-type choices, search, and only "windows" stored.
- Ribbon: a group whose controls are all hidden is left out; Page Up / Page Down shortcut names are translated.
- Help pages in English and Spanish: protected view, playing audio and video, open as text or hex, choosing how files open.

## Not in this step (on purpose)

- No editing from the protected view bar (Step 06a adds "Enable editing").
- No search in the hex viewer and no Go to offset (Step 06f).
- No MKV, AVI, WMV or MOV playback: they open in their Windows app.
- No "downloaded" badge in the Details pane (Step 07b), no Microsoft Defender scan, no trusted folders for protected view.
- Folders, shortcuts (.lnk) and programs open exactly as before.

## Decisions and plan changes made during the step

- T5's change to `src/ribbon/Ribbon.tsx` ("a hidden control is skipped") was already present from Step 04b (`if (!command || !isCommandVisible(command, ctx)) return null;`). Nothing was changed; the behavior the task requires already holds.
- T9's change of `step: "04b"` to `step: "04c"` does not apply: the measurement script already records `step: stepId`, passed as the ninth argument by `scripts/measure-ui.ps1`. No hard-coded step id remains.
- The byte-order mark in the subtitle helpers and their tests is written as `\uFEFF` instead of an invisible literal character. Same behavior, and the source file stays readable.
- No plan files were changed in this step.

## Speed (development PC, packaged release build)

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Open a WAV file in the player (first view) | Fast (1 s) | pending | pending |
| Earlier rows (selection, menus, folder open, image, text and Markdown tabs) | as before | pending (must not be more than 20% slower than `docs/benchmarks/<date>-ui-step04b.json`) | pending |

Raw numbers: `docs/benchmarks/<date>-ui-step04c.json` (to be written when the measurements run).

## Checks by hand

The owner fills this table (or tells the results in chat and the agent copies them). Until then, every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1. MP3 plays, Space pauses, status bar | waiting for the owner | waiting for the owner | pending |
| 2. Playback continues on the Explorer tab | waiting for the owner | waiting for the owner | pending |
| 3. Loop and Speed persist in the tab | waiting for the owner | waiting for the owner | pending |
| 4. MP4 with Clip.srt subtitles, then Off | waiting for the owner | waiting for the owner | pending |
| 5. MKV opens in its Windows app | waiting for the owner | waiting for the owner | pending |
| 6. Alt key tips P and L, Alt+P | waiting for the owner | waiting for the owner | pending |
| 7. downloaded.md shows the yellow bar and links do nothing | waiting for the owner | waiting for the owner | pending |
| 8. Unblock asks, removes the bar and the mark | waiting for the owner | waiting for the owner | pending |
| 9. Protected view setting off hides the bar | waiting for the owner | waiting for the owner | pending |
| 10. Open as hex and Open as text, zoom, separate tabs | waiting for the owner | waiting for the owner | pending |
| 11. page.html as text, then in the browser | waiting for the owner | waiting for the owner | pending |
| 12. Default apps: Text to Windows app and back, search | waiting for the owner | waiting for the owner | pending |
| 13. No Open as menu on folders | waiting for the owner | waiting for the owner | pending |
| 14. Spanish and dark theme repeats | waiting for the owner | waiting for the owner | pending |

## Verification

Per the local-only batch rules, the full gate and the test suites were not run after each task. Every task ran: `cargo fmt --all`, `cargo check --workspace --all-targets`, `npm run lint:i18n`, `npm run lint:ipc` and `npm run build` (which includes `tsc --noEmit`); all passed. `node --check scripts/measure-ui.mjs` passed after T9.

- `.\scripts\gate.ps1 -Package`: pending (to run later, one step at a time).
- New Rust tests: `settings_v4_migrates_to_v5_keeping_language_and_theme`, `settings_validate_rejects_bad_open_with`, `mark_of_the_web_is_read_and_removed`, `only_internet_zones_count`, `zone_stream_never_targets_another_stream`, `unblock_refuses_folders_and_missing_files`, `finds_subtitles_named_after_the_video`, `lists_at_most_twenty`, `reads_the_video_folder`.
- New UI tests: "keeps valid opening-file choices and drops invalid ones" (`settings.test.ts`); `mediaHelpers.test.ts` (four cases); `mediaView.test.tsx` (three cases); "plays audio and video in the app, other video types in Windows" (`openPipeline.test.ts`); `hexFormat.test.ts` (two cases); `hexView.test.tsx`; "leaves out a group whose controls are all hidden" (`ribbon.test.tsx`); the Page Down line in `shortcuts.test.ts`; `defaultApps.test.tsx` (four cases).

## Screenshots

`docs/screenshots/step-04c/`: `15-audio-tab` and `16-protected-view` (new), plus all earlier screenshots, in English light, Spanish dark and the pseudo-locale. Pending; to be taken with the measurements. Design comparison pending.

## Known issues

- New: KI-032 (Minor) the hex viewer has no search or Go to offset until Step 06f.
- Fixed: none.
- Still open: KI-001, KI-002, KI-003, KI-004, KI-005, KI-009, KI-015, KI-016, KI-023, KI-024, KI-030, KI-032. Each was reviewed for this step: none touches the new code.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: none. The only new values are the two Windows 11 caution colors added to the light and dark token files, as the step file gives them.
- New dependencies: none. All libraries used (React, lucide-react, @tanstack/react-virtual, i18next, Tauri) were already listed in `plan/libraries.md`.

## Commits

```
2007dd8 feat(settings): opening-files settings: protected view and default apps (schema 5) [step-04c/T1]
74baadc feat(files): recognize files from the internet and unblock them [step-04c/T2]
424e8a7 feat(tabs): protected view bar for files from the internet [step-04c/T3]
9e7057d feat(media): list subtitle files next to a video [step-04c/T4]
63dee3c feat(viewer): audio and video player with speed, loop and subtitles [step-04c/T5]
c3bdb42 feat(viewer): hex viewer in 1 MB parts [step-04c/T6]
6f5303c feat(explorer): Open as text and Open as hex [step-04c/T7]
394f96b feat(settings): Opening files section with protected view and default apps [step-04c/T8]
47f2815 test(bench): measure opening a WAV file; audio and protected view screenshots [step-04c/T9]
```

## Next step

Step 05a: View modes: List, Icons, Tiles, Content (from `plan/STATUS.md`).
