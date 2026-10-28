# Step 01a report - Setup window and first-run pack checklist

Date: 2026-10-27. Status: done. Tag: v0.0.2-step01a (PR #2).
Full reports were given in chat; this is the durable record.

## Owner decisions and approvals
- Setup-window design approved as a text design (recorded in
  DESIGN_DEVIATIONS.md, marked approved 2026-10-27): repair window plus
  one-time first-run window (language, theme, optional packs, nothing
  preselected).
- With all components present, the launcher exits silently and logs the
  result (no placeholder window); starting the Explorer was wired up in
  Step 01b.
- Missing runtimes are installed in this step, not deferred (owner
  request): WebView2 via the pinned, bundled Evergreen Bootstrapper with
  the download only as a checksum-verified fallback; the Visual C++
  runtime is avoided entirely by statically linking the C runtime
  (+crt-static), so it was removed from dependencies.json.
- Manifest signing now (owner request): minisign development key, public
  key built into the launcher, private key outside the repository at
  %USERPROFILE%\.adperastra\dev-signing.key (docs/decisions/0004-manifest-signing.md).
- --simulate-missing exists only in development/test builds (owner
  request); release builds ignore it with a logged warning.

## How to run
.\scripts\package-setup.ps1, then build\Adperastra\AdperastraSetup.exe
(options: --repair, --first-run, --reset-profile, --headless; see
build\Adperastra\RUN.txt).

## Verification (on the testing branch)
- cargo test: 10/10 setup-core tests at first report, 13/13 after the
  completion fixes (signature valid/tampered/missing, installer fallback).
- Functional matrix on the packaged build: silent start exit 0
  (71-85 ms), deleted font repaired, corrupted font repaired by hash,
  signature tampered/missing refused with exit 4, simulated-missing
  WebView2 installed end-to-end (exit 0), release build ignores
  --simulate-missing with a warning.
- Screenshots: docs/screenshots/step-01a/ (9 images, EN/ES, light/dark).

## Open items after this step
- None from 01a itself. Minisign release key replaces the dev key in
  Step 08c (ADR 0004). Runtime installers for packs join the pack manager
  in Step 12a.
