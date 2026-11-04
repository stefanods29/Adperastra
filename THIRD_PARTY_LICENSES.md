# Third-party licenses

Office XML parsing: roxmltree 0.21.2 (MIT OR Apache-2.0).
Source: https://github.com/RazrFalcon/roxmltree.
Used by the first-party `ooxml-editor-probe` library in
`tools/office-edit-preflight`, now linked into the application for its isolated
limited Office worker. The root Cargo.lock pins the application dependency
versions. The retained preflight Cargo.lock is historical probe evidence.

Coordinator-only tool: lessmsi 2.12.9 (MIT), not shipped with Adperastra. Exact download hash and upstream license: docs/integration/lessmsi-provisioning.md.

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

### Inter 4.1 (app assets, Steps 08b and 14a)

- **What:** four static TTFs and the license text in
  `assets/fonts/inter-4.1/`, also packaged under `public/fonts/inter-4.1/`.
  They are used for PDF export and font embedding and for office layout;
  the setup window's `payload/fonts/Inter.ttf` above is a separate copy.
  Copyright (c) 2016 The Inter Project Authors.
- **License:** SIL Open Font License, Version 1.1. The OFL text is
  retained in `LICENSE.txt`; the font stays under the OFL and is not
  covered by Adperastra's MIT license.
- **Source:** official Inter 4.1 release archive
  (https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip),
  members `extras/ttf/Inter-*.ttf` and `LICENSE.txt`, copied
  byte-for-byte. No OS font installation and no Microsoft font is used.
- **SHA-256:** computed from the files in this tree; the four font hashes
  and the license hash match the table in
  plan/parallel/API-EVIDENCE.md.

| File | Bytes | SHA-256 |
|---|---:|---|
| Inter-Regular.ttf | 411,640 | 40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82 |
| Inter-Bold.ttf | 420,428 | 288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f |
| Inter-Italic.ttf | 417,388 | bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a |
| Inter-BoldItalic.ttf | 425,296 | 948405a16cdc62701da5f4005ed068ca5f4d27061d98f7974ccfc37831d9581d |
| LICENSE.txt | 4,380 | 262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a |

## OpenDyslexic font

- **What:** four WOFF2 files and `OFL.txt` in `src/assets/fonts/`, the
  optional dyslexia-friendly app UI font (Step 10f; off by default). No
  other font is bundled in that folder.
- **License:** SIL Open Font License, Version 1.1. Copyright (c)
  2019-07-29 Abbie Gonzalez, with Reserved Font Name OpenDyslexic; the
  OFL text is retained in `OFL.txt`.
- **Source:** official repository commit
  `1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7`
  (https://github.com/antijingoist/opendyslexic), `compiled/*.woff2` and
  the repository OFL text. No arbitrary font download and no Microsoft
  asset.
- **SHA-256:** computed from the files in this tree; all values match the
  pinned table in plan/steps/step-10f.md.

| File | Bytes | SHA-256 |
|---|---:|---|
| OpenDyslexic-Regular.woff2 | 103,336 | 0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695 |
| OpenDyslexic-Bold.woff2 | 108,068 | b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf |
| OpenDyslexic-Italic.woff2 | 107,968 | b18685dcb99b4ba903549d215c0ae2ab39a5087097614fd4100ae6d387332b47 |
| OpenDyslexic-Bold-Italic.woff2 | 118,048 | 1aadc8fa9656c92c09c8194790d0671bcd2b4bd961ba41fb8f7e605e5c493be0 |
| OFL.txt | 4,453 | caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b |

## App shell libraries (Step 01b)

- **Tauri 2** (MIT / Apache-2.0) - app shell; runs the UI in the system webview.
- **React** (MIT) - user interface components.
- **i18next + i18next-icu** (MIT) - translations with locale-aware messages.
- **markdown-it** (MIT) + **DOMPurify** (Apache-2.0) - safe rendering of help pages.
- **pdfjs-dist** 6.4.299 (Apache-2.0) - renders PDF pages, text and search results in the isolated PDF helper webview (Step 07d). PDF JavaScript actions are disabled and the files never run scripts.
- **pdf-lib** 1.17.1 (MIT) and **@pdf-lib/fontkit** 1.1.1 (MIT) - create and modify PDFs and embed the licensed Inter 4.1 fonts in the PDF write helper (Steps 08b and 14a). The fontkit package records MIT in its package metadata but ships no LICENSE file in the installed package; its bundled third-party notices still need a separate audit.
- **docx** 9.15.0 and **exceljs** 4.4.0 (MIT) - encode reviewed extraction exports in the isolated helper (Step 17d) and build the Office templates on the developer's PC (Step 06c). They are runtime dependencies now, but the UI never parses Office files with them.
- **calamine** 0.37.0 (MIT) - reads .xlsx, .xls and .ods tables for conversion and the sheet quick view (Steps 08b and 13).
- **rust_xlsxwriter** 0.102.0 (MIT OR Apache-2.0) - writes .xlsx output (Step 08b).
- **lopdf** 0.46.0 (MIT) - removes hidden metadata from PDFs (Step 08c).
- **regex** 1.13.1 (MIT OR Apache-2.0) - bounded pattern matching for bulk rename and the search index, with default features off (Steps 09e and 11a).
- **age** 0.12.1 (MIT OR Apache-2.0) - standard X25519 and scrypt encryption for locked-folder containers, with default features off (Step 09k). The version and license are the pins recorded in plan/parallel/API-EVIDENCE.md and checked in the crates.io 0.12.1 metadata; the crate is not in the current Cargo.lock.
- **unicode-normalization** 0.1.24 declared (MIT OR Apache-2.0) - NFC normalization of tag names (Step 11b) and dictation text (Step 17b). The manifest asks for 0.1.24; the license is checked in the crates.io 0.1.24 metadata, and no Cargo.lock entry exists yet, so no resolved patch version is claimed.
- **hex** 0.4.3 (MIT OR Apache-2.0; manifest ^0.4.3, locked at 0.4.3) - hex encoding of recovery-envelope hashes (Step 09h).
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

Office preview security pins: calamine 0.38.0 (MIT), age 0.11.5 (MIT OR
Apache-2.0), and little_exif 0.6.23 (MIT OR Apache-2.0), retained with a
quick-xml 0.42.0 (MIT) compatibility patch. Original little_exif license texts
and modification notes are in crates/vendor/little_exif. The portable Office
pack also carries its own licenses and source metadata. Its compatible fonts
and complete font notices are described in Office-notices/SOURCE-NOTICES.txt
inside the download.

ExcelJS 4.4.0 is used only to build templates. Its UUID v4 dependency uses
uuid 11.1.1 (MIT); pptxgenjs's build-only image-size dependency uses 2.0.4
(MIT). Both scoped overrides fix published advisories and are not app runtimes.

- **vcpkg** 0.2.15 (MIT OR Apache-2.0) - SQLite build integration, not shipped as an app dependency.
- **pptxgenjs** 4.0.1 (MIT) - builds the presentation templates on the developer's PC (Step 06c). Not part of the app.


- **@types/three** 0.186.0 (MIT) — development declarations matching Three 0.186; not bundled as runtime code.
