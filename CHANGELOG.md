# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [v0.0.3-step01b] - 2026-10-28

### Added

- The Adperastra app window (Tauri 2 + React): custom title bar with the
  permanent Explorer tab, Help/Settings/component-gallery tabs, session
  restore, offline help center (F1), English/Spanish/pseudo-locale
  switching, light and derived dark themes from the design tokens.
- Security base: strict CSP, isolation allowlist, main-window-only
  commands, crash log and minidump capture (local only).
- The setup launcher now starts the app after a successful check.
- Known-issues register (KNOWN_ISSUES.md) and severity policy.

## [v0.0.2-step01a] - 2026-10-27

### Added

- Setup launcher that checks required components and repairs what is missing.
- Signed dependency manifest (dependencies.json) with pinned versions and checksums.
- First-run window for language, theme, and optional packs.
- Bundled WebView2 bootstrapper; static C runtime (no VC++ redistributable needed).

## [v0.0.1-step00] - 2026-10-27

### Added

- Build plan, architecture, contracts, and design inventory.
- Repository setup connected to the existing GitHub repository.
