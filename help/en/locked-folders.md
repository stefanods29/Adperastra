# Locked folders

Keep an encrypted container copy of selected folder contents.

## How to use

1. Select a folder and choose **Create encrypted copy…**. Review the warning: the original folder stays unencrypted.
2. Enter and confirm a password (at least 12 characters, spaces included) and save a separate recovery key.
3. Wait for verification. An **Encrypted copy saved** message appears only after every chunk was checked.
4. Open the `.adplock` file and choose **Unlock**. Browse supported files; names and contents stay in memory.
5. Use **Save encrypted copy…** to publish a new encrypted generation, or **Lock now** when you finish.

## Good to know

- The original folder remains unencrypted and is not removed. This action does not protect or delete it.
- Replacing an existing container is unavailable. Save a new copy and keep both files.
- Unsaved changes must reach verified encrypted recovery before locking completes.
- Container size and chunk sizes remain visible. Another program with sufficient access to this Windows account may read unlocked memory or an exported copy.
- Exporting an unencrypted copy writes ordinary files outside the container and asks first.
- The app does not promise secure erasure on SSDs.

See also: "Recovery keys" and "What locking protects".
