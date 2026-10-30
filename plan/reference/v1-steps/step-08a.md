# Step 08a: Converter, round 1: Quick Convert, preview, batch, and presets (★★★)

**Needs:** 03b, 07b. **Builds:** converter registry, Quick Convert window, job queue panel. **Design:** Quick Convert and the queue aren't in Figma; design them in the same style and show me first.

## Tasks
- **Quick Convert window:** right-click one or many files, choose "Convert to...", and a small window opens (no new tab) with target format, format-specific options (quality, resolution, page range, DPI), presets (for example "Web JPG", "PDF for email"), a before/after preview, estimated output size and time, destination and naming template, "keep original" (on by default), progress, and Cancel. The preview is generated quickly from a downscaled image or the first page and updates when options change.
- **Inside a file tab:** a Convert/Export section in the ribbon opens the same panel, working on the file's current (even unsaved) state.
- **Job queue panel:** several files at once, per-file progress, Cancel, and Retry, running in the background through the job runner while I keep browsing; a notification when a long batch finishes.
- **Converter registry:** engines are pluggable and run in helper processes. Each declares its input/output formats and options (the UI is generated from that). Never overwrite originals by default (overwriting goes through the version store), warn about lossy conversions, keep metadata by default (copy EXIF, XMP, and document properties when the target format supports them, and say so when it can't), and show clear errors with a log.
- **Converters, simplest first:** image to image (png, jpg, webp, bmp, gif, tiff, avif where possible), svg to png, images to PDF and PDF to images, md to html, md/html to PDF, csv to/from xlsx, zip to/from 7z.
- **Batch presets:** save a conversion setup (for example "Photos to web JPG, max 1920 px") and run it on any selection in one click, from the right-click menu and the command palette (Step 09b).

## Parts to consider
The `image` crate (MIT/Apache-2.0) and, where it falls short (lossy WebP, AVIF), libwebp (BSD-3-Clause) or libvips (LGPL-2.1+, separate DLL); ImageMagick (permissive ImageMagick License); resvg (MPL-2.0); pdf-lib (MIT) and PDFium (Apache-2.0); SheetJS Community Edition (Apache-2.0; install from cdn.sheetjs.com because the old npm copy is outdated; styling and pivot tables are in its paid Pro edition, don't use them) and ExcelJS (MIT); markdown-it (MIT); WebView2's built-in print-to-PDF.

## Help pages
Converting files; batch conversion and presets; the job queue.

## Done when
I can convert a batch of images with a live preview while browsing, see the new files appear in the folder, save a preset, and metadata is kept by default.
