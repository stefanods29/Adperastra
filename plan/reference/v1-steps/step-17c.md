# Step 17c: AI search and organizing (★★★★)

**Needs:** 17a, 11b. **Builds:** embeddings index, the AI search modes. **Also read:** `plan/ai.md`.

Each part is optional and can be turned on or off in Settings > AI.

## Tasks
- **Photos by content:** a small image-text embedding pack (SigLIP 2, Apache-2.0) indexes photos in the background, only in folders I choose, following the Background work settings (paused on battery and while I'm working, resumable, online-only placeholders skipped). This enables the **Photos by content** search mode ("dog on the beach", "whiteboard with diagrams") and **Similar files** (pick a photo or document to find similar ones; documents use the multilingual text embedding model). Vectors are stored in the local index; their size appears in App storage.
- **Natural-language search mode:** the assistant model (or a smaller dedicated one if it scores well) converts a query like "PDFs from María last month bigger than 5 MB" into the Filters builder's format using constrained JSON output, so the result is always valid and shown as editable filter chips before running. Never search without showing what it understood.
- **Smart rename suggestions:** for files with meaningless names (`IMG_2034.jpg`, `scan001.pdf`, `Document (3).docx`), "Suggest a name" from the file's content (text, OCR, image description, dates, EXIF), following a naming pattern I set (for example `{date} {topic}` or `{company} {type} {month}`). Works on one file or through bulk rename's preview (Step 09b), where I accept, edit, or reject each suggestion. Never renames without approval.
- **Sort suggestions for Downloads** (and any folder I choose): suggest where each new file probably belongs, learning from where I moved similar files before (a simple local model of my past choices by type, source, and name works even without the AI pack; the AI pack improves it using content). A small "Suggested: Documents/Invoices" chip with Move / Not now / Never for this kind; never moves files automatically.
- Add evaluation sets: photo search relevance in English and Spanish, natural-language query conversion, rename suggestions, sort suggestions.

## Help pages
Searching photos by content; similar files; natural-language search; rename suggestions; sort suggestions.

## Done when
I can find photos by describing them in English and Spanish, find files similar to a chosen one, search in natural language with editable filter chips, get rename suggestions in bulk rename, and get sort suggestions for new downloads.
