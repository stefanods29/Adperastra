# Step 09e: Locked folders (password-protected folders) (★★★★)

**Needs:** 09c. **Builds:** encrypted containers.

This step handles encryption, so it gets its own step and extra care.

## Tasks
- Right-click a folder > "Lock with password" encrypts it into a single locked container file (keeping the folder's name and a lock icon). Unlocking opens it as a virtual folder inside the app that can be browsed, opened, and edited; locking again saves the changes encrypted.
- Use well-reviewed encryption only, never custom cryptography: for example the `age` format via the `rage` crate (MIT/Apache-2.0), or 7-Zip AES-256 containers. Strong key derivation from the password (Argon2 or scrypt).
- Auto-lock after a chosen idle time and when the app closes; temporary files for opened items stay encrypted or are securely removed after use.
- Clear warnings in plain language: a forgotten password can't be recovered (offer to save a recovery key file); while a folder is unlocked, the files I open can be read by other programs on the PC.
- Locking and unlocking run as jobs with progress (Waiting-with-feedback or Background tier); a crash during locking never loses data (the original is removed only after the encrypted copy is verified).
- Have the encryption code reviewed against best practices in the step report (which library, which settings, why), and include specific tests: wrong passwords, corrupted containers, interrupted locking, and large folders.

## Help pages
Locked folders; recovery keys; what locking does and doesn't protect.

## Done when
I can lock a folder, see it as one locked file, unlock it with the password, edit a file inside, lock it again, and recover it with the recovery key; interrupted locking never loses data.
