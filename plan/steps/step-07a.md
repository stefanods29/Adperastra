# Step 07a: Thumbnails, quick preview, rich file info, Gallery, and background work v1 (★★★)

**Needs:** 04b. **Builds:** cache fill, metadata service, background work controls v1.

## Tasks
- **Thumbnail and icon views** in the Explorer, generated lazily in background jobs and cached on disk; online-only placeholder files are skipped (cloud icon instead).
- **Quick preview:** Space opens a quick preview using the same viewers; arrow keys move to the next file; Space or Esc closes it.
- **Details pane previews** and **rich, type-specific file info**: image dimensions and EXIF; video duration, codec, resolution, frame rate; audio tags; document author, page and word count.
- **Gallery view:** a virtualized thumbnail grid of the picture folders I choose, grouped by date (taken or modified), opening images in a tab.
- **Background work v1:** a Settings > Background work section (expanded in Step 12a) with on/off for thumbnail generation, "only when idle", "only on AC power", and "Pause all background work". Background jobs run at low priority and never push foreground interactions out of their speed tier.

## Parts to consider
The Windows thumbnail and property system for common types; `kamadak-exif` (BSD-2-Clause) and `lofty` (MIT/Apache-2.0) for metadata; the `image` crate or libvips for thumbnail decoding.

## Help pages
Thumbnails and views; quick preview; file details; the Gallery; background work.

## Done when
A folder of images shows thumbnails within the Fast tier while scrolling stays smooth; Space previews files instantly; the Details pane shows rich info; pausing background work stops thumbnail generation.
