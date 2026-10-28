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
| Setup launcher (01a) | egui (MIT/Apache-2.0) | Win32 via windows crate | Never Slint (conditional license) |
| Downloads (01a) | reqwest + sha2 + minisign (MIT/Apache-2.0) | OS downloader | Verify manifest signature first |
| Windows APIs (02+) | windows crate (MIT/Apache-2.0); windows-collections 0.2 (MIT/Apache-2.0, same project, adopted in Step 03a for the share sheet's item list) | hand-written FFI | Known folders, shell, share sheet, classic menu, OCR seams |
| FS walk/watch (02) | notify 8.2.1 (CC0-1.0, adopted in Step 02 for `watch(path)`); walkdir/rayon/tokio not adopted - `std::fs` listing is enough so far | std only | Behind FS-service trait |
| Virtual lists (02/05) | TanStack Virtual/Table (MIT) | custom | 100k items at 16 ms/frame |
| Docking (05) | dockview (MIT) | FlexLayout (MIT); custom | Layout stays our JSON |
| Text editor (04b/06a) | CodeMirror 6 (MIT) | Monaco (MIT) | Streamed large-file mode is ours |
| Markdown (04b) | markdown-it (MIT) + DOMPurify (Apache-2.0 leg) | marked (MIT) | Sandboxed, scripts off |
| Image decode (04b/07a) | image crate (MIT/Apache-2.0) | libwebp (BSD-3); libvips (LGPL, separate DLL only) | Default avoids LGPL |
| SVG (04b) | resvg (MPL-2.0) | sandboxed browser SVG | Scriptless rendering |
| PDF (07b/14a) | PDFium via pdfium-render (Apache-2.0) + PDF.js (Apache-2.0) | qpdf (Apache-2.0) | Never MuPDF/Ghostscript/Poppler (GPL/AGPL) |
| OCR (07b) | Windows.Media.Ocr (OS) | Tesseract pack (Apache-2.0) | OS first |
| Archives (06c) | zip crate (MIT) + libarchive (BSD-2) | sevenz-rust (Apache-2.0); 7-Zip program (LGPL, separate process only) | Never bundle UnRAR code |
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
| Testing | Playwright (Apache-2.0), cargo test/fuzz, axe-core (MPL-2.0) | WebdriverIO; pixelmatch (ISC) | Test code never ships |

Explicitly excluded (license gate): Pandoc, MuPDF, Ghostscript, Poppler, ONLYOFFICE, SuperDoc, x264/x265, Univer Pro, Slint (royalty-free terms), Piper TTS, BRIA RMBG, ImageMagick (own license - re-verify or prefer the image crate), exiftool (GPL/Artistic - user-installed only).
