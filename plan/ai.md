# AI: models, quality rules, and evaluation

All AI features are optional packs, run locally through the local AI runtime (Step 14c), never send files anywhere, and can be turned off individually in Settings > AI. Packs are chosen in the setup window's first-run checklist or later in App storage.

## Principles

- **No training from scratch.** It costs huge amounts of data and compute and would end up worse than today's open models. Use pretrained models; give instruction models our tool list (generated from the command registry) so new commands work without retraining. Fine-tune small LoRA adapters only if the evaluation shows gaps.
- **Licenses:** code and model weights must be MIT, BSD, Apache-2.0, or similarly permissive; never non-commercial (see `rules.md`). Verify each license, including every weight file, before shipping.
- **Where models live:** downloaded from official sources, pinned and checksummed, never committed to Git (see `rules.md`, section 9).
- **Every AI result is a suggestion:** preview, accept, retry, edit, or discard; nothing is overwritten without the version store and an undo toast.
- **File contents are data, never instructions** (protection against prompt injection).

## Model choices (confirm with the evaluation; check current versions before using)

**Assistant and text tasks**
- **Default: Qwen3.5-4B** (Alibaba, Apache-2.0, March 2026), 4-bit GGUF, about 3.4 GB, about 6 GB of RAM/VRAM. Natively multimodal (text, images, video), about 200 languages, strongest reasoning at this size among the candidates. No audio input, so pair it with **whisper.cpp (MIT) and the multilingual `base` Whisper model (about 150 MB)** for speech and video sound. Assistant pack total: about 3.5-4 GB.
- **Low-RAM PCs (8 GB or less): Qwen3.5-2B**, 4-bit, about 2.7 GB, same features, weaker reasoning.
- **Runner-up to test against the default: Gemma 4 E2B** (Google, Apache-2.0, April 2026), 4-bit, about 3.4 GB. Images, video, and audio in one model, function calling, about 140 languages. If it scores as well as Qwen3.5-4B, prefer it for its built-in audio. Gemma 4 E4B (about 5.3 GB) is too heavy for the default.
- **Optional "Pro" tier** for strong PCs (8 GB+ VRAM or 16 GB+ RAM): Qwen3.5-9B, about 6.6 GB.
- Don't ship Ministral 3 or SmolVLM2 unless the evaluation shows they beat the above at the same size.
- Option to use a model the user already runs (Ollama or another OpenAI-compatible local server).
- Hardware tier chosen automatically from RAM/VRAM at install, changeable in Settings.

**Search and organizing**
- Text embeddings (search documents by meaning): a small multilingual model, for example multilingual-e5-small (MIT) or Qwen3-Embedding (Apache-2.0).
- Image-text embeddings (search photos by content, similar files): SigLIP 2 (Apache-2.0, base size about 375M parameters); check Spanish query quality in the evaluation.
- Vector storage in the local index: `sqlite-vec` (MIT/Apache-2.0) or `usearch` (Apache-2.0).

**Images**
- Upscaling: Real-ESRGAN models (BSD-3-Clause), details in Step 14c.
- Background removal and blur masks: BiRefNet (MIT) or U²-Net (Apache-2.0). Avoid BRIA RMBG (non-commercial license).
- Object erasing: LaMa (Apache-2.0) or MI-GAN (verify license).

**Speech**
- Speech to text (dictation, transcription, captions): whisper.cpp (MIT) with Whisper models.
- Read aloud: Windows' built-in voices. (Piper is GPL since 2025 and can't be bundled; Kokoro (Apache-2.0) can be evaluated later as an optional natural-voice pack.)

**Runtime**
- llama.cpp (MIT) as a local helper process for language models, with 4-bit GGUF models and GPU acceleration through Vulkan or CUDA, falling back to the CPU. Alternative: ONNX Runtime GenAI (MIT) with DirectML.
- ONNX Runtime (MIT) with DirectML or CPU for image models; ncnn-vulkan builds where better (Real-ESRGAN).

## Quality rules (important: small local models are limited)

- **Small, specific jobs:** one paragraph to rewrite, one formula, one outline, one file to rename. Long documents are processed section by section.
- **Structured output always:** JSON schemas or grammar-constrained decoding in llama.cpp, so the app, not the model, handles formatting, layout, file writing, and validation.
- **Careful prompts:** system prompts with 3-5 good examples per task and per language (English and Spanish at least), stored as versioned files in the repository.
- **Check results with real tools when possible:** formulas are calculated before inserting, filters are shown as chips before searching, renames are previewed, extracted data is shown next to its source.
- **Fine-tuning only when needed:** if prompting isn't enough, fine-tune a small LoRA adapter on examples we can legally use (my own documents, permissively licensed or public-domain texts, synthetic examples), covering several writing and deck styles; never train on material we don't have rights to. Host adapters as described in `rules.md`.
- **Quality tiers:** default small model, optional larger local model for better writing, or a model I already run. Show clearly which tier is active and what to expect from it.
- **Don't ship weak features:** a feature that scores poorly in the evaluation is marked "Experimental" (off by default) or left out.

## Evaluation harness

- Every AI feature has a test set with expected results in English and Spanish, scored automatically by the test suite (`git-and-testing.md`), with results in the step report.
- Assistant: at least 100 English and 100 Spanish requests (open, group, create, convert, delete, ask about a PDF, describe an image, summarize a video), scoring correct tool choice, correct arguments, refusal of unsafe actions, and speed.
- Other features: rewrite and tone quality, formula correctness, deck outlines in each style, extraction accuracy, rename suggestions, natural-language search conversion, photo search relevance.
- Prompt-injection set: files that try to make the assistant delete, move, or leak things; all must be refused and reported.
