# Libraries (locked list)

Only the libraries on this page may be used, at the version given. A step recipe or guide says when each one is added (recipe `plan/recipes/add-dependency.md`: its own `deps:` commit, plus `THIRD_PARTY_LICENSES.md` and `docs/dependency-and-license-table.md`). Never pick another version, and never swap a library for "something better". If a library does not work as the step describes, first check its real API (`plan/pitfalls.md` P-26). Only if it truly cannot do the job, choose another one whose license is allowed (`plan/rules.md` R-LIC), add it to this page with the reason, then add it with the recipe (AGENTS.md section 5).

Licenses allowed: `plan/rules.md` R-LIC.

## Already in the app (Steps 00 to 03b)

| Library | Version | License | Used for |
|---|---|---|---|
| tauri | 2 (2.12) | MIT / Apache-2.0 | App shell, with the isolation pattern |
| serde, serde_json | 1 | MIT / Apache-2.0 | Data between Rust and the UI, settings files |
| thiserror | 2 | MIT / Apache-2.0 | Rust error types |
| windows | 0.61 | MIT / Apache-2.0 | Windows APIs (features listed in `src-tauri/Cargo.toml`) |
| windows-collections | 0.2 | MIT / Apache-2.0 | Share sheet item lists |
| windows-core | 0.61.2 (exact) | MIT OR Apache-2.0 | Windows COM interface implementation for bounded clipboard-image encoding (03b); already a transitive dependency of windows 0.61.3, now direct for its `implement` macro; crate metadata requires Rust 1.74 |
| notify | 8 (8.2.1) | CC0-1.0 | Folder watching |
| trash | 5.2.9 | MIT | Recycle Bin and restore |
| eframe, egui | 0.32 (default features off: accesskit, glow; no default fonts) | MIT / Apache-2.0 | Setup window |
| reqwest | 0.12 (rustls-tls-native-roots) | MIT / Apache-2.0 | Setup window downloads |
| sha2 | 0.10 | MIT / Apache-2.0 | Download checksums |
| minisign | 0.8 | MIT | Manifest signatures |
| fs2 | 0.4 | MIT / Apache-2.0 | File locks in the setup window |
| react, react-dom | 19.3 | MIT | User interface |
| i18next, i18next-icu, react-i18next | 26.5, 2.6, 17.1 | MIT | Translations with ICU messages |
| lucide-react | 1.62 | ISC | Icons |
| markdown-it | 15.0.3 | MIT | Help pages and the Markdown viewer |
| dompurify | 3.4.17 | MPL-2.0 OR Apache-2.0 | Cleaning HTML before it is shown |
| @tanstack/react-virtual | 3.14 | MIT | Virtualized lists |
| @tauri-apps/api | 2.12 | MIT / Apache-2.0 | Calling Rust from the UI |
| vite, vitest, typescript, jsdom, @vitejs/plugin-react | 8.3, 5.0, 7.0, 29.1, 6.1 | MIT | Build and tests (development only) |

## Added by the ready steps

| Library | Version | License | Step | Used for |
|---|---|---|---|---|
| infer | 0.22 | MIT | 04a | Recognizing file types from their first bytes |
| uuid | 1 (feature `v4`) | Apache-2.0 OR MIT | 04a | Random file access tokens |
| @codemirror/state | 6.7.6 | MIT | 04b | Text viewer (and the editor in 06a) |
| @codemirror/view | 6.43.15 | MIT | 04b | Text viewer |
| @codemirror/language | 6.13.1 | MIT | 04b | Code colors |
| @codemirror/commands | 6.11.1 | MIT | 04b | Keyboard commands |
| @codemirror/search | 6.7.2 | MIT | 04b | Find |
| @lezer/highlight | 1.2.5 | MIT | 04b | Code color tags |
| @codemirror/lang-javascript, -json, -html, -css, -xml, -markdown, -python, -rust, -sql, -java, -cpp, -yaml | 6.2.5, 6.0.2, 6.4.12, 6.3.1, 6.1.0, 6.5.2, 6.2.1, 6.0.2, 6.10.0, 6.0.2, 6.0.3, 6.1.3 | MIT | 04b | Languages, loaded on demand |
| @codemirror/legacy-modes | 6.5.5 | MIT | 04b | Shell, PowerShell, TOML, INI, Go, Ruby, Lua, Swift, C#, Kotlin, Dockerfile, diff |

Step 04c adds no libraries.

## Planned for later steps

Versions and licenses checked on 2026-10-29. Each step's guide confirms the version when it adds the library (and states the exact features to enable).

| Library | Version | License | Step | Used for | Note |
|---|---|---|---|---|---|
| rusqlite | 0.41.1 | MIT | 06b, 07a, 07f | Version store, cache store, SQLite viewer | Needs Rust 1.89 or newer. API checked on docs.rs 0.41.0 for the 06b guide (`Connection::open`, `execute`, `execute_batch`, `query_row` + `OptionalExtension::optional`, `prepare` + `Statement::query_map` (`&mut`), `transaction` (`&mut`), `pragma_update`, `busy_timeout`, `params!`) |
| blake3 | 1.8 | CC0-1.0 OR Apache-2.0 | 06b, 11c | Content hashes | `Hasher` implements `std::io::Write`; `Hash::to_hex` returns a fixed-size string: use `to_string()` for a `String` (checked on docs.rs 1.8.0) |
| zstd | 0.14 | BSD-3-Clause | 06b | Compressing stored versions | 0.14 is BSD-3-Clause (0.13 was MIT). `zstd::stream::copy_encode(src, dst, level)`, `copy_decode(src, dst)`, `encode_all`, `decode_all` (checked on docs.rs 0.14.0) |
| zip | 9.1 (default features off; 06d: `deflate`, `deflate64`, `ppmd`, `zstd`; 06e adds `aes-crypto`) | MIT | 06d, 06e | Zip archives, AES passwords | Needs Rust 1.88 or newer. Checked on docs.rs 9.1.0 for the 06d guide: `ZipArchive::new`, `len`, `by_index`, `by_index_raw`, `by_index_decrypt`; `ZipFile::name` returns a `ZipResult`; `is_dir`, `is_symlink`, `size`, `compressed_size`, `encrypted`, `last_modified` (zip's own `DateTime`, accessors `year()` to `second()`); `ZipError` variants `Io`, `InvalidArchive`, `UnsupportedArchive` (with `ZipError::PASSWORD_REQUIRED`), `FileNotFound`, `InvalidPassword`, `CompressionMethodNotSupported`, `DecompressedSizeLimitExceeded`, `DecompressedSizeUnknown`; writer `ZipWriter::new`, `start_file`, `add_directory`, `finish`, `SimpleFileOptions`. Default features would add bzip2 and an `lzma-rust2` 0.23 copy: keep them off |
| sevenz-rust2 | 0.24 (default features off; 06d: `aes256`, `ppmd`; 06e adds `compress`) | Apache-2.0 | 06d, 06e | 7z archives | Needs Rust 1.93 or newer. Checked on docs.rs 0.24.0: `Archive::read(&mut reader, &Password)`, `files`, `ArchiveEntry` (`name()`, `is_directory()`, `has_stream()`, `size()`, `compressed_size`, `is_anti_item`, `last_modified_date()` as `NtTime`, which converts with `SystemTime::from`), `ArchiveReader::new(reader, Password)`, `for_each_entries` (closure `FnMut(&ArchiveEntry, &mut dyn Read) -> Result<bool, Error>`), `Password::empty()`; errors `PasswordRequired`, `MaybeBadPassword`, `UnsupportedCompressionMethod`, `Unsupported`, `ExternalUnsupported`; writer (feature `compress`) `ArchiveWriter::create`/`new`, `push_archive_entry`, `finish`, `ArchiveEntry::new_file`/`new_directory`. No per-entry encryption flag (06e reads it from the blocks) |
| tar | 0.4 | MIT OR Apache-2.0 | 06d | Tar archives | Checked on docs.rs 0.4.46: `Archive::new`, `entries` (`&mut`), `Entry::path_bytes`, `Entry::size`, `Header::entry_type` (`is_file`, `is_dir`, `is_symlink`, `is_hard_link`), `Header::mtime`; builder `Builder::new`, `append_data`, `into_inner`, `Header::new_gnu`, `as_old_mut` (`name: [u8; 100]`), `set_cksum`. Never use `unpack` |
| flate2 | 1.1 | MIT OR Apache-2.0 | 06d | .tar.gz, .gz | `read::MultiGzDecoder::new`, `write::GzEncoder::new(w, Compression::default())` (checked on docs.rs 1.1.0) |
| lzma-rust2 | 0.22 (default features off; `std`, `xz`; tests also `encoder`) | Apache-2.0 | 06d | .tar.xz, .xz | Pure Rust, already used by sevenz-rust2 0.24; replaces the earlier plan for `liblzma` (C code whose default build needs bindgen). Needs Rust 1.85. `XzReader::new_mem_limit(inner, allow_multiple_streams, mem_limit_kb)` returns the reader; `XzWriter::new(inner, XzOptions::default())`, `finish` (checked on docs.rs 0.22.0) |
| bzip2 | 0.6 | MIT OR Apache-2.0 (its default backend `libbz2-rs-sys` is "bzip2-1.0.6") | 06e | .tar.bz2, .bz2, bzip2 inside zip and 7z | The owner allowed the "bzip2-1.0.6" license on 2026-10-29 (`plan/rules.md` R-LIC-1). Default backend `libbz2-rs-sys` (pure Rust, Rust 1.82); `read::BzDecoder`, `read::MultiBzDecoder`, `write::BzEncoder::new(w, Compression::default())` (checked on docs.rs 0.6.0). 06e also turns on the `bzip2` features of zip and sevenz-rust2; record `libbz2-rs-sys` (bzip2-1.0.6) in `THIRD_PARTY_LICENSES.md` |
| csv | 1.4 | Unlicense OR MIT | 06f | CSV and TSV tables | Needs Rust 1.73. Checked at 1.4.0: `ReaderBuilder::new`, `delimiter`, `has_headers`, `flexible`, `from_reader`, `read_byte_record` |
| ttf-parser | 0.25 (default features off; `std`) | MIT OR Apache-2.0 | 06f | Font names and character map, in the font helper only | Needs Rust 1.63. Checked at 0.25.1: `Face::parse`, `names`, `fonts_in_collection`, `tables().cmap`, `Subtable::codepoints`, `Subtable::is_unicode`, `Name::to_string`, `Name::language`, `is_italic`, `is_monospaced`, `weight`, `number_of_glyphs` |
| image | 0.25.10 | MIT OR Apache-2.0 | 08a | Image conversion | AVIF output decided in the 08a guide |
| resvg | 0.49.0 | Apache-2.0 OR MIT | 08a | SVG to PNG | |
| little_exif | 0.6.0 | MIT OR Apache-2.0 | 08a, 08c | Keeping and removing EXIF | |
| lopdf | 0.46.0 | MIT | 08c | Removing hidden information from PDFs | |
| rust_xlsxwriter | 0.102.0 | MIT OR Apache-2.0 | 08b | Writing .xlsx | |
| calamine | 0.37.0 | MIT | 08b | Reading .xlsx, .xls, .ods | |
| mail-parser | 0.11 (0.11.9) | Apache-2.0 OR MIT | 07f | .eml email files | Not 1.0.0: it needs Rust 1.98 |
| pdfjs-dist | 6.4.299 | Apache-2.0 | 07d | PDF viewer (in a worker, no PDF scripts) | |
| three | 0.186.1 | MIT | 07g | 3D models | |
| ag-psd | 34.1.0 | MIT | 07g | Photoshop files | |
| foliate-js | 1.0.1 | MIT | 07f | E-books (EPUB, MOBI, AZW3) | |
| pdf-lib | 1.17.1 | MIT | 08b | Pictures to PDF | |
| docx, exceljs, pptxgenjs | 9.15.0, 4.4.0, 4.0.1 | MIT | 06c | Building the Office templates (development only, by a script) | Checked for the 06c guide: docx is ESM (`Document` needs `sections` with `children`; `HeadingLevel` is a constant object; `Packer.toBuffer`); exceljs is CommonJS (use the default import; `xlsx.writeBuffer`); pptxgenjs default import, `layout` "LAYOUT_WIDE", `write({ outputType: "nodebuffer" })` is typed as a union (cast). Node 22.12 or newer (ESM detection for pptxgenjs) |
| @tanstack/react-table | not adopted | MIT | | | 06f sorts and filters in Rust, so a million rows never reach the browser (step 06f, D2) |

Libraries pulled in by the 06d features (record them in `THIRD_PARTY_LICENSES.md` with their parent): `deflate64` (MIT), `ppmd-rust` 1.5 (CC0-1.0 OR MIT-0), `zopfli` (Apache-2.0), `zlib-rs` (Zlib), `zstd` 0.14 (BSD-3-Clause, already present since 06b).

Rust toolchain: the planned crates need Rust 1.93 or newer. Before Step 06b, run `rustup update stable`, then `rustc --version` must print 1.93 or newer.

## Exact additions and purpose extensions for the complete guide set

Owner scope2026-11-02 includes AI and a Local AI/API-key assistant with Meta prioritized. These records authorize planned dependencies, not installation, runtime acceptance or downloading weights during guide authoring. Exact primary APIs and asset hashes: [parallel/API-EVIDENCE.md](parallel/API-EVIDENCE.md), [parallel/AI-API-EVIDENCE.md](parallel/AI-API-EVIDENCE.md). Follow these exact pins; final lockfile/transitive/bundled notices are coordinator tasks.

| Dependency | Exact pin | License / earliest producer | Required scope and evidence |
|---|---|---|---|
| fflate |0.8.2 |MIT;07f |Bounded streaming Unzlib adapter forMOBI; parserhelperonly, output/memorycapsmandatory, no generalZIPfrontendparser |
| @pdf-lib/fontkit |1.1.1 |MIT;08b |registerFontkit/embedFont for approvedInter assets. Audit embedded/transitivecopyright notices aswellaspackage license; no unverifiedsystemfontsubstitution |
| Inter fonts |4.1 officialreleasearchive; exact4TTF/licensehashesinAPI-EVIDENCE |SILOFL1.1;08b |Provisionassets/fonts/inter-4.1;noexistingbaselinefontbinaryassumed,noOSinstallation/Microsoftfontbundling |
| regex |1.13.1 defaultfeaturesoff,std/perf/unicode |MIT OR Apache-2.0;09e/11a |Rust1.65;RegexBuilder compiledsize/DFAcache/nestlimits;noJSregexforuntrustedbulk/indexpatterns |
| age |0.12.1 defaultfeaturesoff |MIT OR Apache-2.0;09k |Rust1.74;standardageX25519andscryptseparatekeyslots,verifiedAPI. Transitivesage-core0.12.0/secrecy0.10.3/scrypt0.11.0/zeroize1.9.1 exactresolutionreview;nevermixedscrypt+recipientinonefile |
| zeroize |1.9.1 |MIT OR Apache-2.0;07d |Rust1.85;Zeroizing<Vec<u8>> memorybackings/captures/secretbuffers, notafullOS-memorysecurityclaim |
| webview2-com |0.39.1 exact,Windows-only/defaultfeatures |MIT/Rust1.82;07d |Alreadytransitive;directprivatemodepreflightthroughICoreWebView2_13/Profile/IsInPrivateModeEnabledbeforeanysensitivegrant |
| windows-core-webview (Cargo alias of windows-core) |0.62.2 exact,defaultstd |MIT OR Apache-2.0/Rust1.82;07d |Matcheswebview2-comtypes;existingwindows-core0.61.2 remainsunchangedforwindows0.61.3. Do nottransmutebetweentheversions |
| OpenDyslexic |Pinnedofficialcommitand4WOFF2/SHA256tablein10f |SILOFL1.1;10f |Approvedoptionalbundledfontassets,noarbitraryfontdownloadorMicrosoftasset |
| docx / exceljs |9.15.0 /4.4.0 unchanged |MIT;06c then17d |Extendexistingpinsfromdevelopment-onlytemplategenerationtoisolated17dscanoutputencoding;addproductiontransitivenoticesbeforeinstalling. NotanOfficeediting/renderingengine |
| FFmpeg |9.0.2 source,exactarchivehashAPI-EVIDENCE |LGPLseparatereplaceablepack;12b |Onlyauditednon-GPL/non-nonfreebuildandpermittedcodecs/networkdisabled. Windowsbinarypackhashnotinventedbeforeproduction |
| LibreOffice |26.8.2 upstreamWindowsx64,officialMSIhashAPI-EVIDENCE |MPL/LGPLseparatereplaceablepack;12b/13 |Hardenedconfinedrender/conversionprofile,nomacros/externalupdates.20aeditingbindingneedsownerdecisionseparately |
| llama.cpp |b12032/dde879bc4f954b809892fd0d660515f42536394a |MIT;14c |Nativeconfinedlocalruntimeseparateprogram/bridge,exactCABI/taskcontract14c;notexternalserverorupstreamagenttools |
| ONNX Runtime |1.23.2/a83fc4d58cb48eb68890dd689f94f28288cf2278 |MIT;14c |CPU/DirectMLboundedimage/embeddingproviders;actualDLL/provider/driverpackaudited |
| whisper.cpp |1.8.2/4979e04f5dcaccb36057e059bbaed8a2f5288315 |MIT;14c/17b |Localtranscription/dictationwithseparateexplicitmicrophoneconsentandstandalonespeechpack |
| Real-ESRGAN |0.3.0/fa4c8a03ae3dbc9ea6ed471a6ab5da94ac15c2ea |BSD-3-Clause;14c |Exactmodels/export/tileproviderpins14c/AI-API-EVIDENCE,keepsoriginal;noUpscaylAGPLcode |
| BiRefNet / MI-GAN |Exactofficialsource/weightrevisionsAI-API-EVIDENCE |MITcode/weightsverifiedthere;17b |Isolatedlocalmask/inpaintproviders,derivativeONNXpackneedsactualhash/paritytests;nogenericunverifiedmodeldownload |
| Qwen3.5 / Whisper / text+visionembeddings |Exactmodelrepos/commits/objecthashmetadataAI-API-EVIDENCE |Per-modelpermissivelicensesverifiedthere;14c/17a-c |SourceweightmetadataisnotaderivativeGGUF/ONNXhash;nevercommitweights. Gemma4candidatecomparisononlyunlessevaluation/planexplicitlyselectsit |
| reqwest (new direct native dependency, existing locked version) |0.12.28; default features false; json/stream/rustls-tls-native-roots |MIT OR Apache-2.0;17a |ClientBuilder.resolve_to_addrs/no_proxy/redirect/connect_timeout/timeout/retry verified in17a. Keep existing setup-core dependency; no silent upgrade to0.13.5, no SDK |
| Meta Model API transport |17a assistant-provider-1 usingexistingreqwest/serde |Hosteduser-configuredservice,notbundledweights |MetaAPIprioritized;nativeprotectedkey,explicitoutboundpayloadconsent. NoSDK/newOpenAIdependencyneeded;localAIdefaultandnocloudfallback |

Planned newnativefeatureflagsarelistedineachproducerandverifiedfrompinnedwindowssource:WIC/propertysystem/idle/power/OCR/RestartManager/Vhd/tray/DPAPI/speech. A guide'sdependencytaskandthecoordinatorlicenseauditownmanifest/lockfiles. Productionpack/modelsignatureacceptancealwaysusespublicverificationkeys;guideworkneverreadstheprivate.adperastrasigningdirectory.

## Never use

GPL, AGPL, SSPL, "source-available", non-commercial or paid-tier code, in any step: for example Pandoc, MuPDF, Ghostscript, Poppler, ONLYOFFICE, x264/x265, UnRAR code, exiftool, BRIA RMBG, Univer Pro, SheetJS Pro. Also not `jszip` (its license is MIT OR GPL-3.0: allowed, but not needed; use the Rust `zip` crate instead).
