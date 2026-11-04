# API evidence and exact asset pins

This is static source/package research for guide authoring. It does not claim future code, models, packs, rendered output or tests have been accepted. Coordinator installs/builds/runs later; coding workers read the evidence and write bodies/tests only. Baseline app commit: `0154c69b3ea5afbfadc39ffa8ee2637733396348`; planning baseline: `ec284e8`. All new types are planned exports in the named producing guide, not already implemented APIs.

## Existing source contracts

| Definition | Verified baseline contract |
|---|---|
| src/services/jobs.ts | JobHandle<T> fields id,cancel():Promise<void>,completion:Promise<T>; runJob<T>(prefix,start,onProgress?)->Promise<JobHandle<T>>;100ms polling |
| src-tauri/src/helper.rs | HelperProcess::spawn/spawn_command/recv/kill; helper::drive is a free function. Job memory/lifetime limits alone are not filesystem or network confinement |
| src-tauri/src/main.rs session | get_session/save_session; no load_session.09a creates services/sessions.ts and moves direct App invokes |
| src/services/recovery.ts | Draft schema_version/path/text/saved_unix/file_modified_unix; writeDraft/readDraft/deleteDraft.09h explicitly migrates delegates/old plaintext records |
| src/handlers/openPipeline.ts | planOpen(path,registry,openWith)->Promise<OpenDecision>; all opens follow it |
| src/commands/registry.ts | Command.run returns void; CommandRegistry.register/get/list; no baseline disabledReasonKey (09d additive) |
| src/services/folderViews.ts | folderViewKey(path) normalizes display prefix/case/trailing backslashes; use this for folder keys |
| crates/fs-service/src/owned_io/output.rs | OwnedOutput.create(&PinnedDirectory,&str)->OwnedIoResult<Self>; file_mut(&mut self)->&mut File;flush_sync(&mut self)->OwnedIoResult<()>;publish_name(&mut self,&str)->OwnedIoResult<PathBuf>;close(self)->ClosedOutput;ClosedOutput.publish_to(self,&Path)->OwnedIoResult<()>;dispose(self)->OwnedIoResult<()> |
| src-tauri/src/files.rs | FileGrants.grant(PathBuf)/revoke(&str)/path_for(&str); tokens exactly32 lowercasehex;MAX_CHUNK4MiB,MAX_FULL_RESPONSE256MiB.07d adds memory backings explicitly |
| src-tauri/src/versions.rs | before_modify(app:&AppHandle,path:&Path,reason:ModifyReason)->Result<(),String>; originalreasons Save/SaveAs/Restore |
| transfer_history.rs / fs-service transfer.rs | Bounded effects contain paths/flags; baseline is not proof of object-bound recycling or immutable output Redo.09f capability gates retain this distinction |

## Verified pinned library surfaces

| Package | Version/license/MSRV | Source/API evidence |
|---|---|---|
| rusqlite |0.41.1 MIT/Rust1.89 | bundled/hooks; Connection.readonly/openflags/prepare/query; progress_handler(&mut self,num_ops:c_int,Option<F>)->Result<()> in src/hooks/mod.rs; https://docs.rs/rusqlite/0.41.1/rusqlite/ |
| pdfjs-dist |6.4.299 Apache-2.0/Node>=22.13 or>=24 | Published types display/api.d.ts;getDocument/getPage/getViewport/render/getTextContent/getOutline/destroy,useWasm/useSystemFonts/disableFontFace; no assumed isEvalSupported. https://www.npmjs.com/package/pdfjs-dist/v/6.4.299 |
| three |0.186.1 MIT | STL/OBJ/GLTF/3MF loader parse and OrbitControls; only isolated helper parses source; SafeScene1 for main. https://www.npmjs.com/package/three/v/0.186.1 |
| ag-psd |34.1.0 MIT | readPsd skipLayerImageData/skipCompositeImageData/skipLinkedFilesData/useImageData/totalMemoryLimit. https://www.npmjs.com/package/ag-psd/v/34.1.0 |
| foliate-js |1.0.1 MIT | EPUB loader/init/sections/toc and MOBI({unzlib}).open(filelike); default View renderer requires forbidden iframe permissions and is NOT used. https://github.com/johnfactotum/foliate-js |
| fflate |0.8.2 MIT | Published types Unzlib/ondata/push and unzlibSync;07f must bound decompressed results, not assume sync call is bounded. https://www.npmjs.com/package/fflate/v/0.8.2 |
| pdf-lib / @pdf-lib/fontkit |1.17.1 /1.1.1 MIT | PDFDocument.registerFontkit/embedFont; font metrics; low-level context/page/form APIs. https://pdf-lib.js.org/docs/api/classes/pdfdocument ; fontkit published archive integrity checked. Bundled third-party notices audit remains mandatory at installation, including pako/embedded fonts and Unicode code |
| image |0.25.10 MIT OR Apache-2.0/Rust1.88 | ImageReader limits/explicit encoders;format features png/jpeg/gif/webp/bmp/tiff/ico;no AVIF output invented. https://docs.rs/image/0.25.10/image/ |
| resvg |0.49.0 MIT OR Apache-2.0/Rust1.85 | usvg options/tree and render;external resource resolution disabled; https://docs.rs/resvg/0.49.0/resvg/ |
| little_exif |0.6.0 MIT OR Apache-2.0 | Metadata::new_from_vec/write_to_vec(&mut Vec<u8>,FileExtension); no user-path write_to_file. https://docs.rs/little_exif/0.6.0/little_exif/ |
| lopdf |0.46.0 MIT/Rust1.88 | load_mem/is_encrypted/get_object_mut/prune_objects/delete_object/decompressed_content_with_limit/save_to;fresh serialization/independent verification. https://docs.rs/lopdf/0.46.0/lopdf/ |
| calamine / rust_xlsxwriter |0.37.0 MIT /0.102.0 MIT OR Apache-2.0,bothRust1.88 | open_workbook_auto_from_rs/worksheet_range;Workbook.new/add_worksheet/write_string/write_number/save_to_buffer. https://docs.rs/calamine/0.37.0/calamine/ ; https://docs.rs/rust_xlsxwriter/0.102.0/rust_xlsxwriter/ |
| mail-parser |0.11.9 Apache-2.0 OR MIT | MessageParser.parse,subject/body_text/body_html/attachments; bounded helper only. https://docs.rs/mail-parser/0.11.9/mail_parser/ |
| regex |1.13.1 MIT OR Apache-2.0/Rust1.65 | defaultsoff,std/perf/unicode;RegexBuilder.size_limit/dfa_size_limit/nest_limit/build;linear-time supported grammar. https://docs.rs/regex/1.13.1/regex/ |
| age |0.12.1 MIT OR Apache-2.0/Rust1.74 | Standard Encryptor/Decryptor/scrypt/X25519;mixed passphrase+recipient forbidden. Separate09kkeyslots. https://docs.rs/age/0.12.1/age/ |
| zeroize |1.9.1 MIT OR Apache-2.0/Rust1.85 | Zeroizing<Vec<u8>> for bounded memory grants/secrets; no claim against OS dumps. https://docs.rs/zeroize/1.9.1/zeroize/ |
| docx / exceljs |9.15.0 /4.4.0 MIT | Existing06c pins additionally used17d helper-only export after review; not an Office rendering/editing engine |

Package source research was downloaded read-only, integrity checked where npm supplies SRI, into a temporary research directory. No new project dependency was installed by guide authors. Final production lockfiles/transitive notices remain coordinator installation tasks, never coding-worker guesses.

## Inter4.1 assets for08b and later editors

No Inter binary existed in the baseline. Use official [Inter4.1 archive](https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip), SILOFL1.1. Archive bytes 33707794, SHA256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`. These are measured bytes from the official archive, not invented final pack hashes. T1/coordinator copies only the following members to assets/fonts/inter-4.1/ and packaged frontend/helper resources; no OS installation.

| Font ID / member | Bytes | SHA256 |
|---|---|---|
| LICENSE.txt | 4380 | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |
| extras/ttf/Inter-Bold.ttf | 420428 | `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` |
| extras/ttf/Inter-Regular.ttf | 411640 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| extras/ttf/Inter-BoldItalic.ttf | 425296 | `948405a16cdc62701da5f4005ed068ca5f4d27061d98f7974ccfc37831d9581d` |
| extras/ttf/Inter-Italic.ttf | 417388 | `bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a` |

Font IDs inter-regular/inter-bold/inter-italic/inter-bold-italic map to those respective TTFs. LICENSE.txt is retained. No Microsoft font distribution. Missingrequiredasset is a typedunavailable error before output. Otherfontassets(10fOpenDyslexic)haveown exactupstreamcommit/hash table in theirguide;keepthosepins.

## Windows and external engine sources

- Pinned windows0.61.3 source in the local Cargo registry was read for WIC, WinRTOCR, idle/AC, RestartManager and virtual-disk API gates.09g uses separately scoped RM_UNIQUE_PROCESS session for a normal close, never forced termination.09j accepts opticalISO IMG only, not invented rawIMG support.
- [Microsoft recycled-item callback](https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-postdeleteitem.md) returns exact post-delete item but does not promise a queued delete is bound to an owned HANDLE. Replace/recycling gates are not removed based on a path precheck.
- [FFmpeg official releases](https://ffmpeg.org/download.html): source9.0.2 archive12,040,788bytes,SHA2568c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e, PGPverification stillpack-productiontask. LGPL build excludesenable-gpl/enable-nonfree, network andunapproved codecs. Actual Windows packhashes come only afterbuilding/auditing exactbytes.
- [LibreOffice official26.8.2 Windows artifact](https://download.documentfoundation.org/libreoffice/stable/26.8.2/win/x86_64/LibreOffice_26.8.2_Win_x86-64.msi.mirrorlist):375,934,976bytes,SHA256ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a. CLIuses soffice.com/headless/fixedprofile; macros/update/externalrefs/filesystem/networkmustbeconstrained explicitly, not assumed safe becauseheadless.20a editingengine is a separateownercheckpoint.
- [Inter source/license](https://github.com/rsms/inter), [PDF low-level reference](https://developer.adobe.com/document-services/docs/assets/35e4369068f86065372c18787171a17e/PDF_ISO_32000-1.pdf). Read low-level structures rather than inventing high-level annotation APIs.

## AI evidence

AI scope was added by the owner on2026-11-02. See AI-API-EVIDENCE.md and14c/17a guides for exact official runtime/model repository commits, licenses and weight metadata. No model weights are checked in or downloaded during guide authoring. A source-model revision is distinct from the eventual converted GGUF/ONNX/program-pack bytes; those need their own measured hashes and acceptance evidence.
