# Creating archives

Select files or folders, then choose **Compress to…** from the command bar or right-click menu. Choose a folder, a name and ZIP or 7z, then **Create**. The originals are unchanged. If the name already exists, the new archive gets a number starting at (1).

ZIP is a widely used format. 7z often makes smaller files. For a password, choose **AES-256**, enter it twice and keep it somewhere safe: Adperastra cannot recover a forgotten password. ZIP names remain visible. Encrypted 7z can also hide file names. **ZipCrypto** is offered only for old software and is weak.

Creation runs in File operations with progress and **Cancel**. Cancel before completion publishes no archive. Read the skipped-items report: links, online-only files, inaccessible files and hidden items that are off in the view are not silently included. Open online-only files first in Windows if you want to download them.

Undo sends the newly created archive to the Recycle Bin; Redo brings that exact archive back. Neither changes the source files. This version creates one archive at a time and has an 8 GB output limit. Select a parent folder when too many individual items are selected.

See also: “Archives” and “Archive passwords”.
