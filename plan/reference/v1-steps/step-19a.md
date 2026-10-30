# Step 19a: Video timeline editor: tracks and clips (★★★★★)

**Needs:** 15. **Builds:** timeline engine. **Design:** design the timeline in the Figma style first.

## Tasks
- A timeline editor opened from a video tab ("Edit in timeline") or with a new timeline project.
- **Tracks:** multiple video and audio tracks; add clips by dragging from the Explorer, the shelf, or other tabs.
- **Clips:** move, trim, split, ripple delete, snap, slip; thumbnails along video clips and waveforms on audio clips.
- **Preview:** proxy playback (lower-resolution copies made in the background) so scrubbing stays at 30 fps or more; the project opens within the Fast tier.
- **Project format:** an open, documented project file referencing the source media.

## Parts to consider
The media tools pack (FFmpeg); Mediabunny (MPL-2.0) / WebCodecs for in-webview decoding and thumbnails; wavesurfer.js (BSD-3-Clause). Kdenlive, Shotcut, OpenShot, and Olive are GPL: study their ideas only.

## Help pages
The timeline; working with clips; proxies and smooth playback.

## Done when
I can build a short video from five clips on two tracks, trim and split them, and scrub smoothly.
