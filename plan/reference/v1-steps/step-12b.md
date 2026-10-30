# Step 12b: Converter, round 2 (media and documents), and privacy cleaner, round 2 (★★★★)

**Needs:** 12a. **Builds:** FFmpeg and Office packs, engine adapters.

## Tasks
- **Media tools pack (FFmpeg):** an LGPL build of FFmpeg, run as a helper process and wrapped in an engine adapter: video to video, video to audio or GIF, audio to audio, with a preview from a short sample clip. Prefer permissive codecs (VP9, AV1, Opus, Vorbis, FLAC) and the OS's or the GPU's H.264/HEVC/AAC encoders; x264 and x265 are GPL and can't be bundled.
- **Office engine pack (LibreOffice headless):** docx/xlsx/pptx/odt/rtf to PDF, plus html/txt where it works; docx to/from md/html/txt using permissive libraries; if the user installed Pandoc themselves, offer its extra formats with a "not included" note.
- **Privacy cleaner v2:** Office files (author, last modified by, company, comments, tracked changes, hidden text, speaker notes on request, document properties), audio and video (tags, GPS in phone videos, encoder info), and archives (file comments, timestamps on request). Office cleaning warns before removing comments or tracked changes, because that changes the content. Still fully optional and off unless I ask (Step 08b).
- Media metadata in the Details pane and conversions keep metadata by default, as in Step 08a.

## Parts to consider
FFmpeg (LGPL-2.1+ build, no GPL parts); Mediabunny (MPL-2.0; WebCodecs-based in-webview alternative for simple jobs); LibreOffice (MPL-2.0); mammoth.js (BSD-2-Clause), turndown (MIT), markdown-it (MIT), docx (MIT).

## Help pages
Converting audio and video; converting documents; removing hidden information from Office and media files.

## Done when
With the packs installed from App storage, I can convert a video to MP3 and a docx to PDF with a preview, strip the author and comments from a docx, and removing a pack makes those options show the "needs a pack" message.
