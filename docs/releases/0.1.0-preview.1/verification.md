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

Optimized binary, clean-profile runtime and archive verification are pending.
Artifact identity and publication URLs will be recorded after those checks.
