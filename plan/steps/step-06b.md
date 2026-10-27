# Step 06b: Version history (★★)

**Needs:** 06a. **Builds:** version store.

## Tasks
- **Version store v1:** every time the app is about to change a file (save from any editor, convert over an existing file, privacy clean over the original, AI edits, any future feature that modifies content), it first keeps a snapshot in a local version store (in the app's data folder, deduplicated and compressed). Snapshots are written in the background and never delay saving.
- **Version history panel** (from the ribbon's File menu, the right-click menu, and the Details pane): lists versions with date, size, and what changed them (me, the converter, the privacy cleaner, AI); preview any version, compare it with the current one (text diff for text and code; side by side for images, PDFs, and documents as their viewers arrive), restore it (itself undoable), or save it as a copy.
- Also show Windows "Previous versions" (Volume Shadow Copy / File History) when they exist.
- **Settings:** on/off, how long to keep versions (for example 30 days), and a size limit with the oldest removed first; the store's size appears in App storage (Step 12a).
- Every later editor (Steps 14a-22b) and every AI feature must use this store.

## Help pages
Version history; restoring and comparing versions; storage limits for versions.

## Done when
I can edit a text file several times, see each version, compare two versions, and restore yesterday's version; limits remove the oldest versions.
