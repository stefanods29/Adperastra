# Step 07c: More previewers (★★★)

**Needs:** 07a. **Builds:** extra handlers (each one a self-contained handler in the registry).

## Tasks
Each previewer is its own lazy-loaded handler (its code loads only when such a file is opened), shows the fastest possible first view, meets its speed tier, and also feeds thumbnails and quick preview, with cached thumbnails so folders of RAW photos or 3D models stay fast.
- **E-books** (EPUB, plus MOBI/AZW3 where a permissive library allows): paginated reading, table of contents, font size, themes; book content rendered in a sandboxed frame.
- **3D models** (STL, OBJ, glTF/GLB, 3MF): orbit, zoom, wireframe, measurements; render only while visible and pause when idle.
- **Camera RAW photos** (CR2/CR3, NEF, ARW, DNG, RAF, ORF, RW2): show the embedded JPEG preview instantly, then decode the full RAW in the background only if I zoom in.
- **HEIC/HEIF and AVIF** through the Windows codecs when installed, with a clear message and a link to the free Windows extension when they're missing.
- **Fonts** (TTF, OTF, WOFF/WOFF2): sample sheet in several sizes (sample text in the app language), character map, install button.
- **Photoshop PSD:** flattened composite preview and layer list.
- **Jupyter notebooks** (.ipynb, outputs rendered safely, no code runs), **email files** (.eml; .msg where a permissive library allows; body in a sandboxed frame, remote images blocked), **subtitles** (.srt, .vtt), **diagrams** (.drawio, .svg), **logs** with level coloring, and **SQLite databases** (read-only table browser).
- Every other unsupported type keeps using the user's chosen app (`rules.md`, section 7).

## Parts to consider
foliate-js (MIT) or epub.js (BSD-2-Clause); three.js (MIT); Windows RAW codec through WIC when installed, or LibRaw (LGPL, separate DLL); ag-psd (MIT); `rusqlite` (MIT); a permissively licensed .msg parser if one exists (otherwise leave .msg to the user's app).

## Help pages
One page per previewer type.

## Done when
Each previewer opens its sample files within its speed tier, provides thumbnails, and passes the malicious-file tests for its formats.
