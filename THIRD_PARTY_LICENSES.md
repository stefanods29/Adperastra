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

## App shell libraries (Step 01b)

- **Tauri 2** (MIT / Apache-2.0) - app shell; runs the UI in the system webview.
- **React** (MIT) - user interface components.
- **i18next + i18next-icu** (MIT) - translations with locale-aware messages.
- **markdown-it** (MIT) + **DOMPurify** (Apache-2.0) - safe rendering of help pages.
- **Lucide icons** (ISC) - icons in the interface.
- **axe-core** 4.14.0 (MPL-2.0) - accessibility check in development only; never shipped with the app.
- **egui** (MIT / Apache-2.0) - setup window. Built without egui's bundled default fonts (Ubuntu Font Licence, not on the allowed list); the window uses Inter, or the Windows UI font installed on the PC (read at run time, never bundled).
- **reqwest** (MIT / Apache-2.0) with **rustls-native-certs** (Apache-2.0 / ISC / MIT) and **schannel** (MIT) - setup downloads, trusting the certificates in the Windows certificate store.
- **notify** (CC0-1.0) - folder watching for the Explorer (Step 02).
- **trash** 5.2.9 (MIT) - move items to the Windows Recycle Bin and restore them for Undo (Step 03b).
- **infer** 0.22 (MIT) - recognizes file types from their first bytes (Step 04a).
- **uuid** 1 (Apache-2.0 OR MIT) - random access tokens for open files (Step 04a).
- **TanStack Virtual** (MIT) - virtualized file lists (Step 02).
- **windows** 0.61 and **windows-collections** 0.2 (MIT / Apache-2.0) - Windows APIs: known folders, drives, file details, rename, Open, Open with, Properties, the share sheet and the classic menu (Steps 02 and 03a).
- **windows-core** 0.61.2 (MIT OR Apache-2.0) - implements a size-limited Windows image stream for safe clipboard image paste (Step 03b). Already included transitively by windows 0.61.3; now also a direct dependency.
- **minisign** (MIT) - manifest signatures.
- **zip** 9.1 (MIT), **sevenz-rust2** 0.24 (Apache-2.0), **tar** 0.4 (MIT OR Apache-2.0), **flate2** 1.1 (MIT OR Apache-2.0), **lzma-rust2** 0.22 (Apache-2.0) - read zip, 7z, tar, gzip and xz archives in the archive helper (Step 06d). The compression code their features pull in: **deflate64** (MIT), **ppmd-rust** (CC0-1.0 OR MIT-0), **zopfli** (Apache-2.0), **zlib-rs** (Zlib), used by zip and sevenz-rust2. The other libraries they bring in: **zstd**, **zstd-safe**, **zstd-sys** (BSD-3-Clause, includes the zstd C library), **typed-path**, **cbc**, **aes**, **sha2**, **cipher**, **block-padding**, **const-oid**, **cpubits**, **hybrid-array**, **tar**'s **xattr** (MIT OR Apache-2.0), **filetime** (MIT OR Apache-2.0), **nix** (MIT, not built for Windows).
- **CodeMirror 6** (MIT) - the text and code viewer: code colors, search, line numbers (Step 04b). Packages: @codemirror/state 6.7.6, view 6.43.15, language 6.13.1, commands 6.11.1, search 6.7.2, lang-javascript 6.2.5, lang-json 6.0.2, lang-html 6.4.12, lang-css 6.3.1, lang-xml 6.1.0, lang-markdown 6.5.2, lang-python 6.2.1, lang-rust 6.0.2, lang-sql 6.10.0, lang-java 6.0.2, lang-cpp 6.0.3, lang-yaml 6.1.3, legacy-modes 6.5.5, and @lezer/highlight 1.2.5, with the @lezer parsers they use (all MIT).

