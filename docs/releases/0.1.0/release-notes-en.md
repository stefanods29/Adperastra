# Adperastra 0.1.0

> **Draft — do not publish yet.** This file is prepared for the first release
> review. It becomes public only after `docs/releases/0.1.0/acceptance.md`
> records passing evidence and no open Blocker or Major remains.

## What this version is planned to include

- Explorer tabs, Home, folder browsing, selection, Details pane and the
  command registry.
- Safe file operations with job progress, Cancel and Undo, including the
  Recycle Bin, drag and drop and Paste as file.
- Built-in viewers for text, code, Markdown, images, audio and video,
  archives, tables, JSON, fonts, PDF files, e-books, notebooks, email,
  subtitles, logs, SQLite tables, 3D models, camera RAW, HEIC/AVIF and PSD.
- Text editing with Save and Save as, version history, and templates in the
  New menu.
- Archive creation with passwords and optional RAR reading through a
  separately installed 7-Zip.
- Local text recognition, quick preview, rich file details, the Gallery,
  conversion, batch presets and the optional privacy cleaner.
- Opt-in update checks. Nothing is downloaded or installed automatically.

## Formats and limits

The coordinator adds the tested formats and current limits here from the
acceptance evidence before publication. The in-app help describes the
supported viewers. Unsupported files open in their Windows app. Very large or
damaged files may be refused with a message rather than shown.

## Install and verify

Download `Adperastra-0.1.0-windows-x64-setup.exe` or
`Adperastra-0.1.0-windows-x64-portable.zip` together with `SHA256SUMS.txt`.
Verify the checksum before running anything. The installer is per-user and
does not need an administrator. It keeps settings and data during upgrades;
uninstall keeps them by default.

This release is unsigned. Windows may show “Windows protected your PC”.
Choose “More info” and “Run anyway” only after the checksum matches.

## Release gates still open in this draft

The following open issues must be resolved or explicitly moved with a reviewed
decision before publication: KI-069, KI-075, KI-087, KI-033 and KI-037. RAR
support must not be described as verified without the separate 7-Zip runtime
check (KI-081). Any statement in this draft is a plan, not observed evidence.

## License

Adperastra is MIT-licensed. Third-party components and source links are in
`THIRD_PARTY_LICENSES.txt` and `SOURCE-NOTICES.txt`.
