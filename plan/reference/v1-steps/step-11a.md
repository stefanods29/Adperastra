# Step 11a: Search index, search modes, and speed pass (★★★★)

**Needs:** 10c. **Builds:** index service, search modes.

## Tasks
- **Index service:** a user-mode file-name index plus file watcher (results update while typing within the Instant tier); an opt-in content index (text inside documents, PDFs, and OCR'd images) built in the background with pause/resume; a metadata index (dates, sizes, types, authors, dimensions, durations). Indexing follows the Background work settings and skips online-only placeholders. Optional NTFS USN/MFT fast index through an opt-in helper that needs admin rights (the app itself never requires admin for core browsing).
- **Search modes:** the search box has a mode switcher (a dropdown at its left edge, cycled with Ctrl+Tab while the box is focused, and set by prefixes such as `name:`, `text:`, `re:`, `ask:`, `photo:`), with a default mode I choose in Settings. Modes:
  - **Name** (default): fast filename search.
  - **Content:** full text inside documents, PDFs, and OCR'd images.
  - **Filters:** a visual builder (type, size, dates, folder, author, dimensions, duration; tags added in Step 11b).
  - **Regex:** regular expressions on names or content.
  - **Natural language**, **Photos by content**, and **Similar files:** AI modes, shown greyed out with a short note and an "Open App storage" button until their packs exist (built in Step 17c).
  - Results show which mode found them, open in tabs, support every view mode, and any search can be saved (saved searches become smart folders in Step 11b).
- **Speed pass:** run the whole test corpus and fix every speed-tier miss: tune prefetch, warm engines, idle preloading, memory limits, cold start, the 100,000-item folder, and tab switching.

## Parts to consider
`tantivy` (MIT) for the content index; `nucleo` (MPL-2.0) for fuzzy matching; `ntfs` crate (MIT/Apache-2.0); `rusqlite` and `notify`; `criterion` (Apache-2.0/MIT) and `hyperfine` (MIT/Apache-2.0) for benchmarks.

## Help pages
Searching; search modes and prefixes; the filter builder; regular expressions; indexing and privacy.

## Done when
Filename search updates within the Instant tier on my whole drive; content search finds text inside documents and OCR'd images; every speed tier in `speed.md` is met for everything built so far.
