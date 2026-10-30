# Step 04b: Ribbon framework and the first viewers (★★)

**Needs:** 04a. **Builds:** ribbon framework.

## Tasks
- **Ribbon framework:** data-driven (tabs, groups with labels, buttons, toggles, dropdowns, split buttons, galleries) bound to commands or engine state, with Alt key tips, shortcut hints in tooltips, a ribbon skeleton while an editor loads, themed, translated, keyboard accessible, and ready to dock on any side in Step 05. First ribbon: a "View" tab per handler.
- **First viewers**, each meeting its speed tier (`speed.md`):
  - Text, code, and logs: streamed, virtualized, large-file mode; syntax highlighting loads lazily and never blocks the first view; find, line numbers, encoding detection.
  - Markdown: rendered (sanitized, in a sandboxed frame) and source.
  - Images (png, jpg, jpeg, webp, gif including animated, bmp, svg, ico): decoded off the UI thread, downscaled first, progressive; zoom, pan, rotate; SVG rendered safely (no scripts).
  - Audio and video: HTML5 streaming player with scrubber, speed, volume, and subtitles track selection; clearly say which codecs the webview can't play and offer the user's chosen app instead.
- **File-open benchmark** over the test corpus, with the regression check in the test suite.

## Parts to consider
CodeMirror 6 (MIT) or Monaco Editor (MIT); markdown-it or marked (MIT) with DOMPurify; the `image` crate (MIT/Apache-2.0) or libvips (LGPL-2.1+, separate DLL, shrink-on-load) for fast downscaled decoding; resvg (MPL-2.0) for safe SVG rendering; Tauri custom protocols for binary transfer.

## Help pages
The ribbon and key tips; viewing text, Markdown, images, audio, and video.

## Done when
Opening a .txt, .md, .png, .svg, and .mp4 each shows the right viewer and ribbon within its speed tier; Alt shows key tips; the benchmark runs in the test suite.
