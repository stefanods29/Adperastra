# Adperastra 0.1.0 acceptance matrix

**Status: NOT ACCEPTED. No row below has been executed by the worker that
prepared this file.** A guide, a code path or an unrun test is not evidence.
A row becomes Pass only when it links a coordinator-produced record (step
report, Sandbox log, benchmark JSON, screenshot, workflow run or artifact
verification output).

## Readiness gates

| Gate | Requirement | Status |
|---|---|---|
| G1 | No open Blocker | pending coordinator confirmation |
| G2 | No open Major for anything v0.1 touches, or a reviewed move to a named later step before the next milestone | pending |
| G3 | Every fixed artifact name present, SHA-256 and size verified, unsigned as intended | pending |
| G4 | `THIRD_PARTY_LICENSES.txt` and `SOURCE-NOTICES.txt` match the locked dependencies and tagged source | pending |
| G5 | Full `scripts/gate.ps1 -Package` passes on the tagged commit | pending |
| G6 | Release workflow cannot publish by tag alone and has no publish job | pending workflow review |
| G7 | Installer/portable matrix below passes on a clean Windows 11 Sandbox | pending |
| G8 | Speed results are within their tiers and not more than 20% slower than the previous step's JSON | pending |
| G9 | English light, Spanish dark and pseudo-locale light screenshots match the design | pending |
| G10 | Owner explicitly authorizes publication | pending; publication is an OWNER CHECKPOINT |

## Open issues that block readiness

| Issue | Severity | Why it blocks v0.1 | Status in this draft |
|---|---|---|---|
| KI-069 | Major | Content replacement has a close-to-replace path race | open; blocks |
| KI-075 | Major | Packaged editor reports style CSP violations; console-clean check fails | open; blocks |
| KI-087 | Major | Save as cannot replace an existing file | open; blocks (fix planned for 09f) |
| KI-033 | Major | Going to the already open folder empties the list | open; blocks |
| KI-037 | Major | Undo history can report no room after a few operations | open; blocks |
| KI-081 | Minor, pending acceptance | RAR is unverified without a separately installed 7-Zip; becomes Major if claimed verified | open; do not claim verified |
| KI-070 | Minor, bounded deferral | Build-only image parser advisories; must be reviewed before v0.1 is prepared | open; review due |
| KI-068, KI-079 | fixed | Previous save/extraction blockers | fixed; recheck in the gate |

No row may be marked Pass while a related Blocker or Major is open. The
existing-error policy does not turn an open issue into a pass.

## Installer and portable matrix

Run in a fresh Windows 11 Sandbox with synthetic files only. Record the OS
build, WebView2 version and network availability with every row. Never run a
Remove test against the owner's real `%LOCALAPPDATA%\Adperastra`.

| ID | Scenario | Expected result | Evidence file | Status |
|---|---|---|---|---|
| I1 | Clean install, current user | Installs under `%LOCALAPPDATA%\Programs\Adperastra`; no administrator prompt; app starts; Start menu entry and uninstall entry exist | `evidence/install-clean.txt` | not run |
| I2 | Upgrade from previous build | Settings, versions, packs and open-file history stay; new binary reports 0.1.0 | `evidence/install-upgrade.txt` | not run |
| I3 | Reinstall / repair | Same version reinstalls without duplicating shortcuts or losing data | `evidence/install-reinstall.txt` | not run |
| I4 | Failed binary upgrade | Old `Adperastra.exe` is restored; data folder bytes unchanged; bilingual error shown | `evidence/install-failed-upgrade.txt` | not run |
| I5 | Uninstall, default Keep | App binaries removed; settings and data remain; no data folder in the Recycle Bin | `evidence/uninstall-keep.txt` | not run |
| I6 | Uninstall, explicit Remove | Second confirmation lists settings, cached data, packs and version history; only the exact synthetic data folder appears in the Recycle Bin | `evidence/uninstall-remove.txt` | not run |
| I7 | Remove with a junction or foreign folder | Helper refuses; nothing is recycled; message shown | `evidence/uninstall-refused.txt` | not run |
| I8 | Portable ZIP, writable folder | Starts with data in `AdperastraData`; marker contains only `enabled`/`version` | `evidence/portable-writable.txt` | not run |
| I9 | Portable ZIP, read-only folder | Offers Choose data folder… / Cancel; Cancel keeps the previous installed data location; no settings copy | `evidence/portable-readonly.txt` | not run |
| I10 | Offline start | App starts and all local viewers work; update check is off by default; no network request without opt-in or Check now | `evidence/offline.txt` | not run |
| I11 | WebView2 missing | Installer offers the pinned bootstrapper with its checksum; a failed/offline install explains what is missing and writes no app data | `evidence/webview2-missing.txt` | not run |
| I12 | Update check, default | Zero network requests; Check now works only after the user chooses it; nothing downloads or installs | `evidence/updates-default.txt` | not run |
| I13 | Update check, opt-in | One automatic check at most per 24 hours; manual check bypasses the timer but does not turn the setting on | `evidence/updates-optin.txt` | not run |
| I14 | What's new | Shown once after a version change when the app is ready; dismissible; reopenable from Help; not repeated after a failed settings write in the same session | `evidence/whats-new.txt` | not run |

The Remove test may delete only the pre-created synthetic folder. A real user
data folder is never used.

## v0.1 feature traceability

Every advertised capability needs a link to actual passing evidence. Until
then, the release notes and What's new page must say "planned", not "works".

| Capability | Producing step | Required evidence | Status |
|---|---|---|---|
| Explorer, Home, folder browsing, selection, Details pane, command bar | 02, 03a, 05a-05d | Step reports, screenshots, speed JSON | not verified here |
| File operations, jobs, Undo, drag and drop, Paste as file | 03b | Step report, failure/cancel tests, screenshots | not verified here |
| File tabs, text/code/Markdown viewers, images, audio/video, protected view | 04a-04c | Step reports, format matrix, screenshots | not verified here |
| Columns, layout presets, themes, Settings | 05b-05d | Step reports, contrast/screenshots, speed JSON | not verified here |
| Text editing, version history, templates | 06a-06c | Step reports, byte-exact save/restore evidence | not verified here |
| Archives: read, extract, create, passwords, RAR note | 06d, 06e | Step reports, archive corpus, RAR runtime evidence or explicit limitation | not verified here |
| Tables, JSON, fonts, hex search | 06f | Step reports, 100k-row/format evidence | not verified here |
| Thumbnails, cache, background work, quick preview, rich info, Gallery | 07a-07c | Step reports, cache/speed JSON, cloud-file skip evidence | not verified here |
| PDF viewer, OCR, e-books, notebooks, email, subtitles, logs, SQLite, 3D, RAW, HEIC/AVIF, PSD | 07d-07g | Step reports, format matrix, helper isolation evidence | not verified here |
| Conversion (images, PDF, documents, sheets, archives, batch presets) | 08a, 08b | Step reports, round-trip and cancel evidence | not verified here |
| Privacy cleaner | 08c | Step reports, selective-removal evidence | not verified here |
| Installer, portable mode, update checks, unsigned warning | 08d | This matrix plus artifact verification | not run |

## Speed

Run the measurements from the step file: cold start and warm startup 5 runs,
common interactions 7 runs, a 100,000-item folder and every file type. Record
cold and warm results and compare with the previous JSON. Recheck the cold
start named in D9, not only the warm number. A tier miss or a result more than
20% slower than the previous step is a Major until fixed or explicitly moved
with a reviewed decision. No numbers are copied from memory.

## Screenshots

Reserve 88-release-install, 89-release-update-settings and
90-release-whats-new in English/light, Spanish/dark and pseudo/light where the
UI applies. Installer English and Spanish captures use separate owned file
names. Check for cut-off text, missing focus outlines and untranslated strings.

## Sign-off

| Role | Name | Decision | Date | Evidence link |
|---|---|---|---|---|
| Coordinator | pending | not signed | — | — |
| Owner | pending | not asked until the OWNER CHECKPOINT | — | — |

Publication stays blocked until every gate is Pass and the owner explicitly
authorizes it.
