# Step 07e report — Copy text from images and scans (OCR)

Date: 2026-11-03 (America/Lima). Status: local integration on `codex/integrate-handoffs`;
packaged-app verification is pending. No remote operation, `main` change, release or tag has
been made.

## How to try it

Open `build\Adperastra\Adperastra.exe` after packaging, open a picture, and use **Text
recognition** / **Copy all text** in the image ribbon. Choose the recognition language in
**Settings > Background work**. In a PDF, **Copy all text** uses selectable text when present
and recognition for an image-only page.

## Owner checklist

1. Open a clear picture with English or Spanish text, turn on **Text recognition**, and check
   that the words appear in reading order and can be selected; **Copy all text** puts the
   plain text on the clipboard.
2. Repeat with a rotated picture and a 10,000×5,000 picture; the overlays must follow the
   rotated view and the helper must stay responsive with Cancel available.
3. Open a picture with no text: the translated "No text was recognized" appears, and Retry
   starts again.
4. Choose a recognition language in Settings, reopen the picture and confirm the choice is
   used; choose a language Windows does not have and confirm the translated
   "not installed" message.
5. Open a text PDF and a scanned PDF: **Copy all text** must use native text for the first and
   recognition for the second. A sensitive snapshot must keep copy disabled.
6. Confirm an online-only file is not downloaded by recognition, and that closing or hiding
   the tab cancels the helper.

## What is integrated

- Windows.Media.Ocr only, in a separate `--ocr-helper` process with a 512 MiB job, 30 s wall
  limit and a 250 ms cancel grace; no model, pack, Tesseract, network or script execution.
- Validated local image or live 07d PDF page input; no UI-supplied output path, stamp or
  property name. Online-only files are refused before content access.
- `auto` language priority (app language, then the Windows profile language only inside the
  same language, then the translated "not installed" message); an explicit installed tag is
  validated at recognition time.
- Bounded pixels through the 07a WIC decoder, including the new memory route for rendered PDF
  pages: EXIF orientation, longest edge 4,096, at most 16,777,216 pixels, never upscaled,
  transparent pixels composited on white.
- Limits: 20,000 words, 500,000 characters, 4,096 characters per word, 768 KiB chunks,
  4 MiB cache blobs, 64 consumers, 16 retained pages and a 30-minute idle expiry.
- Cache kind `ocr`, provider `windows-ocr` version 1; snapshots and sensitive sessions never
  use it. Copy is explicit plain text; recognition never writes the clipboard by itself.
- Image overlay with escaped, inert, absolutely positioned words in line/reading order; the
  image viewer exposes Text recognition, Copy all text and Search in this image. PDF copy and
  search commands use the 07d adapter, native text first and a rendered page when needed.
- `PdfOcrAdapter` implements the 07d OCR bridge: live identity, native text and raster pages
  through the existing PDF sessions and renderer, releasing the geometry probe's lease.
- Settings schema 14 (`ocr.language`, `ocr.enabled`), the OCR language selector in Background
  work, English/Spanish OCR text and the **Copying text from images** help page in both
  languages.

## Integration corrections

The payload expected four additive producer methods that are now implemented: `JobContext::app`,
`HelperProcess::write_all`, `BackgroundPolicy::eligible_now` and
`thumbnail_decode::decode_pixels_from_memory`. The missing `MAX_OCR_PIXELS` constant, the
`Duration` import, the `Manager` trait and the correct cancellation-token constructor were
added. The 07d PDF module gained the `PdfOcrAdapter` required by the OCR trait, and settings
schema 14 keeps schema 13 files intact. The old tests that asserted schema 13 were updated to
14.

## Verification

- Focused OCR/settings tests: 53 pass across the OCR language, coordinate, overlay, command,
  settings and viewer suites.
- `cargo test -p adperastra-app`: 424 tests pass.
- `cargo clippy --workspace --all-targets -- -D warnings`, `npm run build`,
  `npm run lint:i18n` (1,112 keys, 50 help pages, 146 TSX files) and `npm run lint:ipc`
  (129 commands, 130 calls) pass.
- Final full gate: `GATE PASSED` with 722 Rust tests across 51 binaries and 692 UI tests
  across 123 files, translations 1,112 keys/50 help pages/146 TSX files, IPC 129 commands
  and 130 calls, and the production UI build.

## Speed and screenshots

Pending the packaged release build: cached overlay, first OCR page (Waiting 1–10 s with
Cancel), and screenshots 67–68 in English light, Spanish dark and pseudo light. No speed or
screenshot value is claimed before it is measured.

## Known issues and remaining acceptance

KI-096 is fixed: the image and PDF Find rows route to OCR (native text first for PDFs) and
highlight the current match; the PDF page renders the same inert word overlay with the
raster-to-view zoom. No Blocker or Major is open for the paths this step changes. The helper's
real Windows OCR availability, recognition quality and the owner's language installation
remain environment checks, and the packaged-app click-through is still pending.

## Next steps

Finish KI-096 (shared Find routing and the PDF overlay), then 07f previewers and 07g models/RAW.
