# Step 09b: Command palette, bulk rename, and batch actions (★★★)

**Needs:** 09a. **Builds:** command palette.

## Tasks
- **Command palette (Ctrl+K):** one search box that finds and runs any registered command ("convert to pdf", "group tabs", "show hidden files"), jumps to any folder or recent file, switches tabs, opens saved groups and settings, and opens help pages. Fuzzy matching in the app language and in English, shows each command's shortcut, remembers recently used commands, and respects enabled-when rules (disabled commands show why). Opens and filters within the Instant tier. Later the assistant (Step 17a) appears here as "Ask the assistant: ...".
- **Bulk rename with live preview:** select many files and rename them with find and replace (optional regex), prefix or suffix, numbering (start, step, padding), change case, insert date (modified or taken-on date from EXIF), insert metadata (for example camera model, image size), and remove characters. A two-column preview (old name, new name) updates as I type, highlights conflicts and invalid names (including reserved names), and lets me exclude rows. The rename runs as one job and is undoable in one step. Save rename presets.
- **Batch actions:** run batch presets (Step 08a), the privacy cleaner, and other multi-file commands on any selection, with a summary at the end (done, skipped, failed, with reasons).

## Parts to consider
`nucleo` (MPL-2.0) or fuse.js (Apache-2.0) for fuzzy matching; `regex` crate (MIT/Apache-2.0).

## Help pages
The command palette; bulk rename; batch actions.

## Done when
I can run any command from Ctrl+K in both app languages, rename 200 photos by date with a preview and undo it in one step, and run a batch preset on a selection with a summary at the end.
