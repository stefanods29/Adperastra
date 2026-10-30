# Step 08b: Privacy cleaner, round 1 (★★★)

**Needs:** 08a. **Builds:** privacy cleaner (optional, off unless asked).

## Tasks
- **The privacy cleaner is fully optional; keeping information is the default.** Nothing is ever removed unless I ask for it. Conversions, saves, edits, and copies preserve metadata by default.
- **"Remove hidden information"** shows what hidden information a file contains and removes what I choose, for images (EXIF, GPS location, camera and owner info, embedded thumbnails, XMP/IPTC) and PDFs (author, title, producer, XMP metadata, attachments, annotations, JavaScript, form data). I can pick exactly what to remove (for example remove the location but keep the date and camera). By default it writes a cleaned copy; overwriting the original goes through the version store. Show a before/after list of what was removed.
- **Entry points:** a "Privacy" section in the Details pane; a "Remove hidden information" right-click command for one or many files; an optional "Remove location and personal info" checkbox (unchecked by default) in Quick Convert and batch presets.
- **Settings > Privacy:** per file type, "Keep all metadata" (default), "Ask me each time", or "Always remove (choose what)"; an optional location warning icon on photos and an optional prompt when sharing ("This photo includes its location. Remove it before sharing?"), both **off by default**.

## Parts to consider
`little_exif` or `kamadak-exif` plus re-encoding without metadata via the `image` crate; `lopdf` (MIT) or pdf-lib (MIT) for PDFs. exiftool is Perl under the Artistic/GPL license: use it only if the user installed it themselves.

## Help pages
Removing hidden information; privacy settings.

## Done when
I can remove only the location from a batch of photos (keeping date and camera) into cleaned copies; with default settings nothing is ever removed and no warnings appear.
