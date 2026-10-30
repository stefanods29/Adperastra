# Step 15: Audio and video basics (★★★★)

**Needs:** 12b. **Builds:** media edit mode. **Design:** the audio/video tab isn't in Figma; design it first.

## Tasks
- Trim, cut, and split; extract audio; rotate and crop; speed; volume and mute; subtitles on/off or burned in; export presets; audio waveform; progress and Cancel, using the media tools pack (FFmpeg) as the backend.
- Its own ribbon (Home, Edit, Export). Editing opens within the Fast tier; scrubbing stays smooth (at least 30 fps).
- Exports never overwrite the original by default; overwriting goes through the version store; long exports run as background jobs.
- Without the media tools pack, show the player only and a message linking to App storage.

## Parts to consider
The media tools pack; wavesurfer.js (BSD-3-Clause); libass (ISC) for subtitles; libmpv or libVLC (LGPL builds, separate DLL) if the HTML5 player isn't enough.

## Help pages
Trimming and cutting video; extracting audio; subtitles; exporting.

## Done when
I can trim a video, export it, and extract its audio, while the app stays responsive.
