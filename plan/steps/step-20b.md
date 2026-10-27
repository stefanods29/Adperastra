# Step 20b: Word-style editing (★★★★★)

**Needs:** 20a. **Builds:** ribbon-to-engine mapping. **Figma frames:** File Explorer · Word abierto.

## Tasks
- **Our own movable header row and ribbon** as in the Figma frame: AutoSave toggle, Save, Undo, Redo, document title, save status, Comments, Share; tabs File, Home, Insert, Design, Layout, References, Review, View, Help (all translated); the Editing mode dropdown (editing, reviewing, viewing); a File (backstage) page for new, open, save as, export, print, and properties.
- Ribbon controls mapped to engine commands with live states (bold on/off, current font, style, and so on). The ribbon appears instantly and enables as the engine becomes ready; typing within the Instant tier once ready.
- Navigation pane (headings), rulers, status bar (page and word count, language, zoom), track changes, comments in the margin (as in Figma, with replies), PDF export, autosave and recovery.
- **Voice group** (as in Figma), both optional packs: **Dictate** (speech to text in the document's language, using the speech pack from Step 17b) and **Editor** (spelling, grammar, and style suggestions). Parts to consider: whisper.cpp (MIT) for dictation; Harper (Apache-2.0) and Hunspell-format dictionaries for checking, or LanguageTool (LGPL) only as a separate local process. Verify each license and model license.
- Copy and paste and drag and drop with other tabs (Step 09a).

## Help pages
Editing documents; formatting and styles; track changes and comments; dictation and the Editor; exporting to PDF.

## Done when
I can edit my sample documents with our ribbon (docked on any side), track changes, comment, dictate a paragraph, export to PDF, and the round-trip tests pass.
