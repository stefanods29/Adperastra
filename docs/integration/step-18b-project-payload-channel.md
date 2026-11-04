# Step 18b project payload channel (handoff, 2026-11-19)

Micro-task: close the H09 gap where `image_project_open_start` returned only
descriptors, so `assembleImageProjectModel` had no native payload source.

## Native boundary

Three additive commands, registered in `tauri::generate_handler!`, the
isolation allowlist and Tauri state:

- `image_project_payload_start(request_id, input)`: shared job. It reads the
  same `ConversionInput` through the pinned file reader or the 08a
  `ExportSnapshots::resolve` lease, calls `image_edit::project::decode_project`
  and returns:
  - the canonical `ImageProjectManifest` (validated, no ZIP bytes),
  - `entries`: ordered `{ kind: "rgba" | "alpha" | "metadata" | "extension",
    name, byte_len }`. Tiles are in manifest order and include the
    `original_tile_ids` RGBA bytes; masks are alpha8,
  - an opaque UUID `handle`, `total_bytes` and `page_bytes`,
  - `source_snapshot` only for a snapshot input, with `source` (the path
    bearing stamp) removed.
- `image_project_payload_page(handle, offset, max_bytes)`: raw
  `tauri::ipc::Response`, at most 1 MiB per reply. The TypeScript side reads
  `total_bytes` by 1 MiB pages and validates every page length.
- `image_project_payload_release(handle)`: idempotent session drop.

Caps fail closed with `image_project.too_large`:

- per page: 1 MiB (`MAX_PROJECT_PAYLOAD_PAGE_BYTES`),
- per project: `MAX_PROJECT_PAYLOAD_BYTES` = 512 MiB tiles + 16 MiB metadata
  + 16 MiB extensions,
- aggregate live sessions: 1 GiB, at most 4 sessions, 300 s idle TTL checked
  on the next payload open/page/release.
- Non-editable projects (required extension or newer schema) refuse before a
  session is created.

## Sensitivity and leases

- A snapshot input holds its 08a `SnapshotLease` for the whole session; the
  session is dropped on release or TTL, never written to disk or a cache.
- Decoded payload buffers and the archive read buffer use `Zeroizing<Vec<u8>>`.
- No path, grant, upload token or raw ZIP is returned. Manifest `path` fields
  are the guarded entry names and are revalidated in TypeScript.
- File inputs carry no native source snapshot; the caller must supply the
  capture it already made. The project controller now captures the document
  first and opens that snapshot, so the normal path is snapshot-backed.

## TypeScript wiring

- `src/services/imageProjects.ts` exports `resolveImageProjectPayloads`, the
  registered payload source. It revalidates the native manifest and layout,
  requires the exact source snapshot identity, reads all pages, and splits the
  bytes into tile, metadata and optional-extension maps with the manifest's
  exact names.
- `src/image-edit/projectImport.ts` registers it in
  `installImageProjectImporter`; `importImageProject`, `decodeImageProject`
  and the extension loader accept the optional source snapshot for file
  inputs.
- `assembleImageProjectModel` is now reachable from the real open path.

## Remaining gaps

`ImageDocument.ts` constructs `ImageControllerImpl` privately and exposes no
public binding for a prebuilt `ImageModel`. `openImageProjectDocument`
therefore assembles the model, disposes the published tile/metadata stores,
forgets remembered extensions, releases the captured snapshot and still
refuses with `image_project.failed`. Closing that gap needs an additive public
controller/binding factory in `ImageDocument.ts` (owned by the shared editor
layer), not a change in this micro-task.

The guarded ZIP/zstd decode still runs in the shared job thread rather than a
separate isolated helper, as it already did in `image_project_open_start`.
That pre-existing R-SEC-9 helper gap is unchanged here.

## Verification state

No build, type check, test, formatter, generator, install, commit or remote
operation was run for this micro-task. The Rust unit tests cover page slicing
across blobs, page caps and the per-project payload cap only.
