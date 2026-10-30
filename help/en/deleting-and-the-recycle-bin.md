# Deleting and the Recycle Bin

## Delete

Select the items and press **Delete** (or the Delete button in the command bar). Items go to the Windows Recycle Bin, so you can get them back:

- Choose **Undo** in the message that appears, or press Ctrl+Z, to put everything back where it was.
- Or open the Recycle Bin in Windows Explorer and restore the items there.

Deleting never overwrites anything else: if a new item has taken the deleted item's name in the meantime, restoring it is skipped and the deleted item stays in the Recycle Bin.

## Delete permanently

**Delete permanently** (Shift+Delete) skips the Recycle Bin. Because this cannot be undone, you are always asked first, and the message says plainly that it cannot be undone.

## The Recycle Bin belongs to Windows

Adperastra uses the same Windows Recycle Bin as Explorer, and the same size limits Windows sets for each drive. When the bin is full, Windows removes the oldest deleted items itself.

See also: "Undo" and "Copying and moving files".

## System items

Deleting a Windows system item, including one inside a selected folder, shows a separate warning before any item is changed. **Cancel** is selected first. **Continue** allows this one operation; it does not turn the warning off. Drive roots and the Windows and Program Files folders stay protected. Folders containing directory links or junctions are skipped so a deletion cannot follow the link into another folder.
