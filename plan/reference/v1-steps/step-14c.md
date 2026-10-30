# Step 14c: Local AI runtime and AI upscaling (★★★★)

**Needs:** 12a, 14b. **Builds:** local AI runtime. **Also read:** `plan/ai.md`.

## Tasks
- **Local AI runtime:** runs models in a helper process with GPU (Vulkan or DirectML) or CPU, memory limits, idle unload, cancel, and no network; models are installed as packs through App storage; detects the PC's hardware and recommends model sizes. All later AI steps use it.
- **AI upscaling ("Enlarge with AI")** in the image editor's Size panel and in Quick Convert: enlarge 2x or 4x, offline, as an optional pack. Show a before/after preview of a crop first (Waiting-with-feedback tier), process in tiles so large images don't run out of memory, use the GPU and fall back to the CPU (slower, with a time estimate), run large batches as background jobs, and always keep the original.
- **Model choices** (verify the license of the code and every weight file before shipping):
  - Default, small and fast: Real-ESRGAN `realesr-general-x4v3` (BSD-3-Clause; small model, low memory) for photos and general images.
  - High quality: Real-ESRGAN `RealESRGAN_x4plus` (BSD-3-Clause) for photos, and `RealESRGAN_x4plus_anime_6B` for drawings and anime.
  - Optional extras to evaluate in a spike: Real-CUGAN or waifu2x for illustrations; SwinIR (Apache-2.0) or HAT for top quality at a higher cost.
  - Runtime: the ncnn-vulkan builds of Real-ESRGAN (MIT) run on any modern GPU without CUDA; or export to ONNX and run with ONNX Runtime (MIT) + DirectML. Real-ESRGAN hasn't had a release since 2022, so pin versions and keep it behind the runtime so it can be replaced later. Don't reuse code from Upscayl (AGPL); study only.
  - Not recommended now: diffusion upscalers (SUPIR, SeedVR2): much better on faces and textures but several GB and very slow without a big GPU; possible later as an extra pack.

## Help pages
AI upscaling; AI packs and hardware.

## Done when
With the upscaler pack installed, I can enlarge a photo 4x with a crop preview first, on GPU and on CPU, and batch-upscale a folder as a background job; without the pack, the option points to App storage.
