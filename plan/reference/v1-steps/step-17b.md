# Step 17b: Local AI actions (★★★★)

**Needs:** 17a. **Builds:** AI actions. **Also read:** `plan/ai.md`.

## Tasks
- An **"AI actions"** submenu on the right-click menu and in each file tab's ribbon, showing only actions whose packs are installed (others listed with "needs a pack" and an "Open App storage" button). Results open in a tab and are saved as new files (originals kept; overwriting goes through the version store). Every action shows a preview first (before/after for images), runs as a cancellable job, and never sends anything online.
  - **Images:** Remove background; Blur background; Erase object (brush over it and the model fills the area; also offered in the image editor's Erase panel); Copy text (OCR, no AI pack needed); Describe image and Ask about this image (assistant pack); Upscale (Step 14c pack).
  - **Documents and PDFs:** Summarize; Create FAQ; Translate (into any language the model supports, keeping the original); Extract key points and action items; Ask about this file.
  - **Audio and video:** Transcribe (subtitle file or text); Summarize; Find moments ("where does she talk about the budget?").
  - **Several files:** Compare documents; Summarize this folder.
- **Speech pack** (whisper.cpp + Whisper base model) installable on its own: transcription, and **automatic captions** in the media player (the hearing option from Step 10c).
- **Image AI packs** are small and work without the assistant: background removal and blur masks (BiRefNet (MIT) or U²-Net (Apache-2.0)), object erasing (LaMa (Apache-2.0) or MI-GAN, license verified), run through the local AI runtime with ONNX Runtime + DirectML or the CPU. Never use models with non-commercial licenses (for example BRIA RMBG).
- Add evaluation sets for each action (`plan/ai.md`).

## Help pages
AI actions overview, plus one page per action group (images, documents, audio and video, several files); automatic captions.

## Done when
With the packs installed, I can remove a photo's background, erase an object, summarize and translate a PDF, transcribe a video with captions, and compare two documents, all offline with previews first.
