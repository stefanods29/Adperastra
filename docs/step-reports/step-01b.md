# Step 01b report - App shell, tokens, theme, languages, help, security base

Dates: 2026-10-27/28. Status: done. Tag: v0.0.3-step01b (PR #3).
Full reports were given in chat; this is the durable record.

## Owner decisions and approvals
- Derived dark theme: approved by the owner on 2026-10-28 (recorded in
  DESIGN_DEVIATIONS.md).
- Snap layouts: fixed without restoring the native frame (owner
  instruction). The custom maximize button reports HTMAXBUTTON to
  Windows; verified by sending WM_NCHITTEST (maximize returns 9,
  close/content return HTCLIENT). Visual flyout confirmation by the
  owner is KI-005.
- Cold start (owner instruction: no silent deferral): fixed with an
  inline startup skeleton, lazy-loaded views, and a thin-LTO build, and
  measured instead of deferred. Numbers and method:
  docs/benchmarks/2026-10-28-startup-step01b.json. After-reboot numbers
  are KI-003 (Major until measured).
- Known-issues policy adopted (owner request): KNOWN_ISSUES.md,
  plan/rules.md section 11, AGENTS.md section 4.
- Branch protection on main is enabled once Step 01b is merged (per
  plan/git-and-testing.md): changes to main go through pull requests;
  configured on GitHub, not in code.

## How to run
.\scripts\package-app.ps1, then build\Adperastra\AdperastraSetup.exe
(it verifies and starts Adperastra.exe), or build\Adperastra\Adperastra.exe
directly. App data (settings, session, logs) lives in
%LOCALAPPDATA%\Adperastra unless ADPERASTRA_DATA_DIR is set.

## Verification (on the testing branch)
- cargo test --workspace: 15 (app) + 13 (setup-core) + 2 (launcher);
  npm test 12/12; npm run lint:i18n clean (probe-tested); builds clean.
- Packaged app: window opens, Explorer tab cannot be closed, session is
  saved every few seconds and restored, language/theme changes apply
  instantly and persist, Help center lists and renders 6 pages per
  language (F1), forced crash writes a local log and a real minidump.
- Screenshots: docs/screenshots/step-01b/ (Explorer light/dark, gallery,
  Settings in Spanish dark, Help). Structure compared with
  plan/design-sc/screens/01-explorer-home.png.

## Open items after this step (KNOWN_ISSUES.md)
- KI-001 first-ever run 2.2 s (Minor), KI-002 first start after
  install/rebuild 1.6 s paint (Minor), KI-003 after-reboot cold start
  unmeasured (Major; owner runs scripts\measure-startup.ps1 after a
  reboot), KI-004 placeholder app icon (Minor, before v0.1), KI-005
  snap flyout visual confirmation (Minor).
- Explorer content is a placeholder by design; real browsing is Step 02.

## Environment notes (development PC)
- MSVC C++ tools were installed during Step 01a (MACHINE.md).
- Windows security blocks cargo/rustc from creating folders under
  Documents, so builds use CARGO_TARGET_DIR=%TEMP%\adperastra-target
  (recorded in docs/benchmarks/MACHINE.md and used by the packaging
  scripts). Native Rust binaries likewise cannot write under Documents;
  app data therefore lives in %LOCALAPPDATA% by design.
