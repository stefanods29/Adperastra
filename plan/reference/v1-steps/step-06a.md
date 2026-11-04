# Step 06a: Text editing and templates (★★)

**Needs:** 04b. **Builds:** the editor upgrade path ("view now, edit when ready"), templates.

## Tasks
- **Edit text, Markdown, and code:** save, Save As, unsaved-changes dot, autosave and recovery (off the UI thread), find and replace, encoding and line-ending conversion, live Markdown preview (split view), spellcheck with a language per document, IME input and CJK font fallback. The editor loads behind the viewer and meets its speed tier (typing in the Instant tier). Above the large-file threshold the file opens read-only and streamed.
- **Templates in the "New" menu:** New › Text document, Markdown note, CSV table, Word document, Excel workbook, PowerPoint presentation, plus "From template..." with built-in templates (letter, report, budget, invoice, meeting notes, simple presentation) in every app language, and "My templates" from a folder I choose (any file saved there becomes a template). New files open in a tab with the translated default name selected for renaming. Create the blank .docx/.xlsx/.pptx and the built-in templates with permissive libraries (docx, ExcelJS, PptxGenJS) and ship them as small files; Office templates open in the user's chosen app until the Office viewers (Step 13) and editors (Steps 20-22) exist.

## Parts to consider
CodeMirror 6 (MIT); a spellcheck library with Hunspell-format dictionaries under permissive or LGPL (separate) licenses, or the Windows spellchecking API; docx (MIT), ExcelJS (MIT), PptxGenJS (MIT).

## Help pages
Editing text and code; Markdown preview; autosave and recovery; templates and "My templates".

## Done when
I can edit and save a text file safely, recover unsaved changes after a forced crash, and create files from templates in both app languages.
