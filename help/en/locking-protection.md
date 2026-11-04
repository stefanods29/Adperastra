# What locking protects

Understand the limits before relying on an encrypted container.

## How to use

- Keep a strong password and a separate recovery key.
- Lock when finished.
- Export an unencrypted copy only when you intend another program or location to receive it.

## Good to know

- Encryption protects stored container contents and names, not an unchanged plaintext original.
- Container and chunk sizes remain visible.
- Unlocked app memory and exported copies may be accessible to other programs on this Windows account.
- The app does not promise secure erasure on SSDs.
- A pending lock has not removed the keys. It waits until changed content has a verified encrypted recovery revision.
- Media players and Office command-line routes that need a plaintext path are refused for locked content.
- Ordinary recovery, history, clipboard, thumbnails, OCR and search indexes do not receive locked content unless that feature has an explicit memory-safe route.

See also: "Locked folders" and "Recovery keys".
