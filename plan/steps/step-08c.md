# Step 08c: First release (v0.1) (★★)

**Needs:** 08b. **Builds:** release pipeline. **Milestone:** v0.1 (see `AGENTS.md`, section 6).

## Tasks
- **Release builds on GitHub Actions:** an installer (Tauri's bundler, for example NSIS, zlib license) and a portable zip, built from the tagged commit on `main`, with release builds excluding all test code and files (verified by a check).
- **Checksums:** a SHA-256 checksum file published with every release, plus GitHub's free build attestations if available for the repository, so anyone can verify a download came from the repository.
- **Release notes** generated from `CHANGELOG.md`, and a "What's new" help page in every app language, shown once after updating.
- **Draft release for my approval:** prepare the GitHub release as a draft and ask me before publishing.
- **No code signing.** Releases are not signed with a certificate. Windows SmartScreen may show "Windows protected your PC" for a new, unsigned app; the README and the release notes explain this in plain language, how to continue ("More info" > "Run anyway"), and how to verify the checksum first. (Code signing stays in the backlog, only if users ask.)
- **Installer behavior:** per-user install by default (no admin rights needed), Start menu shortcut, uninstaller that asks whether to keep or remove my settings and app data (version history, caches, packs), and the setup window (Step 01a) runs on first start.
- **Portable mode basics:** the portable zip keeps its settings and data next to the app (fully completed in Step 10a).
- **Update check (optional, off by default):** if I turn it on, the app checks GitHub Releases for a newer version and shows a link to the release page; it never downloads or installs anything by itself.
- Test install, update over the previous version, and uninstall in Windows Sandbox (`git-and-testing.md`).

## Help pages
Installing and updating; portable mode; verifying a download; "What's new".

## Done when
A draft GitHub release with installer, portable zip, checksums, and notes exists; installing, updating, and uninstalling work cleanly in Windows Sandbox; I've approved and published v0.1.
