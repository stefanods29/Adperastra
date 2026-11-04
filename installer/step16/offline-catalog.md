# Offline pack catalog

The full offline installer may contain selected Step 12a artifacts. Its
catalog is a plain JSON file next to the installer:

```json
{
  "schema_version": 1,
  "packs": [
    {
      "id": "media-engine",
      "version": "1.0.0",
      "file_name": "media-engine-1.0.0.pack",
      "sha256": "<64 lower-case hex characters>",
      "byte_len": 123456,
      "signed": true
    }
  ]
}
```

## Rules

- At most 64 packs, unique ids, safe file names (no path separators or
  reserved characters), non-zero size at most 8 GiB.
- The installer hashes the file it actually has. `sha256` is compared with
  the catalog value only after the size matches.
- `installer_integration::verify_offline_catalog` returns one choice per
  pack:
  - `verified`: the choice may be offered;
  - `missing`: disabled with `installer.offline_missing`;
  - `hash_mismatch`: disabled with `installer.offline_hash_mismatch`;
  - `unsigned`: disabled with `installer.offline_unsigned`.
- A missing or changed artifact disables only that pack choice. There is no
  unsigned download fallback and no automatic network request.
- The online Pack manager keeps its own Step 12a signature and hash checks.
- The installer never reads the private signing directory and never copies
  model weights into an artifact.
