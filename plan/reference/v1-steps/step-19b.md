# Step 19b: Video timeline editor: effects, audio, and export (★★★★★)

**Needs:** 19a. **Builds:** render pipeline.

## Tasks
- **Transitions** (cross-fade, dip to color, wipes), **titles** (text with styles and simple animation), and **basic effects and color** (brightness, contrast, saturation, color correction, crop, speed, stabilization only if available under a compatible license).
- **Audio mixing:** per-clip and per-track volume, fades, mute and solo, simple noise reduction if available under a compatible license.
- **Subtitles** on the timeline (import, edit, burn in).
- **Export presets** (for example web 1080p, phone vertical, high quality, audio only) rendered through FFmpeg as a background job with progress and Cancel; exports never overwrite the source.

## Parts to consider
The media tools pack (FFmpeg, LGPL build only; avoid GPL-only filters); libass (ISC) for subtitles.

## Help pages
Transitions and titles; effects and color; audio mixing; exporting video.

## Done when
I can add transitions, a title, color correction, and background music with fades to my timeline project, and export it with a preset while I keep working.
