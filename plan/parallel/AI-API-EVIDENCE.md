# AI source evidence — revision ai-upstream-1

Research date: 2026-11-02. These are official source/API metadata observations, not executed inference, license advice, downloaded-weight hashes or production-pack approval. No weights were downloaded. API LFS SHA-256 fields identify advertised upstream objects; the pack producer must independently hash the received bytes and every derived GGUF/ONNX/DLL/executable. A derived artifact has a different hash. Missing upstream release digests remain missing, never invented. Immutable source links use the revisions below. Code and weights have separate checks.

## Runtime source pins

| Component | Pin | License and official evidence |
|---|---|---|
| llama.cpp | b12032; dde879bc4f954b809892fd0d660515f42536394a | MIT; [license](https://github.com/ggml-org/llama.cpp/blob/dde879bc4f954b809892fd0d660515f42536394a/LICENSE); [llama.h](https://github.com/ggml-org/llama.cpp/blob/dde879bc4f954b809892fd0d660515f42536394a/include/llama.h); [mtmd](https://github.com/ggml-org/llama.cpp/tree/dde879bc4f954b809892fd0d660515f42536394a/tools/mtmd) |
| whisper.cpp | v1.8.2; 4979e04f5dcaccb36057e059bbaed8a2f5288315 | MIT; [license](https://github.com/ggml-org/whisper.cpp/blob/4979e04f5dcaccb36057e059bbaed8a2f5288315/LICENSE); [whisper.h](https://github.com/ggml-org/whisper.cpp/blob/4979e04f5dcaccb36057e059bbaed8a2f5288315/include/whisper.h) |
| ONNX Runtime | v1.23.2; a83fc4d58cb48eb68890dd689f94f28288cf2278 | MIT; [license](https://github.com/microsoft/onnxruntime/blob/a83fc4d58cb48eb68890dd689f94f28288cf2278/LICENSE); [C API](https://github.com/microsoft/onnxruntime/blob/a83fc4d58cb48eb68890dd689f94f28288cf2278/include/onnxruntime/core/session/onnxruntime_c_api.h); [DirectML provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) |
| Real-ESRGAN | v0.3.0; fa4c8a03ae3dbc9ea6ed471a6ab5da94ac15c2ea | BSD-3-Clause; [license](https://github.com/xinntao/Real-ESRGAN/blob/fa4c8a03ae3dbc9ea6ed471a6ab5da94ac15c2ea/LICENSE); [model zoo](https://github.com/xinntao/Real-ESRGAN/blob/fa4c8a03ae3dbc9ea6ed471a6ab5da94ac15c2ea/docs/model_zoo.md) |
| Real-ESRGAN ncnn alternative, not selected | v0.2.0; 37026f49824c5cf84062e7c6a5dd71445dcf610f | MIT; [API](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/blob/37026f49824c5cf84062e7c6a5dd71445dcf610f/src/realesrgan.h). The presumed 20220424 tag does not resolve; do not prescribe it. |
| BiRefNet | f7079632d681ecf12161fcea8905682934e59e51 | MIT; [license](https://github.com/ZhengPeng7/BiRefNet/blob/f7079632d681ecf12161fcea8905682934e59e51/LICENSE) |
| MI-GAN | 2b793c5ece43f4253e32d4afc257120a5deed6f5 | MIT code and separately MIT weights; [code license](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/LICENSE), [weight license](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/LICENSE-WEIGHTS), [official pipeline export and upstream author model link](https://github.com/Picsart-AI-Research/MI-GAN/blob/2b793c5ece43f4253e32d4afc257120a5deed6f5/README.md) |

## Model repositories and advertised objects

All model URLs below are official publisher pages, except the MI-GAN ONNX repository owned by the upstream paper author and linked by the official repository. Do not use a convenient third-party mirror. Qwen GGUF + vision projector and BiRefNet/SigLIP ONNX are coordinator-built derivative packs from these pinned sources, not unspecified community quantizations. Source models require their own notices. Gemma is a comparison candidate only; no automatic substitution.

### Qwen/Qwen3.5-4B

Revision: 851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a. Publisher license metadata: apache-2.0. [Pinned source](https://huggingface.co/Qwen/Qwen3.5-4B/tree/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a); [metadata](https://huggingface.co/api/models/Qwen/Qwen3.5-4B/revision/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors-00001-of-00002.safetensors | 5329398688 | 26a93f066e1916adb13453dae5a0c707c0fbc71299ed98779571a907b8e74c61 |
| model.safetensors-00002-of-00002.safetensors | 3990429408 | cb544bd9bfae93dc59b0f22b292f5933573854a7f9b97835c67060d7d910e188 |
| model.safetensors.index.json | 76196 |  |

### Qwen/Qwen3.5-2B

Revision: 15852e8c16360a2fea060d615a32b45270f8a8fc. Publisher license metadata: apache-2.0. [Pinned source](https://huggingface.co/Qwen/Qwen3.5-2B/tree/15852e8c16360a2fea060d615a32b45270f8a8fc); [metadata](https://huggingface.co/api/models/Qwen/Qwen3.5-2B/revision/15852e8c16360a2fea060d615a32b45270f8a8fc?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors-00001-of-00001.safetensors | 4548221488 | aa33250c4fc64891ddfaba3a314fd9542ea371843c387178b425fbcc5ed680b1 |
| model.safetensors.index.json | 64460 |  |

### Qwen/Qwen3.5-9B

Revision: c202236235762e1c871ad0ccb60c8ee5ba337b9a. Publisher license metadata: apache-2.0. [Pinned source](https://huggingface.co/Qwen/Qwen3.5-9B/tree/c202236235762e1c871ad0ccb60c8ee5ba337b9a); [metadata](https://huggingface.co/api/models/Qwen/Qwen3.5-9B/revision/c202236235762e1c871ad0ccb60c8ee5ba337b9a?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors-00001-of-00004.safetensors | 5276436216 | db6f444b43d318c92f360a13a25561a6a65b10c0631b8ed305a426dbaa6c380e |
| model.safetensors-00002-of-00004.safetensors | 5335161512 | 31c7d7e2dd5d207840b31cc59083c8f4c4718959149e0358c0364052bb9a0330 |
| model.safetensors-00003-of-00004.safetensors | 5368717440 | 7ec36ba3a4176a44c3c0876ad80c56a2f70c84bf008d82e9501df642f17dadec |
| model.safetensors-00004-of-00004.safetensors | 3325995712 | b62b0c4cd7e44edee103ee8f4fe225f246d5e768e07bfd5f25b63a8aa1fdd0c6 |
| model.safetensors.index.json | 79657 |  |

### google/gemma-4-E2B

Revision: d29ff6b45f081a49ee2733a859c9c9c2d95d1a6f. Publisher license metadata: apache-2.0. [Pinned source](https://huggingface.co/google/gemma-4-E2B/tree/d29ff6b45f081a49ee2733a859c9c9c2d95d1a6f); [metadata](https://huggingface.co/api/models/google/gemma-4-E2B/revision/d29ff6b45f081a49ee2733a859c9c9c2d95d1a6f?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors | 10246621918 | 76dc84a5a805a2c8b91e9ccc00b8dbf8f4a99bf0d56ab25832f6e6addd4f7f57 |

### intfloat/multilingual-e5-small

Revision: 614241f622f53c4eeff9890bdc4f31cfecc418b3. Publisher license metadata: mit. [Pinned source](https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3); [metadata](https://huggingface.co/api/models/intfloat/multilingual-e5-small/revision/614241f622f53c4eeff9890bdc4f31cfecc418b3?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| onnx/model.onnx | 470268510 | ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665 |

### google/siglip2-base-patch16-224

Revision: 75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2. Publisher license metadata: apache-2.0. [Pinned source](https://huggingface.co/google/siglip2-base-patch16-224/tree/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2); [metadata](https://huggingface.co/api/models/google/siglip2-base-patch16-224/revision/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors | 1500800904 | 612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b |

### ZhengPeng7/BiRefNet

Revision: e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4. Publisher license metadata: mit. [Pinned source](https://huggingface.co/ZhengPeng7/BiRefNet/tree/e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4); [metadata](https://huggingface.co/api/models/ZhengPeng7/BiRefNet/revision/e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| model.safetensors | 444473596 | 9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154 |

### ggerganov/whisper.cpp

Revision: 5359861c739e955e79d9a303bcbc70fb988958b1. Publisher license metadata: mit. [Pinned source](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1); [metadata](https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/5359861c739e955e79d9a303bcbc70fb988958b1?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| ggml-base.bin | 147951465 | 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe |

### andraniksargsyan/migan

Revision: 406830d0fa60666da0071c342ad2fbc8f30c5c64. Publisher license metadata: mit. [Pinned source](https://huggingface.co/andraniksargsyan/migan/tree/406830d0fa60666da0071c342ad2fbc8f30c5c64); [metadata](https://huggingface.co/api/models/andraniksargsyan/migan/revision/406830d0fa60666da0071c342ad2fbc8f30c5c64?blobs=true).

| Object | Bytes | Advertised SHA-256 |
|---|---|---|
| migan_pipeline_v2.onnx | 28079181 | 6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b |

## Weight-license verification and unavailable digests

Qwen's pinned LICENSE is Apache-2.0. Gemma 4 E2B has no root LICENSE file at the pinned repository; its pinned model card links to Google's [Gemma 4 Apache-2.0 license page](https://ai.google.dev/gemma/docs/gemma_4_license). Do not apply the old Gemma license to Gemma 4 or infer licenses from model names. The pack review retains the linked legal text. BiRefNet's pinned publisher model card declares MIT and links its upstream MIT repository. Whisper weights retain OpenAI's MIT notice in addition to whisper.cpp's MIT notice. MI-GAN's separate weight license is MIT, not inferred from its code license. BRIA RMBG metadata says other; excluded.

Real-ESRGAN official release assets: general realesr-general-x4v3.pth at v0.2.5.0 (4,885,111 bytes), photo RealESRGAN_x4plus.pth at v0.1.0 (67,040,989 bytes), drawing RealESRGAN_x4plus_anime_6B.pth at v0.2.2.4 (17,938,799 bytes). [General](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0), [photo](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.1.0), [drawing](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.2.4). GitHub metadata currently returns null asset digests. The coordinator must download, independently hash and archive provenance before activating a signed catalog entry. Do not claim a preexisting checksum or mark a pack verified from filename/size alone.

## Checked APIs and adapter decisions

The pinned llama.h contains llama_model_default_params, llama_context_default_params, llama_model_load_from_file, llama_init_from_model, llama_decode and grammar sampler APIs. Native adapter uses the pinned C library and mtmd library for vision, never upstream built-in tools, agent mode, RPC, MCP, server downloads or web UI. The app's own typed helper protocol is the only tool boundary. No inference HTTP listener is opened by bundled helpers.

whisper_init_from_file_with_params accepts const char model path and whisper_context_params and returns whisper_context pointer; whisper_full accepts context/full parameters/float sample array/sample count and returns int status. whisper_full_default_params accepts whisper_sampling_strategy. Audio must be mono 16,000 Hz float32; timestamps are converted to TimeUs, not guessed from word count.

ONNX Runtime's C API loads only catalog-approved models in the confined helper, disables custom operators/external unapproved data, runs sequential execution, disables memory patterns for DirectML, and binds named tensors from the pack inventory. DirectML session configuration follows official provider limitations. CPU retry recreates the session; never reinterpret failed GPU output as valid. Upstream C headers are authoritative for ABI signatures; the app-owned helper protocol and frozen public DTOs are detailed in step-14c.

## Production evidence required later

Coordinator tasks must retain source archives and hashes; exact converter toolchain inventory and licenses; deterministic conversion options (Q4_K_M for language weights, F16 vision projector, float32 ONNX); tensor names/shapes/opset; independent derived hashes; code/DLL/executable inventories; SBOM/notices; parity fixtures; CPU/GPU inference and no-network/outside-file canaries; actual memory/latency and EN/ES evaluation. Record failures honestly. Signed catalog production and model evaluation are implementation acceptance work, not permission to invent metadata while writing guides.
