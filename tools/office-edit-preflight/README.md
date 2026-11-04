# Office editing preflight

This standalone coordinator probe is outside the app's Cargo workspace.
It edits disposable DOCX, XLSX and PPTX copies and exercises revision-bound
selections, undo, redo and frozen capture. The single-edit command line is a
fixture harness. A separate `worker` mode implements bounded private messages;
neither mode is installed as the app's editing engine.

Run the range tests with `cargo test --locked --manifest-path tools/office-edit-preflight/Cargo.toml`.
On Windows, use the project's temporary target folder convention.

The single-edit harness takes source file, new destination, zero-based
section index, target, and replacement text. The target can be
`listed:<exact visible text>` for Word or PowerPoint and
`listed:<cell address>` for Excel. A new destination is required.
Use a disposable copy for the source as well.

The [preservation report](../../docs/office-engine/results/ooxml-preservation/preflight.md)
records tested operations, rejection cases, and the Windows confinement
results. The probe has no application command, pack activation or signed
engine identity. Step 20a requires a separate selection and integration
record before enabling editing.

## Worker transport

`ooxml-editor-probe worker <private-input> <private-capture-output>` fixes both
paths before parsing requests. The output must not exist. Standard input and
output carry one JSON object per newline, at most 64 KiB including the newline.
The worker accepts at most 10,000 requests and does not log document text.
Each request has a fresh UUID `request_id`, an `expected_revision` and a tagged
`command`. Commands are `list`, `edit`, `undo`, `redo`, `capture` and `close`.
List takes a zero-based `section_index` and raw `start` cursor. It returns one
eligible run/cell and the next cursor, avoiding oversized escaped-text replies.
Edit takes 1–16 operations with selection UUID and a typed text/number/boolean/
blank value. A successful edit/undo/redo advances exactly one revision.
Failed operations leave the revision unchanged. Capture is exclusive and
one-shot per worker; repeated capture refuses to replace the private output.

The native codec in `src-tauri/src/office_edit_worker_protocol.rs` verifies
reply identity, exact revision transitions, operation-specific payloads,
forward cursors, cell addresses and capture sizes. It never accepts a path
from a worker reply. It does not itself launch a worker or enable editing.

## Windows confinement check

Build the retained driver with `cargo build --locked --manifest-path
tools/office-edit-preflight/Cargo.toml --features windows-preflight` using a
temporary `CARGO_TARGET_DIR`. Run `confined-office-protocol.exe` with four
separate arguments: worker executable, disposable fixture, exact target label
and replacement text. The worker executable must be in its own dedicated
directory: the driver grants read/execute access to that directory.

The driver includes the app's actual AppContainer launcher, stream reader
and native codec. It copies the fixture into an owned working folder, checks
list/edit/stale edit/undo/redo/capture/close and refuses a second capture.
Separate launches must fail to read an ungranted sibling or write there.
Its small engine-type definitions are linkage stubs, not an alternate
confinement implementation. The unused binary-frame stub must never run.
