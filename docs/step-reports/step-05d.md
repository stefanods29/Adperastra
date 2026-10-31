# Step 05d report - Appearance, built-in themes, Settings page

Dates: 2026-10-30. Status: **merged into local `testing`. The full gate passed (193 Rust tests and 334 UI tests before the last CSS fix; it passed again after it). The speed run, the pseudo-locale screenshots and the owner's hand checks are still to do.** Nothing was pushed and `main` was not touched.

## How to try it

```powershell
.\scripts\gate.ps1 -Package
.\build\Adperastra\Adperastra.exe
```

## Owner checklist

1. Settings > **Theme**: six cards with previews. Click each light card in Light mode and each dark card in Dark mode: the whole app changes at once (Explorer, a text file tab, menus, dialogs, scrollbars, focus outlines).
2. **System** mode: change Windows between light and dark: the app follows with the chosen light and dark themes.
3. **High contrast**: every text is easy to read; selected rows and focus outlines are clearly visible.
4. Settings > **Appearance** > **UI scale**: 75 %, 125 %, 200 %: everything scales; menus open where you click; right-click > **Show more options** opens at the pointer; restart the app: it starts at the chosen scale without a jump.
5. **Density** Compact and Spacious: rows in Details, List and Columns change height; scrolling and arrow keys still work; the navigation pane follows.
6. **Corner radius** Square and Round; **Animations** Off: no shimmer on loading rows, switches flip without animation.
7. Search for "toolbar", "densidad" (in Spanish), "amoled": only matching sections stay. Click a section in the left list: the page jumps there.
8. **Reset to default** under Appearance after changing it: back to standard; **Undo** brings your changes back. **Reset all settings…**: asks first; afterwards the language is unchanged; **Undo** works.
9. **Export settings…** to the Desktop: a `.json` file appears; export again with the same name: Windows asks; the old file is in the Recycle Bin. Change a few settings, **Import settings…** that file: it asks first, then the old settings return; **Undo** works. Try importing a text file renamed to `.json`: a clear message, nothing changes.
10. Repeat checks 1, 4 and 7 in Spanish and in the dark theme.

## What works

- Settings schema 9, migrated from schema 8 without losing anything: `theme.light_theme` and `theme.dark_theme`, plus a new `appearance` section (UI scale, density, corner radius, animations). Rust validates every value; TypeScript normalizes a hand-edited or imported file field by field.
- Six built-in themes, one token file each: Adperastra light (the design, unchanged) with Bright and Paper for light mode, and Adperastra dark with AMOLED black and High contrast for dark mode. Each has a preview card in Settings > Theme; the mode (System, Light, Dark) decides which of the two chosen themes applies, and System still follows Windows.
- A contrast test checks every theme: text on the window 7:1, secondary text 4.5:1, text on a selected row 4.5:1, text on the accent 4.5:1 and the accent on the window 3:1. High contrast keeps secondary text at 7:1.
- The dark theme's text on the accent is black now (white on `#4CC2FF` was about 2:1).
- Appearance: UI scale from 75 % to 200 % as the webview's page zoom, applied by Rust at start (no jump) and by a command when it changes, with the classic **Show more options** menu placed with the scale included; density (Compact, Comfortable, Spacious) sets the spacing tokens and the row heights of the Details list, List view, Column view, the navigation pane, Home lists and skeleton rows; corner radius (Square, Standard, Round) sets the radius tokens; animations (Full, Reduced, Off) follow Windows' "show fewer animations" setting first.
- A rebuilt Settings page: a search box that matches section titles and the labels inside them (case and accents ignored, in the app language), a section list on the left that jumps to a section, and six sections in order (General, Appearance, Theme, Layout, Views, Opening files), each with its "?" help button and a **Reset to default** button below it.
- **Reset all settings…** asks first and keeps the language and the saved layout presets; after a section reset, a reset-all or an import, a notice offers **Undo** until it is dismissed or the page is left.
- Export and import of `settings.json` through Windows' own file dialogs: export writes pretty JSON, asks before replacing (the old file goes to the Recycle Bin first, and nothing is written if recycling fails); import reads at most 1 MB, accepts schema 1 to the current one (older files are migrated, newer ones are refused) and asks before applying, with Undo.
- Help pages "Themes and appearance" and "The Settings page" in English and Spanish; "Changing language and theme" rewritten. The Settings tab's F1 pages and the settings sections' "?" buttons open them.

## Not in this step (on purpose)

- No theme editor, custom themes, day and night schedule or wallpaper accent (Step 10a).
- No keyboard shortcut or toolbar button customization (Step 10b); no date, size or tab options (Step 10c).
- No Windows high-contrast (`forced-colors`) detection and no full accessibility settings (Step 10f); High contrast is an ordinary theme here.
- No fonts other than Inter and no font size setting.
- Density does not change the icon views' cell sizes.
- Export and import cover `settings.json` only, not folder views, sessions or the Explorer state.

## Decisions and plan changes made during the step

- **F1 (Step 03b's code):** the full gate found that a pasted image could be saved under a garbled name, because the name passed to Windows had no terminating zero (KI-036). Fixed in `src-tauri/src/clipboard.rs`, with a new test.
- **T1 to T8** were already committed when this session started; this session built **T9** (help pages), **T10** (screenshot steps) and **T11** (speed measurements and design notes), each committed on its own.
- **T10 checkpoint:** the worker did not run it, because the batch rules forbade screenshots. The screenshots were taken after the merge. The owner asked the agent to check them instead (2026-10-30); see `DESIGN_DEVIATIONS.md`.
- **T7 and T8** were finished in the main session, because the worker could not be restarted at the time. T1 to T6 and T9 to T11 were built by the worker.
- **F2 (Step 05c's code):** the density screenshots showed nearly every toolbar button in the overflow menu, because the bar was only as wide as its buttons (KI-035). Fixed in `src/styles/layout.css`.
- **T10 screenshot script.** The eight new shots (`31-theme-bright` to `38-settings-search`) are added after Step 05c's last action (Standard preset, Explorer shown). The script remembers which theme mode was pressed when Settings first opened and puts the standard `light`/`dark` cards and that mode back before the density shots, so the rest of the run and the next runs see the same settings. Each theme shot opens Settings, clicks the mode and the card, returns to the Explorer, clicks the third item and waits 300 ms. Search text is typed with the native value setter and a bubbling `input` event, the way the page's own handler expects it.
- **T11 item 1** ("the record's step value `05c` becomes `05d`"): `scripts/measure-ui.mjs` has no literal step value and never had; the record's step comes from the command line (`-Step`, else the branch name, `step-05d-appearance` gives `05d`). Nothing to change, the same as in Step 05c.
- **T11 measurements** are added after Step 05c's last measurement (the Classic preset), open Settings once, measure "switch to the dark theme (Settings)" and "change the density (Settings)", then put the remembered theme mode and the comfortable density back and show the Explorer again, so the app is left as it started.
- No other change from the guide.

## Speed (development PC, packaged release build)

To be measured by the owner; the two interactions are in `scripts/measure-ui.mjs`, the other three are by hand.

| Interaction | Tier | Measured (median) | Result |
|---|---|---|---|
| Switch the theme | Fast (1 s) | pending | pending |
| Change the density | Fast (1 s) | pending | pending |
| Change the UI scale | Fast (1 s) | by hand, pending | pending |
| Search in Settings while typing | Instant (0.1 s) | by hand, pending | pending |
| Every existing measurement | as before | pending (not more than 20% slower than Step 05c's JSON) | pending |

Raw numbers: `docs/benchmarks/` (to be written by the owner's run).

## Checks by hand

The owner fills this table (or tells you the results in chat and you copy them). Until then, every Result is "waiting for the owner".

| Check | English light | Spanish dark | Result |
|---|---|---|---|
| 1. Six theme cards, every theme applies at once | waiting | waiting | waiting |
| 2. System mode follows Windows with the chosen themes | waiting | waiting | waiting |
| 3. High contrast is easy to read | waiting | waiting | waiting |
| 4. UI scale 75/125/200 %, menu position, restart | waiting | waiting | waiting |
| 5. Density Compact and Spacious in Details, List and Columns | waiting | waiting | waiting |
| 6. Square/Round corners, animations Off | waiting | waiting | waiting |
| 7. Settings search and the section list | waiting | waiting | waiting |
| 8. Section reset and reset-all with Undo | waiting | waiting | waiting |
| 9. Export and import, overwrite prompt, Recycle Bin, a bad file | waiting | waiting | waiting |
| 10. Checks 1, 4 and 7 in Spanish and dark | waiting | waiting | waiting |

## Verification

- Not run in this batch (owner's rules): `.\scripts\gate.ps1`, `.\scripts\gate.ps1 -Package`, `npm test`/Vitest, `cargo test`, the packaged app and the screenshots.
- T9 to T11 changed no Rust code, so no cargo run was needed in this session. T1 (`main.rs` settings), T4 (`appearance.rs`, `main.rs`) and T8 (`settings_file.rs`, `shell.rs`, `main.rs`) changed Rust; `cargo fmt --all` and `cargo check --workspace --all-targets` belong to those tasks.
- Run after T9, T10 and T11, all passing: `npm run lint:i18n` (582 keys, 33 help pages, 89 tsx files), `npm run lint:ipc` (60 commands, 59 invoke calls), `npm run build` (`tsc --noEmit` plus the Vite build; only the existing chunk-size warning). `node --check scripts/measure-ui.mjs` after the two script changes.
- New tests (none of them run yet):
  - Rust: `settings_v8_migrates_to_v9_keeping_language_and_theme`, `settings_validate_rejects_bad_appearance` (`main.rs`); `ui_scales_are_the_listed_percentages`, `screen_point_includes_the_ui_scale` (`appearance.rs`); `parse_import_accepts_current_and_older_files`, `parse_import_refuses_other_files`, `check_texts_and_paths` (`settings_file.rs`); `settings_defaults` now expects schema 9.
  - UI: `themes.test.ts` (5), `tokens.test.ts` (+2: "every theme has the same tokens as the light theme", "the dark theme writes black on its accent"), `applyAppearance.test.ts` (2), `density.test.tsx` (3), `themeSettings.test.tsx` (3), `appearanceSettings.test.tsx` (2), `settingsSections.test.ts` (4), `settingsView.test.tsx` (5), `settingsFile.test.ts` (2); `settings.test.ts` gained "normalizes the theme choice and appearance (schema 9)" and its schema-9 expectations.

## Screenshots

`docs/screenshots/step-05d/`: all earlier screens plus `31-theme-bright` to `38-settings-search`, in English light and Spanish dark. The pseudo-locale set is pending. `34` and `36` in Spanish dark show the message logged as KI-037.

## Known issues

- New: none found while building T9 to T11.
- Fixed: none.
- Still open: the existing entries are unchanged; the ones near this step's screens are KI-033 (Major, going to the open folder empties the list), KI-034 (Minor, narrow layouts crowd the address bar) and KI-035 (Minor, the line under the toolbar stops partway). None of them was caused by this step.

## Design deviations, dependencies, licenses

- `DESIGN_DEVIATIONS.md`: new section "2026-10-30 - Themes and appearance (Step 05d)" (the four new themes designed from the tokens, the dark theme's text on the accent now black, density and corner radius values). It records that the agent checked the screenshots at the owner's request.
- New dependencies: none.

## Commits

```text
git log --oneline testing..HEAD
ef69f73 test(speed): theme and density measurements, design notes [step-05d/T11]
be53858 test(screens): theme and density screenshots [step-05d/T10]
b0bbbc1 docs(help): themes, appearance and the Settings page [step-05d/T9]
bfccb95 feat(settings): export and import the settings file [step-05d/T8]
fe1126d feat(settings): searchable Settings page with section resets [step-05d/T7]
1db4d4c feat(settings): General, Theme and Appearance sections [step-05d/T6]
e62b0c4 feat(appearance): density sets the height of list rows [step-05d/T5]
ff79381 feat(appearance): UI scale through the webview zoom [step-05d/T4]
0d254a9 feat(appearance): apply the theme, density, corners and animations [step-05d/T3]
2fe17d5 feat(themes): six built-in themes with contrast checks [step-05d/T2]
1311b2e feat(settings): theme choice and appearance (schema 9) [step-05d/T1]
```

## Next step

Step 06a: Text editing (from `plan/STATUS.md`).
