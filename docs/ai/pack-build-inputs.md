# Local AI pack build inputs (Step 14c, revision `ai-upstream-1`)

This file freezes the source inputs and the build/conversion requirements for the
local AI helper and model packs. It does **not** contain an approved pack hash,
a signed catalog entry, a downloaded weight, a built executable or a measured
quality result. The coordinator produces, inspects, hashes and signs the real
artifacts before any pack becomes available.

## 1. Runtime source pins

All four runtime projects are MIT. Code and weights are separate checks.

| Component | Fixed source | License | Use |
|---|---|---|---|
| llama.cpp | `b12032`, commit `dde879bc4f954b809892fd0d660515f42536394a` | MIT | Text/vision helper; pinned `llama.h` and `mtmd`. Vulkan then CPU. |
| ONNX Runtime | `1.23.2`, commit `a83fc4d58cb48eb68890dd689f94f28288cf2278` | MIT | Image and embedding tensors. Verified DirectML then CPU. |
| whisper.cpp | `1.8.2`, commit `4979e04f5dcaccb36057e059bbaed8a2f5288315` | MIT | Speech helper; CPU independently. |
| Real-ESRGAN | `0.3.0`, commit `fa4c8a03ae3dbc9ea6ed471a6ab5da94ac15c2ea` | BSD-3-Clause | Official upscaler model architecture and conversion provenance. |

The exact model repositories, revisions and advertised LFS SHA-256 values are in
`plan/parallel/AI-API-EVIDENCE.md`. An advertised LFS hash identifies the
upstream object only. It is **not** a verification of a received blob, a
converted GGUF, an exported ONNX file, a DLL or the helper executable.

Source model families used by the reserved packs:

| Pack id | Source model | Repository revision | Publisher license |
|---|---|---|---|
| `ai_assistant_small` | Qwen3.5-2B | `15852e8c16360a2fea060d615a32b45270f8a8fc` | apache-2.0 |
| `ai_assistant` | Qwen3.5-4B | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` | apache-2.0 |
| `ai_assistant_pro` | Qwen3.5-9B | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` | apache-2.0 |
| `ai_embeddings_text` | multilingual-e5-small | `614241f622f53c4eeff9890bdc4f31cfecc418b3` | mit |
| `ai_embeddings_vision` | siglip2-base-patch16-224 | `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2` | apache-2.0 |
| `ai_speech` | whisper.cpp `ggml-base` | `5359861c739e955e79d9a303bcbc70fb988958b1` | mit |
| `ai_foreground` | BiRefNet | `e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4` | mit |
| `ai_inpaint` | MI-GAN | `406830d0fa60666da0071c342ad2fbc8f30c5c64` | mit (code and weights) |

`ai_upscale` uses the official Real-ESRGAN release assets:

| UI model | Official asset | Release | Bytes |
|---|---|---|---|
| General | `realesr-general-x4v3.pth` | `v0.2.5.0` | 4,885,111 |
| Photos | `RealESRGAN_x4plus.pth` | `v0.1.0` | 67,040,989 |
| Drawings | `RealESRGAN_x4plus_anime_6B.pth` | `v0.2.2.4` | 17,938,799 |

GitHub currently returns no asset digest for these files. Missing upstream
digests stay missing. The coordinator downloads from the official release page,
records the URL/date, independently computes SHA-256, keeps the retained source
archive, and records the derived ONNX hash separately.

## 2. Required build toolchain (coordinator pins the exact versions)

The repository does not claim a toolchain hash in advance. The coordinator
records all of the following in the pack provenance file before activation:

1. Windows SDK version and MSVC toolset version.
2. CMake version and generator.
3. Ninja version when used.
4. Python version plus the exact `torch`, `onnx`, `onnxruntime` and
   `onnxconverter-common` versions used for model export.
5. SHA-256 of every compiler, linker, Python wheel and conversion script.
6. Reproducibility check: two clean builds of the helper and every derived model
   must produce identical SHA-256 values, or the difference must be explained
   and accepted in the pack review.

No build step may download a source, model or tool at build time. CMake receives
already retained local source directories (see `native/ai-host/CMakeLists.txt`).
Python conversion runs from retained wheels and a retained script at the pinned
Real-ESRGAN / llama.cpp commit.

## 3. Helper contents

`AdperastraAiHost.exe` is one app-owned helper with only these adapters:

- `llama_adapter.cpp`: pinned llama.cpp + mtmd C API, fixed chat/vision
  templates registered by the app, grammar-constrained output for an approved
  schema. No server, tools, agent loop, RPC, MCP, model download, shell,
  dynamic plugin or custom operator.
- `ort_adapter.cpp`: pinned ONNX Runtime C API. Named tensors only from the
  signed pack inventory; sequential execution; custom operators and external
  data disabled; DirectML memory patterns disabled. No webserver.
- `whisper_adapter.cpp`: pinned whisper.cpp C API, mono 16 kHz `f32` PCM input.
- `upscale_adapter.cpp`: Real-ESRGAN float32 ONNX, NCHW RGB 0..1, tensor names
  `input`/`output`, tile inference and alpha returned separately.

The helper never receives a user path. The parent opens source handles, copies
bounded bytes into the helper's private input, and writes helper output to an
owned staging file. The helper's process environment is fixed; no inherited
arbitrary variables, no `cmd.exe`, no shell and no network capability.

The helper header is at most 64 KiB; input and output chunks are at most 1 MiB;
the parent tracks checked totals. The protocol has no JSON file bytes.

## 4. Model conversion requirements

### Text and vision (llama.cpp)

- Convert from the exact Qwen source revision with the pinned
  `convert_hf_to_gguf.py`; language weights use `Q4_K_M`.
- Vision projector is `F16`; record its separate hash.
- Record the tokenizer/config shard hashes used for conversion.
- Run the pinned tokenizer asset and chat template from the signed catalog, not
  from the user's model folder.
- Do not accept a community quantization or a renamed file as the pinned model.

### Image upscaling (ONNX)

- Export each official Real-ESRGAN generator to float32 ONNX, opset 17,
  evaluation mode, dynamic spatial dimensions.
- Fixed tensor names: input `input`, output `output`; layout NCHW, RGB in
  `0..1`; no alpha channel in the model.
- General model: denoise strength 1, no DNI blend. Never silently substitute a
  different architecture.
- Record: exporter versions, command line, source `.pth` hash, ONNX hash,
  opset, input/output names and shapes, and a parity fixture comparing the
  pinned PyTorch output with ONNX Runtime CPU output.
- A parity failure disables the model; it never changes the seam thresholds.

### Embeddings, mask and inpaint (reserved)

- Export only when the producing step activates the capability.
- multilingual-e5-small: masked mean pooling, L2 normalization, `query: ` /
  `passage: ` prefixes, 384 dimensions.
- SigLIP2 base: projected image/text 768 dimensions, L2, internal 64-token text
  cap even though the public guard is 512.
- BiRefNet and MI-GAN use the official code/weight revisions above; no
  third-party ONNX mirror except the upstream-author-linked MI-GAN repository.

## 5. Pack catalog entries

Reserved pack ids: `ai_runtime`, `ai_upscale`, `ai_assistant_small`,
`ai_assistant`, `ai_assistant_pro`, `ai_embeddings_text`,
`ai_embeddings_vision`, `ai_speech`, `ai_foreground`, `ai_inpaint`.

Every model pack depends on the exact `ai_runtime` version. Entrypoints are
fixed: `runtime.llama`, `runtime.onnx`, `runtime.whisper`. Capabilities are
fixed: `ai.upscale`, `ai.structured_text`, `ai.vision_answer`, `ai.embed_text`,
`ai.embed_image`, `ai.embed_siglip_text`, `ai.transcribe`, `ai.foreground_mask`,
`ai.inpaint`.

Only `ai.upscale` is activated by Step 14c. The other capabilities remain
unavailable (`ai.pack_missing` / `ai.unsupported`) until their producing step
registers a verified provider.

## 6. Activation gates (all required, no placeholder)

A catalog entry may become installable only when all of these are retained:

1. Official source URL, revision and license text for code and weights.
2. Retained source archives and independent SHA-256 of every received byte.
3. Exact conversion toolchain inventory and reproducible derived hashes.
4. Signed catalog with file inventory, entrypoints and license notices.
5. Helper executable and DLL inventory with hashes and an SBOM.
6. Parity fixtures for each model, including seams and tensor names.
7. Real confinement canaries: no network, no outside-file read, no write
   outside the job root, descendant termination within 2 s.
8. Measured CPU/GPU memory and latency on named hardware.
9. English and Spanish quality evaluation for the activated capability.
10. Owner-visible pack review. A pack is never enabled by a hidden flag.

Failure of any gate leaves the capability unavailable. A missing pack never
triggers a download; the UI opens App storage and waits for the user's choice.

## 7. Not done by this file

- No weight, GGUF, ONNX, DLL, executable, installer or private key is committed.
- No production pack hash or signature is invented.
- No model is downloaded or run.
- No performance, quality or security acceptance is claimed.
