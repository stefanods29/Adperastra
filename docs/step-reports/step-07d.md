# Step 07d report — PDF viewer

Date: 2026-11-03 (America/Lima). Status: local integration on `integrate-handoffs`;
packaged-app verification is pending. No remote operation, `main` change, release or tag has
been made.

## How to try it

Open `build\Adperastra\Adperastra.exe` after packaging, then double-click a PDF. Move through
pages with the arrows or the thumbnail sidebar, fit the width/page, rotate, search, and print
a page range after the confirmation.

## Owner checklist

1. Open `text-1.pdf`, `text-100.pdf` and `text-1000.pdf`: the first page appears, scrolling
   loads more pages, and the thumbnail sidebar follows the page.
2. Search for a word that appears on several pages; the matches and their order must be
   correct, and changing the query clears the previous matches at once.
3. Open `outline.pdf` and use its outline; open `scan.pdf` and check that a page with no text
   says so instead of showing an empty selection.
4. Open `locked.pdf`, enter the password, and confirm it is asked again after reopening and
   never appears in saved settings; a wrong password shows the translated message.
5. Open `hostile.pdf` and `corrupt.pdf`: the viewer must refuse safely, keep the app open and
   never run PDF JavaScript, scripts, remote content or macros.
6. Print a small range and cancel the Windows dialog once; nothing is written before the
   confirmation. Repeat in Spanish dark, pseudo and with keyboard-only navigation.
7. In a quick preview, Print must be absent; in a normal tab it must be present when the PDF
   allows printing.

## What is integrated

- A separate `Adperastra.exe --pdf-helper` process with its own helper Tauri config,
  isolation hook and `webview-helper` capability; it builds one hidden, incognito WebView2
  window on `pdf-helper.html`, proves the profile is private, and has no main-app command.
- PDF.js 6.4.299 runs only inside that helper. PDF JavaScript, eval, wasm, remote content,
  frames and objects stay disabled; the CMaps and standard fonts are packaged locally.
- Bounded framed binary transport (16 MiB body, 8 MiB output), uploads with offsets and
  SHA-256, output reservations, one active request, cancellation grace, and one job object
  for the child process.
- Pinned source inputs, exact source stamps, password handling kept only in memory, page
  rendering through the shared cache (`pdfjs`, version 1, 8 MiB per page), 64/128/256
  thumbnail buckets, and memory-only leases for sensitive pages and snapshots.
- Viewer shell with thumbnails, outline, text layer/search, Fit width/page, rotation,
  keyboard commands and a print dialog limited to 100 pages and the document's print
  permission. Quick preview is read-only and hides Print.
- Eight `pdf_*` commands plus the helper-only `helper_reply`/`helper_ready`, registered in
  the main handler list and the isolation allowlist as appropriate.
- English/Spanish PDF keys and the **Viewing PDFs** help page; pseudo-locale generated.
- `pdfjs-dist` 6.4.299 (Apache-2.0) and the Rust helper crates are recorded in the
  dependency and license files in their own `deps:` commit.

## Integration corrections

The control frame's `kind` tag collided with the `Start.kind` field, so the wire tag is now
`frame`. The child's missing `validate_reply_shape` was implemented as a cheap
version/request/output-count check before the full parent validation. The outline limit is
passed explicitly into the recursive counter. PDF.js 6.4 has no `PDFDocumentProxy.destroy`,
so shutdown goes through the loading task. TypeScript 7 needs fresh `ArrayBuffer` copies for
Blob, digest and upload bodies. The IPC check now accepts every `generate_handler!` list
(the helper child has its own), and `helper_ready` was added to the isolation allowlist.

## Verification

- Focused PDF and handler UI suites: 38 tests across 6 files pass.
- `cargo test -p adperastra-app`: 375 tests pass.
- `cargo clippy --workspace --all-targets -- -D warnings`, `npm run build`,
  `npm run lint:i18n` (1,096 keys, 49 help pages, 143 TSX files) and `npm run lint:ipc`
  (125 commands, 126 calls) pass.
- Final full gate: `GATE PASSED` with 673 Rust tests across 51 binaries and 670 UI tests
  across 119 files, translations 1,096 keys/49 help pages/143 TSX files, IPC 125 commands
  and 126 calls, and the production UI build including `pdf-helper.html`.

## Speed and screenshots

Pending the packaged release build: first page for 1, 100 and 1,000 pages, next page and
cached page, plus screenshots of the page view, search and print dialog in English light,
Spanish dark and pseudo light. No speed or screenshot value is claimed before it is measured.

## Known issues and remaining acceptance

KI-094 records the integration defects fixed here. No Blocker or Major is open for the paths
this step changes. Real password PDFs, hostile PDFs and printing remain owner environment
checks. The Print action is implemented as the helper's print view, not a silent system print;
the owner must confirm the Windows dialog and the page range.

## Next steps

08a: Quick Convert, the shared job queue and image formats, then 08b conversion, resolving the
08b/09a `document_types.rs` collision before either is copied.
