# Step 07e: Copy text from images and scans (OCR)

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-07e-ocr |
| Tag | v0.0.24-step07e |
| Depends on | 07a E1/E3/E4/E8; 07d E1-E3/E5 |
| Written before | 07a was built |
| Interface revision | ocr-1 |

Guide only; workers write code/tests, coordinator runs verification. Windows OCR is included despite the exclusion of optional AI steps. No models/runtime/assistant are introduced.

## Goal

Select, search and copy recognized words from local pictures and scanned PDF pages. English and Spanish work when Windows has the corresponding recognition language installed. Original files remain unchanged.

## Do not do

No OCR writing into PDF/image, semantic search, whole-drive OCR scan, automatic cloud download or new AI model. Extra Tesseract languages are a non-AI optional pack in12a; do not silently install language packs or replace Windows OCR here.

## Read first

07a/07d producing guides; v1 07b OCR scope; image/PDF handlers and find contract; background policy; clipboard text writer; pinned windows0.61.3 Media/Ocr, Graphics/Imaging, Globalization, Storage/Streams source. Verified names: OcrEngine.AvailableRecognizerLanguages/TryCreateFromLanguage/TryCreateFromUserProfileLanguages/RecognizeAsync/MaxImageDimension; OcrResult.Lines/TextAngle/Text; OcrLine.Words; OcrWord.BoundingRect/Text; Language.CreateLanguage; SoftwareBitmap.CreateCopyFromBuffer/ConvertWithAlpha. Workers use these actual names, not inferred alternatives.

## Decisions

- D1. Native helper `--ocr-helper`,512MiB memory,30s wall limit per page, cancellation kills within250ms. Windows feature gates Media_Ocr,Graphics_Imaging,Globalization,Storage_Streams,Foundation. WinRT initialization/cleanup balanced on helper thread; async recognition completes there, never blocks app/UI thread.
- D2. Language preference schema14: `ocr.language` string `auto` or an installed BCP47 language tag; default auto. Auto selects exact app locale (en/es), then installed same-primary-language tag, then Windows user-profile OCR language if available; no silent switch to an unrelated language. Missing preferred language returns ocr.language_missing with installed-language list separately. Settings UI uses Windows-provided language names as data with validated tags; no hardcoded English-only list.
- D3. Input is a guarded local image or one existing PDF session/page. For a PDF with existing selectable text, Copy uses native PDF text first; request OCR only for image-only/explicit recognition. Parent supplies rendered page via07d lease, revalidating PdfSourceIdentity. Ordinary disk sources use stamp-bound cache; immutable snapshots use session-owned memory only, with no fabricated disk path/stamp. Sensitive session permissions apply to recognition/copy controls. No UI-provided arbitrary temporary path.
- D4. Decode oriented pixels with07a E8, downscale to min(Windows MaxImageDimension,4096) longest edge and at most16,777,216pixels; never upscale. Record exact scale and original dimensions. Use BGRA8/ignore alpha on white composited background for SoftwareBitmap. OCR output maps boxes back to oriented original-image coordinates; PDF adapter maps to page points through render width/height then07d viewport transform.
- D5. Result max20,000words and500,000Unicode characters per page, serialized chunks<=768KiB, ordinary-disk cache blob<=4MiB, kind ocr, provider windows-ocr version1; options include selected language, normalized rotation, page number, raster scale and schema1. Check disk source stamp/language before cache hit; snapshot/sensitive recognition stays in bounded memory and bypasses disk cache; schema change invalidates. Truncation is explicit partial state with Copy limited to recognized available text.
- D6. Background recognition only when file/page is visible, active, supported and policy OCR eligible; one OCR helper at a time. Never background-open an online-only source. User Copy all/Search starts a foreground cancellable job for the current item only and still refuses hydration until user opens it normally. Cancel on page/file change and ignore stale generations.
- D7. Overlay uses inert absolutely positioned escaped text boxes, selection/copy in reading-order line/word order; opacity0 text remains selectable while visible selection highlight is themed. Do not introduce invisible focusable controls per word. Toolbar toggle Text recognition, Copy all text and Find reuse image/PDF ribbons; no automatic clipboard mutation after recognition.
- D8. Raw recognized text is untrusted data: never interpreted as instructions, markup, paths or commands. Copy uses plain text clipboard only, with explicit user action; export/index consumers receive the bounded DTO/continuation and cannot trigger additional source reads without policy authorization.

## Uses from other steps

| Ref | Exact producing export | Usage |
|---|---|---|
| U1 | 07a E8; thumbnail_decode.rs `DecodedPixels`, `decode_pixels(File reference,max_edge u32,max_pixels u64)` | Helper-only oriented RGBA; do not copy decoder or send raw pixels through JSON |
| U2 | 07a E1/E3/E4/E5 | CacheStore,SourceStamp,CacheKey/Lease,CacheService.source_stamp, BackgroundPolicy kind ocr; release leases on completion/cancel |
| U3 | 07d E1/E2/E3/E5; services/pdf.ts | PdfSession/PdfSourceIdentity/PdfPageInfo/PdfPageImage/PdfTextPage; renderPdfPage,readPdfText,pdfViewportPoint/inverse; page numbers1-based |
| U4 | 04b/06a/07b; handlers/types.ts | FindRequest and previewOnly; no dirty/save callbacks for OCR, selection-only preview allowed |
| U5 | 06d; jobs/helper and services/jobs.ts | runJob<T> returns JobHandle<T> asynchronously; completion carries result; helper cancellation/lifetime as specified |

## Data shapes and commands

Canonical Rust `src-tauri/src/ocr_types.rs`, TypeScript `src/services/ocr.ts`; all serialized names snake_case.

| Type | Exact fields/types/bounds |
|---|---|
| OcrLanguage | tag String/string max64 validated BCP47; name String/string max128; available bool |
| OcrInput | tagged kind image: path String absolute max32,768units; or kind pdf: session_id UUID,page u32. UI cannot supply output/raster paths |
| OcrWord | text String/string max4,096characters; x,y,width,height finite f64/number >=0 in oriented source pixels; line u32; order u32 |
| OcrPage | source PdfSourceIdentity (disk for image, same07d tagged identity for PDF); page u32 (image1); language String/string; original_width/original_height u32; recognized_width/recognized_height u32; words Vec<OcrWord>/array max20,000; text String/string max500,000characters; partial bool; next_word optional u32; rotation u16; text_angle optional finite f64 |
| OcrRequest | input OcrInput; language String/string auto or installed tag; consumer_id UUID; rotation0/90/180/270; request_revision u32 |
| OcrSettings | language String/string auto default, installed selection checked on execution not destructive startup reset; enabled bool true; max page and policy limits not user-increasable |
| OcrOverlayProps | result OcrPage; viewWidth/viewHeight positive number; rotation0/90/180/270; zoom positive number; onSelectionText callback(string)->void; no write callback |

Commands: `ocr_languages()` -> bounded Vec<OcrLanguage> max128; `ocr_start(request_id,request)` -> unit through shared jobs; `ocr_page(consumer_id,after_word optional u32)` -> OcrPage chunk; `ocr_release(consumer_id)` -> idempotent unit. TS wrappers `ocrLanguages()` ->Promise<OcrLanguage[]>; `recognizeText(request)` ->Promise<JobHandle<OcrPage>>; `ocrPage(consumerId,afterWord)` ->Promise<OcrPage>; `releaseOcr(consumerId)` ->Promise<void>. Validate main window, request IDs, source/grants, language/rotation/word cursor in Rust. Errors ocr.bad_request/language_missing/changed/too_large/failed; source online-only returns ocr.online_only without content open. Max64 consumers,16retained results,30min expiry only after no active overlay lease.

## Exports for later steps

| Ref | Canonical file/name | Contract and consumers |
|---|---|---|
| E1 | services/ocr.ts: OcrInput/Request/Word/Page/Language and four wrappers above | 11a opted-in content indexing,14a PDF tools,12a OCR-language pack adapter; all use same box/reading-order semantics |
| E2 | src/ocr/ocrCoordinates.ts: ocrBoxToSource | word box with x/y/w/h, recognized width/height, original width/height -> oriented source box; finite checked ratios, no rounding until display |
| E3 | src/ocr/OcrOverlay.tsx: OcrOverlay | OcrOverlayProps above; shared image/PDF adapter owns conversion to viewport, overlay has no independent source open |
| E4 | src-tauri/src/ocr.rs: `recognize_page` | OcrRequest reference, JobContext reference ->Result<OcrPage,String>; uses helper/policy/stamp; future caller cannot bypass it by invoking Windows OCR on main process |

## Texts, commands and layout

| Key | English | Spanish |
|---|---|---|
| ocr.title | Text recognition (OCR) | Reconocimiento de texto (OCR) |
| ocr.copyAll | Copy all text | Copiar todo el texto |
| ocr.search | Search in this image | Buscar en esta imagen |
| ocr.language | Recognition language | Idioma de reconocimiento |
| ocr.automatic | Match the app language | Usar el idioma de la aplicación |
| ocr.recognizing | Recognizing text… | Reconociendo texto… |
| ocr.noText | No text was recognized. | No se reconoció texto. |
| ocr.partial | Only part of this page could be recognized. | Solo se pudo reconocer parte de esta página. |
| ocr.languageHelp | Add the recognition language in Windows Settings. | Agrega el idioma de reconocimiento en Configuración de Windows. |
| errors.ocr.bad_request | This recognition request is not valid. | La solicitud de reconocimiento no es válida. |
| errors.ocr.language_missing | This recognition language is not installed. | Este idioma de reconocimiento no está instalado. |
| errors.ocr.changed | The image changed. Try recognition again. | La imagen cambió. Vuelve a reconocer el texto. |
| errors.ocr.too_large | This page exceeds the recognition limits. | Esta página supera los límites del reconocimiento. |
| errors.ocr.failed | Text could not be recognized on this page. | No se pudo reconocer texto en esta página. |
| errors.ocr.online_only | Open this online-only file before recognizing text. | Abre este archivo solo en línea antes de reconocer el texto. |

Command IDs image.copyAllText/image.searchText and pdf.copyAllText/pdf.searchImageText; labels ocr.copyAll/ocr.search; icons Copy/Search; no global shortcut beyond current Find routing; help copying-text-from-images. Toolbar group uses existing ribbon/docking. Recognition status inline under viewer:24px minimum,8px gap, normal text.secondary token; errors focusable Retry/Help actions from common keys. OCR language select in Background work section, not a model page. Selection highlight uses existing accent tokens; no hardcoded OCR green.

## Tasks

### T1 — Language/settings/types
**Files:** ocr_types.rs,ocr_languages.rs,services/ocr.ts; coordinator schema14/default/migration/Windows-feature/translation changes. **Do:** DTOs and language priority D2; no guessed locale fallback; add Settings label. **Uses:** U2/U5. **Tests:** installed en-US/es-ES,appes ->es-ES; appen installedonlyes ->language_missing; schema13 es/dark retains Gallery/background and adds auto/true; invalidtag rejected. **Commit:** `feat(ocr): languages and bounded contracts [step-07e/T1]`.

### T2 — Native recognition helper
**Files:** ocr_helper.rs,ocr_pixels.rs,ocr_windows.rs; coordinator helper dispatch. **Do:** WIC E8/downscale, compositing/SoftwareBitmap conversion, WinRT recognition; property/word limits, no scripts/no source write, cancellation/30s cap. **Uses:** U1/U2/U5/E4. **Tests:** input10000x5000 andmaxedge4096 ->4096x2048; zero/invaliddimensions rejected;500,001stcharacter yields explicit partial; timeout leaves no published result/source change. **Commit:** `feat(ocr): isolated Windows text recognition [step-07e/T2]`.

### T3 — Job/cache/PDF adapter
**Files:** ocr.rs,ocr_jobs.rs,ocr_cache.rs,ocr_pdf.rs; coordinator IPC. **Do:** commands/E1/E4; image capture guard/PDF sourceidentity; page renderlease ownership; cache language/config revisions; foreground/current-page versus policy-gated background; source change rejects; no online-only content. **Uses:** U1-U5. **Tests:** cache en/es differ; PDFpage2 cannotreusepage1; native text present avoidsautomaticOCR; releasedsessioncannotopenforeignblob; cancelling releases PDF image lease; snapshot identity passes unchanged; sensitive recognition creates no disk/cache writes and copy remains disabled. **Commit:** `feat(ocr): cached page recognition jobs [step-07e/T3]`.

### T4 — Overlay geometry and selection
**Files:** src/ocr/OcrOverlay.tsx,ocrCoordinates.ts,ocrSelection.ts,styles/ocr.css. **Do:** E2/E3; reading order, selectableescapedtext, scaledorientation, no per-word focus; forwardcoordinate conversiononce. **Tests:** recognized1000x500/original4000x2000 box(10,20,30,40)->(40,80,120,160);90degrotation through07d viewport mapscornerscorrectly; maliciousrecognizedmarkup appearsliteraltext; selectedwordsorderedline/order. **Uses:** U3/U4. **Commit:** `feat(ocr): selectable text overlays [step-07e/T4]`.

### T5 — Copy/search controls and feedback
**Files:** useOcr.ts,useOcrCommands.ts; coordinator image/PDF ribbon hooks. **Do:** exactIDs/labels; explicitcopyplain text; findmatchedwords mapsboxes; showlanguagehelp/noText/partial;100ms skeleton/1swords/cancel; previewOnly suppresses mutations but allows user copy for ordinary sources; sensitive PDF permissions disable clipboard/print while native authorized editor can consume bounded OCR data. **Tests:** recognition completion doesnotwriteclipboard; Copyall oncewritesexactrecognizedtext; selectingnewfile cancels/ignoresoldresult; missinglanguagepreservesimageview. **Uses:** U4/E1-E3. **Commit:** `feat(ocr): copy and search recognized text [step-07e/T5]`.

### T6 — Help, fixtures and reviewer plan
**Files:** bilingualhelp below; coordinator key/pseudo/tests/scripts. **Do:** exacttext, F1, measures/shots. **Tests:** ocrLanguages.test.ts,ocrCoordinates.test.ts,ocrOverlay.test.tsx,ocrCommands.test.tsx and native step07e_ocr_tests; expected values above plus cancellation/cloud/malformed-source cases. **Traps:** workers do not run recognition or tests. **Commit:** `docs(help): copying text from images and scans [step-07e/T6]`.

## Help pages

`help/en/copying-text-from-images.md`, title **Copying text from images and scans**. Intro: “Recognize text in a picture or scanned PDF page so you can select and copy it.” How to use: “Open the image or PDF page. Choose **Copy all text** to recognize and copy its words. Choose **Search in this image** to find words on the page. Select a recognition language in **Settings > Background work** when needed.” Good to know: “Recognition happens on this computer. Its language must be installed in Windows. Results can contain mistakes, so check important text. Your file is never changed. Online-only files must be opened normally first.” Last line: `See also: "Viewing PDFs" and "Background work".`

Spanish title **Copiar texto de imágenes y documentos escaneados**. Intro: “Reconoce el texto de una imagen o una página PDF escaneada para seleccionarlo y copiarlo.” Cómo usar: “Abre la imagen o la página PDF. Elige **Copiar todo el texto** para reconocer y copiar sus palabras. Elige **Buscar en esta imagen** para encontrar palabras en la página. Si lo necesitas, elige un idioma de reconocimiento en **Configuración > Trabajo en segundo plano**.” Para tener en cuenta: “El reconocimiento se realiza en este equipo. Su idioma debe estar instalado en Windows. Los resultados pueden contener errores; revisa los textos importantes. Tu archivo nunca cambia. Los archivos solo en línea deben abrirse normalmente primero.” Last line: `Consulta también: «Ver PDF» y «Trabajo en segundo plano».`

Store normal recipe headings. Update viewing-images/viewing-pdfs help to point to this page without claiming OCR is perfect or available for missing language packs.

## Check by hand, speed and screenshots

Retained fixtures: en.png white1024x512 with black `Hello 123`; es.png same with `Mañana, información 456`; rotated.png orientation90; scan.pdf embeds en.png without text; native.pdf containsactualtext; blank.png. Coordinator generates images/PDFs, records language availability and expected strings; no personal scans. Checkcopy/search/selection/zoom/rotation/cancel/reopen/noText/missinglanguage/cloudskip; originalhash unchanged. Repeat Spanish dark,pseudo,keyboard and200%zoom. Recognition accuracy is a recorded result, not assumed from font appearance.

Measurements `step07e.ocr.overlay` Instant0.1s cached; `step07e.ocr.page` Waiting1-10s with Cancel; over10s progressjob; existingPDF/imagefirstview must stayFast. Reserve67-image-ocr,68-pdf-ocr, each en/light,es/dark,pseudo/light.

## Done when

- [ ] All DTO/geometry/language/cache/cancellation/cloud tests written and coordinator executed results recorded.
- [ ] OCR local/helper-bounded, no source modification/network/model install; raw text never executed/interpreted.
- [ ] Selection/copy/search align after scale/rotation; correctlanguage/noText/partialstates; unchanged fileview whenOCRfails.
- [ ] Exact E1-E4 names match futureindex/PDF/pack guides; translations/help/pseudo/screenshots/speed/package/report checked by coordinator.

PDF render requests use PdfRasterSpec kind bucket with edge2048, not a removed top-level edge field; mapping uses resolved_scale/rendered_rotation from07d E2. A too-large page fails explicitly.
