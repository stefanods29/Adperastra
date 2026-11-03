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
- **pdfjs-dist** 6.4.299 (Apache-2.0) - renders PDF pages, text and search results in the isolated PDF helper webview (Step 07d). PDF JavaScript actions are disabled and the files never run scripts.
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
- **csv** 1.4 (Unlicense OR MIT) with **csv-core** 0.1 (Unlicense OR MIT) - reads CSV and TSV files into the table viewer (Step 06f).
- **ttf-parser** 0.25 (MIT OR Apache-2.0) - reads font names and the character map in a separate helper process (Step 06f).
- **bzip2** 0.6.1 (MIT OR Apache-2.0) with **libbz2-rs-sys** 0.2.6 (bzip2-1.0.6, the library's own permissive license, allowed by the owner) - reads and writes bzip2 data, .tar.bz2 streams and bzip2-compressed zip/7z entries (Step 06e). The password writer and reader features of zip 9.1.3 and sevenz-rust2 0.24 pull in **aes** 0.9 (MIT OR Apache-2.0), **hmac** 0.13, **pbkdf2** 0.13, **sha1** 0.11 (MIT OR Apache-2.0), **zeroize** 1.9 (Apache-2.0 OR MIT), **constant_time_eq** 0.6.1 (CC0-1.0 OR MIT-0 OR Apache-2.0), **cmov** 0.5.4 and **ctutils** 0.4.7 (Apache-2.0 OR MIT); **blake3** 1.8 also verifies a created archive's spool (Step 06e).
- **rusqlite** 0.41 (MIT) with the bundled SQLite (public domain) - the index of kept file versions (Step 06b) and read-only SQLite previews (Step 07f).
- **mail-parser** 0.11.9 (Apache-2.0 OR MIT) - reads .eml headers, bodies and attachment metadata in the email viewer (Step 07f). MIME content is never executed.
- **foliate-js** 1.0.1 (MIT) - parses EPUB/MOBI structure in the book helper only (Step 07f); its renderer and remote-resource code are not imported.
- **fflate** 0.8.3 (MIT) - bounded MOBI Unzlib decompression in the book helper (Step 07f). 0.8.3 fixes GHSA-px8p-9vwx-vf98; it replaced the guide's 0.8.2.
- **blake3** 1.8 (CC0-1.0 OR Apache-2.0) - recognizes identical versions so they are stored once (Step 06b).
- **zstd** 0.14 (BSD-3-Clause) - compresses kept versions (Step 06b).
- Version-store dependencies: **arrayvec** 0.7.8 (MIT OR Apache-2.0), **constant_time_eq** 0.4.2 (CC0-1.0 OR MIT-0 OR Apache-2.0), **fallible-iterator** 0.3.0 and **fallible-streaming-iterator** 0.1.9 (MIT OR Apache-2.0), **hashlink** 0.12.2 (MIT OR Apache-2.0), and **libsqlite3-sys** 0.39.1 (MIT, its bundled SQLite is public domain). These license declarations were checked in the installed packages' manifests; Windows does not build the SQLite WASM/VFS dependencies.
- **CodeMirror 6** (MIT) - the text and code viewer: code colors, search, line numbers (Step 04b). Packages: @codemirror/state 6.7.6, view 6.43.15, language 6.13.1, commands 6.11.1, search 6.7.2, lang-javascript 6.2.5, lang-json 6.0.2, lang-html 6.4.12, lang-css 6.3.1, lang-xml 6.1.0, lang-markdown 6.5.2, lang-python 6.2.1, lang-rust 6.0.2, lang-sql 6.10.0, lang-java 6.0.2, lang-cpp 6.0.3, lang-yaml 6.1.3, legacy-modes 6.5.5, and @lezer/highlight 1.2.5, with the @lezer parsers they use (all MIT).

- **three** 0.186.1 (MIT) — isolated model format loaders; trusted scene rendering and OrbitControls. License: https://github.com/mrdoob/three.js/blob/dev/LICENSE
- **ag-psd** 34.1.0 (MIT) — isolated PSD composite/layer reader. License: https://github.com/Agamnentzar/ag-psd/blob/master/LICENSE
- PSD dependencies: **base64-js** 1.5.1 (MIT) and **pako** 2.1.0 (MIT AND Zlib), bundled by ag-psd.

- **image** 0.25.10 (MIT OR Apache-2.0), **resvg** 0.49.0 (Apache-2.0 OR MIT), **little_exif** 0.6.23 (MIT OR Apache-2.0) — bounded image conversion, isolated SVG rasterization and metadata preservation (Step 08a).

## Development tools (not shipped)

- **vcpkg** 0.2.15 (MIT OR Apache-2.0) - SQLite build integration, not shipped as an app dependency.
- **docx** 9.15.0 (MIT), **exceljs** 4.4.0 (MIT), **pptxgenjs** 4.0.1 (MIT) - build the Office templates on the developer's PC (Step 06c). Not part of the app.


- **@types/three** 0.186.0 (MIT) — development declarations matching Three 0.186; not bundled as runtime code.
