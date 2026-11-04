# AI: models, quality rules, and evaluation

Read this file only in AI steps (14c and 17a onward). These choices are reviewed again when those steps are expanded (`plan/EXPANDING.md`), because small models change quickly.

AI features are optional and individually controlled. Local engines run through14c and optional12a packs. The assistant also offers **Local AI** or **API key** mode by owner direction2026-11-02, with **Meta Model API first** in API provider selection. Local AI is the initial default; choosing API never enables background transmission or silent fallback. Local speech/upscaling/masks/embeddings stay local. Packs are chosen in setup/App storage; API mode needs no local language-model pack.

## Assistant backend choice (owner direction2026-11-02)

The exact provider/credential/request/consent/streaming types live in17a and its provider contract. Use the current [Meta Model API reference](https://dev.meta.ai/docs/api-reference) with base https://api.meta.ai/v1; do not confuse it with the older Llama-specific API response schema. Prioritize Meta in API mode; local inference remains available. Hosted service models are not bundled weights and do not change local model-license checks.

Keep API keys only in native profile-scoped protected credential storage, never plain settings, localStorage, exported setups, diagnostics, logs, screenshots or Git. Show provider/model/mode before Send. Sending a chat authorizes its visible typed text; attaching file-derived context needs a separate explicit outbound preview/Send decision bound to the exact payload and source revisions. Read scope does not authorize upload. Locked/sensitive data stays outside API routes unless the owner deliberately creates an ordinary safe copy first.

Changing provider starts a fresh context; do not resend local history or files automatically. Stop/cancellation closes requests; no automatic cloud fallback or paid retries. API failures offer retry or a user-chosen local switch. Connection tests and model discovery are explicit actions. No keys, accounts or charged calls are needed for this guide-authoring assignment.

## Principles

- **No training from scratch.** It costs huge amounts of data and compute and would end up worse than today's open models. Use pretrained models; give instruction models our tool list (generated from the command registry) so new commands work without retraining. Fine-tune small LoRA adapters only if the evaluation shows gaps.
- **Licenses:** code and model weights must be MIT, BSD, Apache-2.0, or similarly permissive; never non-commercial (see `plan/rules.md` R-LIC). Verify each license, including every weight file, before shipping.
- **Where models live:** downloaded from official sources, pinned and checksummed, never committed to Git (see `plan/rules.md` R-REPO). Model files are downloaded by the pack manager (Step 12a) from their official pages, pinned to an exact version and checked with SHA-256.
- **Inference output is untrusted regardless of backend.** The same typed tool/scope/approval/undo rules apply to local and API results.
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
- **Fine-tuning only when needed:** if prompting isn't enough, fine-tune a small LoRA adapter on examples we can legally use (my own documents, permissively licensed or public-domain texts, synthetic examples), covering several writing and deck styles; never train on material we don't have rights to. Host adapters as GitHub Release assets or on a Hugging Face page, never in the repository.
- **Quality tiers:** default small model, optional larger local model for better writing, or a model I already run. Show clearly which tier is active and what to expect from it.
- **Don't ship weak features:** a feature that scores poorly in the evaluation is marked "Experimental" (off by default) or left out.

## Evaluation harness

- Every AI feature has a test set with expected results in English and Spanish, scored automatically by the test suite (`git-and-testing.md`), with results in the step report.
- Assistant: at least 100 English and 100 Spanish requests (open, group, create, convert, delete, ask about a PDF, describe an image, summarize a video), scoring correct tool choice, correct arguments, refusal of unsafe actions, and speed.
- Other features: rewrite and tone quality, formula correctness, deck outlines in each style, extraction accuracy, rename suggestions, natural-language search conversion, photo search relevance.
- Prompt-injection set: files that try to make the assistant delete, move, or leak things; all must be refused and reported.

## Frozen guide evidence and scope

All54 remaining steps include AI. Exact researched runtime/model source revisions, licenses and weight metadata are in parallel/AI-API-EVIDENCE.md; final converted/runtime pack bytes require measured production hashes and coordinator acceptance. No weights are committed or downloaded during guide authoring.17a defines transport fixtures for local/no-network and Meta/API consent/key/error/streaming cases; real provider checks require the owner to configure credentials later, without weakening offline or safety tests. The present task stops after reviewed guides and54step prompts.
