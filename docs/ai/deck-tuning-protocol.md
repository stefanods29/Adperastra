# Deck prompt evaluation and tuning protocol

Status: protocol only. No model, prompt score, adapter or release has been run,
trained, downloaded or approved by this document.

## 1. Corpus

- 10 English and 10 Spanish source cases per style (160 create cases total),
  plus 20 cases per action and language for add, shorten, notes, layout and
  style (200 action cases).
- Fixed files live under `tests/fixtures/ai/decks/corpus.json`. Cases are
  synthetic; no personal document, customer name or owner file is included.
- Every run records the corpus hash, prompt revision, model id and revision,
  hardware, seeds and app build. Scores from a different corpus or model are
  not comparable.

## 2. Mandatory gates (100 percent, no averaging)

- Schema validation, layout availability, licensed font, license metadata and
  safe-operation checks pass for every generated deck.
- Accepted overflow is zero. The real clone render decides overflow; a text
  length heuristic is not evidence.
- Protected facts (names, numbers, dates, URLs, units) are preserved at 100
  percent. A single 120-to-12 loss fails the run.
- Automatic image download is zero. Image suggestions remain plain prompts or
  explicit local references.

## 3. Blind human review

- Style fit, groundedness and readability are scored blind by reviewers who do
  not see the prompt or style name.
- Each of the 16 language/style groups needs style fit at least 4/5 and
  readability at least 4/5; groundedness is at least 95 percent.
- The Spanish style-fit average may be at most 0.25 points below English for
  the same style. A larger drop is a failure, not a translation preference.

## 4. A/B prompt revisions

- Compare revisions only on the same corpus, hardware, model and seeds.
- Keep the previous revision available until the new one passes all gates.
- A failing quality result leaves the affected action Experimental or off.
  Safety failures disable the action regardless of style score.

## 5. Optional LoRA or adapter tuning

Training is optional and requires all of the following:

- a retained failure analysis that identifies a specific repeated gap;
- explicit dataset rights, provenance, license and owner cost approval;
- training outside the application repository and outside this Git history;
- no weights, adapters, GGUF/ONNX/Safetensors files or model caches in Git;
- no automatic training, no API training endpoint and no personal document
  without explicit consent;
- a new evaluation with the same corpus and a recorded adapter hash.

Without a qualified legal and quality case, the feature remains Experimental
or off. The step's completion does not depend on speculative tuning success.

## 6. Release

The v1.0 release is a draft until every manual and AI requirement, the full
gate, packaging, speed, accessibility, security, fidelity and these quality
gates pass, and the owner explicitly approves publication. No guide author or
worker may mark model quality or the release as passed.
