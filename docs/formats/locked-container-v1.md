# Locked container format v1 (`.adplock`)

Status: specification for Step 09k. Schema version 1. A reader refuses every
other version with `locked.unsupported`; it never guesses a newer layout.

This format is a **standard age container around a ZIP64 envelope**. It uses
no custom cipher, KDF, stanza, MAC or key wrapping. All confidential content
is encrypted by the `age` crate at its pinned version (0.12.1, scrypt 0.11,
X25519). The ZIP layer is storage only; it is not a security boundary.

## 1. Outer ZIP64 envelope

The outer file is a ZIP64 archive with these properties:

- every entry uses `CompressionMethod::Stored` (no ZIP compression);
- no ZIP native encryption, no data descriptors and no folders;
- entry names are exactly the fixed names below or `chunks/<uuid>.age`;
- an entry count of 4 plus `chunk_count`, at most 1,000,004;
- duplicate names (exact or case-insensitive), path traversal, `..`, ADS
  colons, backslashes, leading slashes and unknown names are refused before
  any header, key slot, index or chunk is exposed.

| Entry | Plaintext? | Maximum |
|---|---|---|
| `header.json` | yes | 64 KiB |
| `keyslots/password.age` | no (age scrypt) | 1 MiB |
| `keyslots/recovery.age` | no (age X25519) | 1 MiB |
| `index.age` | no (age X25519) | 64 MiB plaintext + age framing |
| `chunks/<uuid>.age` | no (age X25519) | 8 MiB plaintext + age framing |

An entry's declared size must equal its actual size and its compressed size.
Files are opened through a pinned source handle and that handle is checked
again after each read.

## 2. Header

`header.json` is bounded UTF-8 JSON:

```json
{
  "schema_version": 1,
  "container_id": "UUID",
  "content_recipient": "age1...",
  "created_unix": 0,
  "chunk_count": 0,
  "index_cipher_sha256": "64 lower-case hex",
  "password_slot_sha256": "64 lower-case hex",
  "recovery_slot_sha256": "64 lower-case hex"
}
```

The header names no original file, no inner path, no password and no secret.
The hashes are structural integrity hints; authentication still comes from
each age file's final tag. A mismatch is `locked.changed`.

## 3. Key slots

Each slot is a separate standard age file. A single age header never mixes a
scrypt recipient with X25519 recipients.

- Password slot: one `scrypt` recipient. New slots use work factor `log_n =
  18`. A reader inspects the declared work factor before constructing the
  KDF and refuses a factor above 18 with `locked.unsupported_kdf`.
- Recovery slot: one X25519 recipient from an independently generated
  recovery identity.

Both slots encrypt the same bounded UTF-8 record:

```json
{
  "schema_version": 1,
  "container_id": "UUID",
  "content_recipient": "age1...",
  "container_secret": "AGE-SECRET-KEY-1..."
}
```

After decryption, `container_id`, `content_recipient` and the identity's
public recipient must equal the header. Normal unlock decrypts only the
selected slot. Creation verification decrypts both slots with the two still
held credentials and proves they name one identity.

## 4. Encrypted index

`index.age` decrypts to bounded UTF-8 JSON:

```json
{
  "schema_version": 1,
  "container_id": "UUID",
  "revision": 1,
  "entries": [],
  "chunk_records": []
}
```

At most 100,000 entries and 1,000,000 chunk records.

### Entry

```json
{
  "id": "UUID",
  "parent_id": "UUID or omitted for the implicit root",
  "name": "single Windows component",
  "kind": "file or folder",
  "mime": "bounded MIME, empty for folders",
  "size": 0,
  "modified_unix": 0,
  "chunks": ["UUID in content order"],
  "from_internet": false,
  "hidden": false,
  "system": false,
  "read_only": false
}
```

Entry IDs are random UUIDs, never derived from names. Names use the Windows
component rules (no control characters, `<>:"/\|?*`, trailing dot/space or
reserved device names). Sibling names are compared case-insensitively.
Parents must exist, be folders and form no cycle; depth is at most 128 and the
relative path at most 32,768 UTF-16 units. Files are at most 1 TiB; the
container aggregate is at most 4 TiB.

A file's `chunks` are unique and ordered. Their plain lengths add up exactly
to `size`. A zero-byte file has no chunks and size 0. A folder has no chunks
and size 0. Every chunk record must be referenced by at least one entry; a
shared chunk must use the identical record.

Editable entries are at most 256 MiB and may enter the shared memory model.
Larger entries remain read-only and are served by independently authenticated
ranges.

### Chunk record

```json
{
  "id": "UUID",
  "cipher_sha256": "64 lower-case hex",
  "plain_sha256": "64 lower-case hex",
  "plain_len": 1
}
```

`plain_len` is 1 to 8 MiB. Records are sorted by UUID. Before a chunk's bytes
are exposed, the reader checks the ciphertext length and hash, decrypts the
age stream to its final tag, checks the exact plaintext length and hash, and
only then returns the requested slice. A truncated final chunk never exposes
plaintext.

## 5. Reading and unlocking

1. Open the source with a pinned read handle.
2. Validate ZIP names, stored method, sizes and duplicate names.
3. Read and validate the header.
4. Read the three fixed encrypted entries with their bounds.
5. Verify the structural hashes.
6. Decrypt only the chosen key slot, then the index; validate every
   relationship and the chunk-name set before returning names.
7. Keep the pinned handle for the session. Every range read verifies the
   covered chunks and the source identity.

Wrong password, wrong recovery key and damage share the generic
`locked.bad_password_or_corrupt`. Native crypto errors are never shown.

## 6. Creation and verification

Creation enumerates the source folder explicitly without following links,
reparse points or cloud placeholders. Each accepted file is opened through a
source identity guard and read in 8 MiB chunks. Chunks are encrypted and
written to the app-owned staging output, then the index, key slots and header
are written. The ZIP is flushed and closed.

Verification reopens the staging file with a new pin, opens both key slots,
decrypts the index and every chunk, compares the exact index and re-reads
every source file to compare size and SHA-256. Only then is the output
published with a no-replace rename. A cancellation or failure disposes only
the owned staging output. The source is never moved or claimed as protected.

## 7. Pending generations and Save encrypted copy

A dirty model is persisted as a complete `.adplock` generation under
`<data>/locked-pending/<containerUUID>/<revisionUUID>.adplock`, at most 2 GiB
per generation and 4 GiB for the store. Unchanged key slot ciphertext and
unchanged chunk ciphertext are copied; edited entries are re-encrypted to the
container recipient. The generation is independently verified before it is
listed as recovery.

`Save encrypted copy…` publishes a verified generation to a user-chosen new
path without replacing anything and without rebinding the live session or
marking the original model clean. The original container's bytes and hash are
unchanged.

## 8. Recovery file

`.adprecovery` is a bounded UTF-8 JSON file:

```json
{
  "schema_version": 1,
  "container_id": "UUID",
  "recovery_secret": "AGE-SECRET-KEY-1...",
  "recovery_recipient": "age1..."
}
```

It is a plaintext secret by design and the UI says so. The app never stores it
beside the container automatically.

## 9. Limits and refusals

| Limit | Value |
|---|---|
| Header | 64 KiB |
| Index plaintext | 64 MiB |
| Chunk plaintext | 8 MiB |
| Chunk ciphertext | 9 MiB |
| Entries | 100,000 |
| Chunks | 1,000,000 |
| Outer entries | 1,000,004 |
| File | 1 TiB |
| Container aggregate | 4 TiB |
| Editable entry | 256 MiB |
| Open entry memory | 256 MiB |
| Global open memory | 1 GiB |
| Pending generation | 2 GiB |
| Pending store | 4 GiB |
| Recovery revisions listed | 32 |
| Password | 12 Unicode scalars to 1,024 UTF-8 bytes |
| scrypt work factor | 18 (maximum accepted 18) |

No original name, password, recovery secret or plaintext chunk is written to
a temporary file, cache, log, report, clipboard, history, thumbnail, OCR
index or ordinary recovery store.
