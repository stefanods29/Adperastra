# Office preview release preparation — 2026-11-04

The owner explicitly requested compilation, GitHub publication and a usable
Office release, preceded by a plus-button Home-tab change and full README.
The authorized release is v0.1.0-preview.1, an experimental portable preview,
not acceptance of the unfinished v0.1 roadmap milestone.

The plus button opens independent Home tabs; its adjacent arrow retains tab
options. Home is a reserved UI location, never a filesystem path. Session
schema 3 preserves it and protects against older applications rewriting it.
The focused navigation/session checks passed: four files, 19 tests.

The full hardened gate passed: formatting, strict Clippy, Rust workspace
tests (162 seconds), i18n, IPC, 411 UI test files / 2,256 tests (43 seconds),
and frontend build. Nine existing native ignored tests remain unchanged.
No work factors, test assertions, security checks or coverage gates were
weakened. Development scrypt code is optimized to preserve real KDF parameters
without the earlier unoptimized test delay.

Rust and npm audits report zero vulnerabilities, and dependency license checks
pass. Security pin/compatibility changes are recorded in plan/libraries.md and
KI-115. Excel and PowerPoint template writers passed after their build-tool
updates. The original large handoff integration is preserved; one complete,
verified source snapshot is needed because its modules depend on each other.

The Office portable package is assembled from an explicit allowlist: compiled
release app, help/templates/notices, the public catalog/signature, active pack
pointer and all 755 signed-inventory files. File sizes and SHA-256 values are
checked after copying. No developer profile/settings/history/documents or
private key is copied. The public Office verification key is pinned in source.

Runtime requirements: Windows 11 x64, WebView2 and Microsoft Visual C++ x64
runtime (the Office engine imports the MSVC runtime). The existing setup
launcher does not cover the Office runtime, so this preview is distributed as
a portable ZIP with official prerequisite links, not an incomplete installer.

## Publication (2026-11-04)

Published as a GitHub pre-release at the owner's request:
https://github.com/stefanods29/Adperastra/releases/tag/v0.1.0-preview.1
(tag `v0.1.0-preview.1` on commit `23acd8e`; PR #8 was merged by an
owner-requested admin merge without waiting for the CI check).

- ZIP: `Adperastra-0.1.0-preview.1-windows-x64-portable.zip`, 102,865,075 bytes,
  SHA-256 `5e092cad63b097ee5cb8937d9f6353b67e230f862a94ad764c0271d8af00f8dd`.
- App executable SHA-256 `15105e85c5874e51fd9d3b363490716cc00d59aec3765a49e9e73a357b01c064`
  (optimized release build with `tauri/custom-protocol`).
- All 755 Office files matched the signed inventory; the extracted archive
  contained only the allowlisted files and the three pack folders, with no profile,
  settings, WebView data or keys. The downloaded assets matched SHA256SUMS.txt.
- Not done: a clean-profile launch test. The owner's own Adperastra was running,
  and single-instance activation handed the new copy over to it.
