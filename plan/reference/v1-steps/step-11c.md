# Step 11c: Storage view, duplicate finder, and folder sizes (★★★)

**Needs:** 11a. **Builds:** storage scanner.

## Tasks
- **Storage view ("What's using my space?"):** pick a drive or folder to see a treemap and a sorted list of the largest folders and files, with sizes, counts, and a file-type breakdown; click to drill down or open in the Explorer; recycle, move, or compress (all with undo toasts). Scanning runs as a background job with progress and Cancel, reuses the index when possible, and caches results so the second visit is instant. Online-only placeholders are counted by their reported size, never downloaded.
- **Duplicate finder:** group files with identical content (compare size first, then a fast partial hash, then a full hash such as BLAKE3); show which copy to keep (by location, date, or my choice) and recycle the rest only after review, with undo.
- **Folder sizes as a column:** an optional size for folders in the Details view and the Details pane, calculated in the background, filled in as results arrive, cached and updated by the file watcher; shows "Calculating..." then the size and item count; never blocks scrolling or sorting (folders still calculating sort last). Off by default for network drives.

## Parts to consider
`blake3` (CC0/Apache-2.0) for hashing; a treemap drawn on canvas (for example d3-hierarchy (ISC) for the layout). Study WinDirStat and WizTree for ideas only.

## Help pages
The storage view; finding duplicates; folder sizes.

## Done when
I can see what uses space on a drive, drill into folders, recycle a large file with undo, find and clean duplicates after review, and see folder sizes in the Details view without slowing scrolling.
