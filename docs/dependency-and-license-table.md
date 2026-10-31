# Dependency and license table (Step 00 proposal)

Rule (plan/rules.md s.10): bundle only MIT, BSD, ISC, Apache-2.0, Zlib, CC0/Unlicense, SIL OFL fonts, MPL-2.0. LGPL only as separate user-replaceable program/DLL with notices + source links. GPL/AGPL/source-available/non-commercial/paid never bundled. Every row re-verified (license + maintenance) in its own deps: commit when adopted; this is a shortlist, not a version approval.

| Area (step) | Recommended first | Alternatives | License notes |
|---|---|---|---|
| App shell (01b) | Tauri 2 | WinUI 3+WebView2; Electron | MIT/Apache-2.0 |
| UI framework (01b) | React + Vite | Svelte; Solid | All MIT. ADR 0002 |
| Accessible primitives (01b) | React Aria (Apache-2.0) | Radix UI (MIT) | Pick in 01b gallery spike; never ship default styling |
| Icons (01b) | Lucide (ISC) | Phosphor (MIT); Figma icons | Figma icons only if license allows MIT redistribution |
| Tokens to CSS (01b) | Style Dictionary (Apache-2.0) | small custom script | Build-time only |
| i18n (01b) | i18next + ICU (MIT) | Lingui (MIT); Project Fluent (Apache-2.0) | ICU plurals + pseudo-locale required |
| Storage (01b/04a) | rusqlite/SQLite (MIT; SQLite public domain) | plain JSON + files | Cache, indexes, tags |
| Setup launcher (01a) | egui (MIT/Apache-2.0), built-in fonts off (their Ubuntu font license is not allowed); Inter, else the Windows UI font read at run time | Win32 via windows crate | Never Slint (conditional license) |
| Downloads (01a) | reqwest + sha2 + minisign (MIT/Apache-2.0); TLS roots from the Windows certificate store via rustls-native-certs + schannel (MIT/Apache-2.0/ISC), not webpki-roots (CDLA-Permissive-2.0, not allowed) | OS downloader | Verify manifest signature first |
| Windows APIs (02+) | windows crate (MIT/Apache-2.0); windows-collections 0.2 (MIT/Apache-2.0, same project, adopted in Step 03a for the share sheet's item list) | hand-written FFI | Known folders, shell, share sheet, classic menu, OCR seams |
| Clipboard image stream (03b) | windows-core 0.61.2 (MIT OR Apache-2.0), direct dependency added in Step 03b; already a transitive dependency of windows 0.61.3 | unbounded system stream | Implements the size-limited COM stream used when encoding clipboard images; crate requires Rust 1.74 |
| FS walk/watch (02) | notify 8.2.1 (CC0-1.0, adopted in Step 02 for `watch(path)`); walkdir/rayon/tokio not adopted - `std::fs` listing is enough so far | std only | Behind FS-service trait |
| Recycle Bin (03b) | trash 5.2.9 (MIT, adopted in Step 03b for delete-to-Recycle-Bin and restore; verified on crates.io/docs.rs 2026-10-28, maintained, Windows backend uses the `windows` crate) | Hand-written `IFileOperation` + Recycle Bin enumeration via the windows crate | Restore-by-original-path powers Undo of Delete |
| File types and tokens (04a) | infer 0.22 (MIT), uuid 1 (Apache-2.0 OR MIT), both already in the lock file through Tauri, adopted in Step 04a | | |
| Virtual lists (02/05) | TanStack Virtual/Table (MIT) | custom | 100k items at 16 ms/frame |
| Docking (05) | dockview (MIT) | FlexLayout (MIT); custom | Layout stays our JSON |
| Text editor (04b/06a) | CodeMirror 6 (MIT), adopted in Step 04b (@codemirror/state 6.7.6, view 6.43.15, language 6.13.1, commands 6.11.1, search 6.7.2, 13 language packages, legacy-modes 6.5.5, @lezer/highlight 1.2.5) | Monaco (MIT) | Large files open in 1 MB parts (ours) |
| Markdown (04b) | markdown-it (MIT) + DOMPurify (Apache-2.0 leg) | marked (MIT) | Sandboxed, scripts off |
| Image decode (04b/07a) | image crate (MIT/Apache-2.0) | libwebp (BSD-3); libvips (LGPL, separate DLL only) | Default avoids LGPL |
| SVG (04b) | resvg (MPL-2.0) | sandboxed browser SVG | Scriptless rendering |
| PDF (07b/14a) | PDFium via pdfium-render (Apache-2.0) + PDF.js (Apache-2.0) | qpdf (Apache-2.0) | Never MuPDF/Ghostscript/Poppler (GPL/AGPL) |
| OCR (07b) | Windows.Media.Ocr (OS) | Tesseract pack (Apache-2.0) | OS first |
| Archives (Step 06d) | zip 9.1 (MIT), sevenz-rust2 0.24 (Apache-2.0), tar 0.4 (MIT OR Apache-2.0), flate2 1.1 (MIT OR Apache-2.0), lzma-rust2 0.22 (Apache-2.0), all adopted in Step 06d with default features off (no bzip2 before 06e), plus what they bring in: zstd, zstd-safe, zstd-sys (BSD-3-Clause), typed-path, cbc, aes, sha2, cipher, block-padding, const-oid, cpubits, hybrid-array, xattr, filetime (MIT OR Apache-2.0), nix (MIT); libarchive not adopted | libarchive (BSD-2); 7-Zip program (LGPL, separate process only, Step 06e for RAR) | Read in the archive helper process only (R-SEC-9). Never bundle UnRAR code |
| Archive creation (Step 06e) | bzip2 0.6.1 (MIT OR Apache-2.0) with libbz2-rs-sys 0.2.6 (bzip2-1.0.6, owner-allowed), zip 9.1.3 pinned exactly (MIT) with `aes-crypto` and `bzip2`, sevenz-rust2 0.24 (Apache-2.0) with `compress` and `bzip2`, blake3 1.8 (CC0-1.0 OR Apache-2.0, already adopted), all adopted in Step 06e; transitive aes 0.9, hmac 0.13, pbkdf2 0.13, sha1 0.11, zeroize 1.9 (MIT/Apache-2.0 family), constant_time_eq 0.6.1, cmov 0.5.4, ctutils 0.4.7 | UnRAR code, 7-Zip DLLs | RAR uses only a separately installed 7-Zip program; package files are read in the archive helper |
| Version history (06b) | rusqlite 0.41 (MIT) with bundled SQLite (public domain), adopted in Step 06b for the version store index | plain JSON + files | Needs Rust 1.89 or newer |
| Version history (06b) | blake3 1.8 (CC0-1.0 OR Apache-2.0), adopted in Step 06b to recognize identical versions and store them once | sha2 | `Hasher` implements `std::io::Write` |
| Version history (06b) | zstd 0.14 (BSD-3-Clause), adopted in Step 06b to compress kept versions | - | 0.13 was MIT; 0.14 is BSD-3-Clause |
| Version history transitive dependencies (06b) | arrayvec 0.7.8 (MIT OR Apache-2.0), constant_time_eq 0.4.2 (CC0-1.0 OR MIT-0 OR Apache-2.0), fallible-iterator 0.3.0 and fallible-streaming-iterator 0.1.9 (MIT OR Apache-2.0), hashlink 0.12.2 (MIT OR Apache-2.0), libsqlite3-sys 0.39.1 (MIT; bundled SQLite public domain) | - | Checked installed manifests; SQLite WASM/VFS dependencies are not built for Windows |
| SQLite build tool (06b) | vcpkg 0.2.15 (MIT OR Apache-2.0) | - | Build only; checked installed manifest |
| PDF edit (14a) | pdf-lib (MIT) | lopdf (MIT); qpdf external | Standard annotations |
| Image editing (14b/18) | Fabric.js or Konva (MIT) + image crate | PixiJS (MIT); miniPaint (MIT, reference) | 18a needs tiled/GPU path |
| PSD (07c/18b) | ag-psd (MIT) | flattened composite only | - |
| E-books/3D (07c) | foliate-js (MIT); three.js (MIT) | epub.js (BSD-2) | Sandboxed frames |
| Sheet quick view (13) | ExcelJS (MIT) | SheetJS CE (Apache-2.0) | SheetJS only pinned by SHA-256 in manifest, no unpinned CDN fetch |
| Office conversion (12b) | LibreOffice headless, separate program (MPL-2.0 core, LGPL parts separate) | mammoth.js (BSD-2) + turndown (MIT); user-installed Pandoc detected, not included | ADR 0003. Never ONLYOFFICE/SuperDoc (AGPL) |
| Office editing (20a) | LibreOffice-based engine in a pack via adapter (spikes decide) | Univer open core (Apache-2.0) + own OOXML; user's chosen app | Univer Pro (paid) never; ZetaOffice terms re-check |
| Media (12b/15/19) | FFmpeg LGPL build, separate program, no GPL parts, no x264/x265 | Mediabunny (MPL-2.0) + WebCodecs | Notices + source links; patent codecs prefer OS/GPU |
| Player extras (15) | HTML5/WebCodecs; wavesurfer.js (BSD-3); libass (ISC) | libmpv/libVLC only verified-LGPL separate DLL | Many mpv/VLC builds are GPL-linked - verify exact build |
| Search (11a) | tantivy (MIT) | SQLite FTS5; nucleo (MPL-2.0) / fuse.js (Apache-2.0) for fuzzy | - |
| Hashing (11c) | BLAKE3 (CC0/Apache-2.0) | sha2 | size, partial, full hash stages |
| Encryption (09e) | rage/age (MIT/Apache-2.0) + Argon2 | 7-Zip AES containers via separate program | Reviewed crypto only |
| AI runtime (14c/17) | llama.cpp (MIT) helper + ONNX Runtime (MIT) | ONNX Runtime GenAI (MIT); ncnn-vulkan (MIT) | Models never in Git |
| AI models (14c/17) | Real-ESRGAN (BSD-3), BiRefNet (MIT)/U2-Net (Apache-2.0), LaMa (Apache-2.0), SigLIP 2 (Apache-2.0), whisper.cpp (MIT) | Qwen/Gemma - per-weights license verification required before approval | Never BRIA RMBG (non-commercial), never Piper (GPL) |
| Fonts (13) | Carlito, Caladea, Liberation, Noto (OFL/Apache-2.0) | - | No Microsoft fonts; re-verify Liberation per release |
| Office templates (06c) | docx 9.15.0 (MIT), development only: builds the Word templates on the developer's PC and is never shipped with the app | - | - |
| Office templates (06c) | exceljs 4.4.0 (MIT), development only: builds the spreadsheet templates on the developer's PC and is never shipped with the app | SheetJS CE (Apache-2.0) | - |
| Office templates (06c) | pptxgenjs 4.0.1 (MIT), development only: builds the presentation templates on the developer's PC and is never shipped with the app | - | - |
| Tables (06f) | csv 1.4 (Unlicense OR MIT) with csv-core 0.1 (Unlicense OR MIT), adopted in Step 06f to parse CSV and TSV in Rust; @tanstack/react-table is not adopted | custom parser | Parsing stays in Rust; the UI asks for pages of at most 500 rows |
| Fonts (06f) | ttf-parser 0.25 (MIT OR Apache-2.0), adopted in Step 06f with default features off and `std`, read only in the font helper process | OS APIs | Font bytes never parsed in the app process; the UI loads them with the browser's FontFace |
| Testing | Playwright (Apache-2.0), cargo test/fuzz, axe-core (MPL-2.0) | WebdriverIO; pixelmatch (ISC) | Test code never ships |

Explicitly excluded (license gate): Pandoc, MuPDF, Ghostscript, Poppler, ONLYOFFICE, SuperDoc, x264/x265, Univer Pro, Slint (royalty-free terms), Piper TTS, BRIA RMBG, ImageMagick (own license - re-verify or prefer the image crate), exiftool (GPL/Artistic - user-installed only).
