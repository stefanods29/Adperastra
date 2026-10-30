# Step 12a: Pack manager, App storage, and the Background work page (★★★★)

**Needs:** 11c. **Builds:** pack manager, app storage manager, full background work controls. **Design:** App storage and Background work pages aren't in Figma; design them first.

## Tasks
- **Pack manager:** packs described by signed manifests (name, version, size, what it enables, license, download URL, SHA-256 checksum, dependencies on other packs); download only after I choose it; verify checksums and signatures; versioned installs into the app's data folder; clean removal; the same packs available in a full offline installer. Downloads run as background jobs with progress, pause, resume, and Cancel. Packs run in helper processes as described in `rules.md`, section 5.
- **First-run choices:** install the packs I selected in the setup window's first-run checklist (Step 01a), in the background, showing progress.
- **App storage page (Settings > App storage):** the only place to install, update, or remove optional packs after the first run.
  - **Packs:** each with what it enables, size, version, license, installed date, and Install / Update / Remove buttons; features that need a missing pack show a short message with a button that opens this page.
  - **Stored data:** thumbnails and preview cache, OCR text, search and content index, AI indexes (photo search), version history, clipboard history (if kept), crash logs, and downloaded update notes, each with its current size, a limit, and a Clear button (with a confirmation that says what will be lost).
  - **Total size** of the app and its data, and free disk space.
- **Background work page (Settings > Background work)**, expanding Step 07a: every background task in one list (thumbnails, file-name index, content index, OCR, folder sizes, storage scans, version cleanup, pack downloads, and AI indexing later), each with on/off, current status, and progress; rules for all of them: only when idle, only on AC power, pause while a full-screen app runs, quiet hours, and a CPU limit; a global "Pause all background work" button, also available from the title bar and the command palette.
- Optional pack candidates to register now (built in later steps): media tools (FFmpeg), Office engine, extra OCR languages (Tesseract), and the AI packs (Steps 14c, 17a-17d).

## Help pages
App storage; installing and removing packs; background work settings.

## Done when
The packs I chose on first run install in the background; I can install and remove a test pack from App storage; I can see and clear every cache with its size; pausing all background work stops every background task immediately.
