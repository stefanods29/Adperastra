# Opening and extracting archives

Archives are files that hold many files and folders in one, usually compressed: ZIP, 7z, TAR (also .tar.gz, .tar.xz and .tar.bz2), gzip (.gz), xz (.xz), bzip2 (.bz2, .tbz, .tbz2) and RAR files. Adperastra opens them like folders and extracts them safely.

## Look inside an archive

1. Double-click an archive. It opens in its own tab and shows its folders and files.
2. Double-click a folder to open it. Use the path at the top, **Up one level** or **Backspace** to go back.
3. Type in the search box at the top right to find files anywhere in the archive. **Open item location** shows where a found file is.

## Open a file inside

Double-click a file (or select it and press **Enter**). Adperastra copies it out by itself and opens it in a new tab. This copy is read-only: to keep changes, use **Save as** and choose a folder.

## Extract

- **Extract all** (in the archive tab, or on the command bar when an archive is selected): makes a new folder named after the archive, next to it, and puts everything in it.
- Right-click an archive > **Extract** > **Extract here**: puts the contents in the archive's folder.
- Right-click an archive > **Extract** > **Extract to…**: choose a folder; a new folder named after the archive is made inside it.
- In the archive tab, select items and click **Extract selected…**: choose a folder; the selected items go straight into it.

Extracting runs in the background: the File operations panel shows the progress and has **Cancel**. When it finishes, the new items are selected, and **Undo (Ctrl+Z)** sends them to the Recycle Bin.

## Good to know

- Extracting never replaces anything. If a file or folder with the same name is already there, the new one gets a number, like "report (1).txt".
- Items whose names could write outside the folder, or that Windows doesn't allow, are hidden and never extracted. Links inside archives are shown but never extracted.
- An archive that would expand to far more data than it holds (a "zip bomb"), or that doesn't fit on the drive, is refused before anything is written.
- Password-protected ZIP and 7z files ask for their password and can remember it until the app closes. See "Archive passwords".
- RAR uses a 7-Zip you install yourself from 7-zip.org; it is not included. Multipart, self-extracting, linked or ambiguous RAR files are refused, and RAR creation is not offered.
- If the archive came from the internet, the files you extract or open keep that mark, so they open in protected view.
- Archives are read in a separate, limited process, so a damaged archive can't freeze Adperastra.

See also: "Creating archives", "Archive passwords", "Opening files in tabs", "Copying and moving files" and "Undo".
