# Third-party licenses

Adperastra itself is MIT-licensed. The components below are bundled with
the app (starting with the Step 01a setup launcher) and keep their own
licenses and terms, which apply to those components only. Library
dependencies (Rust crates, npm packages) are chosen under the license gate
in plan/rules.md section 10, recorded per adoption in
docs/dependency-and-license-table.md and in the Cargo/npm lock files; this
file lists everything that ships inside the app folder.

## Microsoft Edge WebView2 Evergreen Bootstrapper

- **What:** `runtimes/MicrosoftEdgeWebview2Setup.exe` (file version
  1.3.307.15, 1,889,488 bytes, SHA-256
  13f6d9cdc8c3e7186e4b180db7f48e199ee97d631480e8391fb3106f338fb21a),
  bundled unmodified in the app folder since Step 01a. When the WebView2
  Runtime is missing, the setup program runs it (per-user) to install
  Microsoft's runtime; at runtime the app uses that WebView2 Runtime
  through Tauri (Step 01b).
- **License:** Microsoft Software License Terms for the Microsoft Edge
  WebView2 Runtime (proprietary Microsoft terms - not MIT). The
  bootstrapper is Microsoft "distributable code": Microsoft permits copying
  and distributing its object code together with our application, provided
  the application adds significant primary functionality and distributors
  and end users agree to terms that protect Microsoft at least as much.
  The installed WebView2 Runtime remains Microsoft software under
  Microsoft's terms and is updated by Microsoft.
- **Source:** Microsoft's official WebView2 page
  (https://developer.microsoft.com/en-us/microsoft-edge/webview2); the
  pinned file was obtained through Microsoft's fwlink
  (https://go.microsoft.com/fwlink/p/?LinkId=2124703), which remains in
  `dependencies.json` as a checksum-verified fallback source only.

## Inter font

- **What:** `payload/fonts/Inter.ttf`, the bundled user-interface font
  (used by the setup window first; the app UI follows in Step 01b).
  Copyright The Inter Project Authors (Rasmus Andersson).
- **License:** SIL Open Font License, Version 1.1
  (https://openfontlicense.org). In short: the font may be used, copied,
  modified and redistributed freely, including bundled with software; it
  may not be sold by itself; copyright and license notices must be kept;
  the font itself stays under the OFL and is not covered by Adperastra's
  MIT license.
- **Source:** the Inter project (https://rsms.me/inter/), served via
  Google Fonts.
