# Recovery keys

Keep another way to decrypt your container if you forget its password.

## How to use

1. Save the recovery key when creating the encrypted copy. It is a separate `.adprecovery` file.
2. Store that file separately and back it up securely. Do not keep the only copy inside the container.
3. To recover access, choose the recovery-key option while unlocking and select the key file.

## Good to know

- Anyone holding the recovery secret can decrypt the container.
- The app cannot restore a lost password without a matching recovery key.
- The recovery file is plain text JSON with a secret key; it is not encrypted by the app.
- A recovery key belongs to one container. A key from another container is refused.

See also: "Locked folders" and "What locking protects".
