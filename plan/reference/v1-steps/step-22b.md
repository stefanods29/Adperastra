# Step 22b: AI for decks and the style library (★★★★)

**Needs:** 22a, 17a. **Also read:** `plan/ai.md`. **Milestone:** v1.0 after this step.

## Tasks
- **Actions:** "Create slides from this document / outline / notes", "Add a slide about...", "Shorten this slide", "Write speaker notes", "Suggest a better layout".
- **The model never draws slides.** It produces a structured outline (JSON: slide type, title, bullets, image suggestions, speaker notes) that the app places into real layouts from a **style library**, so results always look clean.
- **Style library:** at least 8 styles, each with its own layouts, fonts, colors, density, and writing rules, so the model knows what each is for: Business pitch, Report/results, Class/education, Minimal, Creative/visual, Technical/engineering, Training/how-to, and Personal/event. I can pick a style or let it suggest one, change style afterwards with one click, and add my own styles from my templates.
- **Tuning across styles:** prompts with examples for every style and language; an evaluation set of outlines per style; if needed, a LoRA adapter trained on examples covering all the styles (only material we have rights to; `plan/ai.md`).
- Generated decks open as a draft with an undo toast; nothing overwrites an existing deck without the version store.

## Help pages
Creating slides with AI; the style library; adding my own styles.

## Done when
I can turn a document into a clean draft deck in each of the 8 styles in English and Spanish, switch styles with one click, and the evaluation scores are in the step report. I approve and v1.0 is released.
