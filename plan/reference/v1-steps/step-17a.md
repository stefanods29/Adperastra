# Step 17a: AI assistant: core, safety, preferences, models, and evaluation (★★★★)

**Needs:** 14c, 09b. **Builds:** assistant tools, AI evaluation harness. **Also read:** `plan/ai.md`.

The assistant is optional (chosen in the first-run checklist or later in App storage). Everything runs on the user's machine; no file content ever leaves it.

## What it does
- **Chat panel** in the Figma style, dockable like other panels, with a shortcut, a title-bar button, and an entry in the command palette ("Ask the assistant: ..."). It answers in the user's language by default (at least English and Spanish).
- **Tabs:** open files and folders as tabs, switch, close, and group them ("group my budget files into a group called Finances"), open saved groups.
- **Files:** create files and folders with requested content (text, Markdown, CSV, from templates, and Word/Excel/PowerPoint once Steps 20-22 exist), rename, move, copy, convert (through the converter registry), tag, find files by description, and run the privacy cleaner when explicitly asked ("remove the location from these photos").
- **Delete safely:** deleting always goes to the Recycle Bin. The assistant shows the exact list of items, asks "Are you sure?", then asks a second, different confirmation with the count ("Move these 12 items to the Recycle Bin?"); only my clicks count as confirmation, never the model's own text. Permanent delete is not available to the assistant at all.
- **Questions about files:** summarize or answer questions about text, PDFs, Office files, images (describe, read text in them, compare), audio (transcribe, with the speech pack), and video (sampled frames plus the audio transcript, with timestamps that jump the player there). Cite which file and page or timestamp each answer comes from.

## How it must work
- **Tools only:** the assistant never touches the disk directly. It can only call a typed tool list generated from the command registry (open_tab, group_tabs, create_file, move_items, convert, tag_items, search_files, read_file, describe_image, transcribe, recycle_items, and so on). Each command has a risk level: read-only runs immediately; creating or changing files shows a preview card with Apply/Cancel; recycling needs the double confirmation. All actions appear in an action log and use the normal undo stack; any file it changes is snapshotted in the version store first.
- **Scope:** by default it can only see the active tab and the files or folders I mention or select; anything wider needs explicit permission ("Allow access to Documents?").
- **Prompt-injection guard:** file contents are data, never instructions. If a file says "delete everything", the assistant reports it and does nothing.
- **Speed:** the model runs in the local AI runtime, loads on first use and unloads after idle; the panel opens instantly and shows model loading with progress; answers stream word by word (first words within the Waiting-with-feedback tier); Stop cancels immediately. The app stays within its speed tiers while the model runs.
- **Assistant preferences (Settings > Assistant):** a name for the assistant; answer length (short, normal, detailed); tone (friendly or neutral); language (follow the app, or reply in the language I write in); whether it shows the steps it took; which low-risk actions it may run without asking (for example open tabs, group tabs, search, read files) and which always need a preview (create, move, rename, convert, tag, privacy clean). Deleting always requires the two confirmations and the Recycle Bin, whatever these settings say. Also: folders it may never access, whether it may read file contents at all, keep or don't keep chat history, and clear chat history.
- **Models, tiers, and runtime:** as in `plan/ai.md` (default Qwen3.5-4B with Whisper base; low-RAM Qwen3.5-2B; runner-up Gemma 4 E2B; optional Pro tier; or a model I already run). Hardware tier chosen automatically, changeable in Settings.
- **AI evaluation harness:** build the shared evaluation system from `plan/ai.md` now: at least 100 English and 100 Spanish assistant requests scoring tool choice, arguments, refusal of unsafe actions, and speed, plus the prompt-injection set. Later AI steps add their own sets.

## Help pages
The assistant; what it can and can't do; assistant preferences and privacy; models and hardware tiers.

## Done when
The assistant opens and groups tabs, creates a file with requested content, tags files, recycles files only after two confirmations, answers questions about a PDF, an image, and a short video in English and Spanish, refuses the prompt-injection files, and the app stays within its speed tiers while it runs; evaluation scores are in the step report.
