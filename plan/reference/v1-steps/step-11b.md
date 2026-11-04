# Step 11b: Tags, smart folders, and views (★★★)

**Needs:** 11a. **Builds:** tag store, smart folders, extra view modes.

## Tasks
- **Tags:**
  - Color tags (a default set of colors with names I can rename) and custom named tags with a color; any number of tags per file or folder.
  - Add or remove tags from the right-click menu, the Details pane, keyboard shortcuts (for example Ctrl+1..7 when the Explorer has focus, configurable), bulk selection, the shelf, and later the assistant.
  - Stored in the app's database, keyed by the file's stable Windows file ID plus its path, so tags survive renames and moves within the same drive; files copied or moved by the app keep their tags across drives. Optionally also write tags into the file's own metadata where the format supports it (for example image keywords), off by default.
  - Tags appear as colored dots or chips in every view, as a column, in the Details pane, in the Filters search mode, and in the navigation pane ("Tags" section with each tag).
  - Tag management in Settings: rename, recolor, merge, delete (with undo), export and import.
  - Add the "Tagged files" section to the Home page registry (Step 10b) and the Tags section to the navigation pane.
- **Smart folders:** live views from saved searches (for example "PDFs over 10 MB modified this month" or "tagged Important"), shown in the navigation pane and Home, usable like folders.
- **Views beyond folders** (a "Views" section in the navigation pane; each can be turned on or off in Settings):
  - **Timeline:** files from chosen folders and types on a scrolling timeline grouped by day, week, month, and year, by date created, modified, or taken (EXIF); a zoomable scrubber on the side to jump to a month; filter by type and tag.
  - **Calendar:** a month grid showing how many files were created or changed each day; click a day to see them.
  - **By kind:** documents, spreadsheets, presentations, PDFs, images, videos, audio, archives, code, everywhere in the indexed folders, with filters.
  - **Recent activity:** what I opened, edited, converted, moved, or downloaded, in order, with the action and where it happened.
  - **Map (optional, off by default):** geotagged photos on a map; map tiles are downloaded from OpenStreetMap only while this view is open, respecting their usage policy, and the setting says clearly that this view uses the internet.
  - All views are virtualized, load progressively with skeletons, support the usual view modes where it makes sense, and open files in tabs like any folder.

## Parts to consider
A permissively licensed map library (for example Leaflet (BSD-2-Clause) or MapLibre GL JS (BSD-3-Clause)) for the map view.

## Help pages
Tags; managing tags; smart folders; Timeline, Calendar, By kind, Recent activity, and Map views.

## Done when
I can tag files with colors and names, rename a tagged file and keep its tags, find files by tag in search and in the navigation pane, save a smart folder, and browse my photos by date in Timeline and Calendar.
