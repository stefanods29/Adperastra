# Targeted Office edit preservation probe

2026-11-04. This disposable experiment separates editing a small part of an
Office file from rendering it. A coordinator-only Python standard-library
probe applied one exact, fixture-specific edit to each archive. It wrote
new copies and verified archive integrity, parsed the changed XML, compared
all uncompressed entries byte for byte, and rehashed the original files.
Reversing the exact edit recovered the original bytes of the changed entry.

- **Word.** Changed one text run in `word/document.xml`. All 17 other
  entries remained identical, including the custom XML payload and its
  relationship. The edited copy's SHA-256 was
  `5ce9e29de2cac9a65d50ada975aa28c32a34431f875cb4ad31c69c5b8264b508`.
- **Excel.** Changed A1 to the literal string `000456` in
  `xl/worksheets/sheet1.xml`. All 16 other entries remained identical.
  The rest of the worksheet, including the cached formula and validation
  rule, also remained identical. The edited copy's SHA-256 was
  `55af2adaabe2f143d07ba4c7da5c5bd3c5e1d346ce4635fb393df4128b3661de`.
- **PowerPoint.** Changed one title run in `ppt/slides/slide1.xml`.
  All 47 other entries remained identical, including the other slides,
  master parts and picture. The edited copy's SHA-256 was
  `659924ae0f9916d1e8ad3574447651ca5df0dbb3ae260c064d71a111ea5d8faa`.

The isolated LibreOfficeKit 0.1.3 worker reopened each copy and generated
PDFs of one, two and three pages respectively. Extracted text from those
PDFs contained the edited Word text, the Excel value with its leading zeros
and the edited slide title. The original source hashes matched the prior
fixtures and remained unchanged.

This supports evaluating a limited editor that applies typed changes to
Office Open XML and uses LibreOffice for display. The probe did not accept
arbitrary files or edits. It establishes neither general Office preservation
nor editor readiness. Before recommending a binding, test selecting edits
unambiguously, refusing protected and signed documents, handling malformed
packages, and exercising the project's save and undo contracts. Run the
full comparison and record the Step 20a checkpoint before activation.

The follow-up Rust prototype is outside the application at
`%LOCALAPPDATA%/Adperastra-provisioning/ooxml-editor-probe`. It uses the
already locked `zip` 9.1.3 and `roxmltree` 0.21.2. It selects a
namespace-checked text run or an existing literal cell, applies a bounded
change, and copies the other entries using the ZIP library's raw-copy API.
The separate output is created exclusively after input checks. This is
experimental code with no application capability or new app dependency.

On the same three fixtures, byte comparisons again found exactly one
changed part in each output, and all originals retained their hashes.
LibreOffice rendered all three outputs and PDF text extraction confirmed
the edited values, including the escaped ampersand and Excel leading zeros.
The same prototype refused a protected sheet, a package with a signature
entry, and a formula-cell target. None of these three refusals created a
destination file. A follow-up check refused a signature-origin relationship
pointing outside the conventional signature directory, and exclusive output
creation rejected an existing destination without changing its bytes.
The separate Rust prototype now wraps the archive mutation in a revisioned
session with bounded undo and redo. For each of the three fixtures, its
exercise rejects stale revisions and a malformed target without changing
the current snapshot, restores exact original and edited bytes via undo and
redo, and clears redo when a new edit branches from undo. It captures the
first edited revision before making further changes. The later publication
of that frozen revision produced files whose SHA-256 hashes matched the
independently reopened single-edit copies for all three formats.

Stable UI selection IDs, application session wiring and owned-output
publication are still required. The prototype uses full archive snapshots,
limited to three history entries and 16 MiB per archive. These limits are
for the experiment and do not establish application memory acceptance. Its
CLI must not be installed as the editing binding.

The prototype now resolves worksheet and slide selections from the workbook
or presentation manifest and its internal relationships. Two test packages
reordered their visible sections without renaming any parts. Selecting the
first section changed only `xl/worksheets/sheet2.xml` in the workbook and
`ppt/slides/slide3.xml` in the presentation. The edited text appeared on
page one of each reopened PDF and nowhere else. Source hashes were
unchanged. A duplicate relationship ID and an external relationship
each failed before creating an output file.

The text probe can also address a UTF-16 subrange of an eligible literal
run. It refuses boundaries inside an emoji and refuses partial edits of
entity-encoded runs whose raw offsets are not mapped. A DOCX subrange
copy changed only the selected bytes of its text run, retained every
other archive entry byte for byte and reopened in the isolated renderer.
This is still test-session index selection. The live binding must issue
and validate revision-scoped block and section identities.

The prototype now issues opaque UUIDs for resolved selections. A selection
belongs to the session that issued it and expires on edit, undo or redo.
The mutation entry accepts the UUID and expected revision. It does not accept
an archive part from the caller. Tests used two simultaneous sessions with
the same file and revision and refused both cross-session directions.
An old selection was also rejected after edit and after undo, even when
the caller supplied the current revision. A failed edit retained the exact
current snapshot.

Five fresh process runs each on Word, reordered Excel and reordered
PowerPoint reproduced the saved bytes of the previously reopened copies
and left source hashes unchanged. End-to-end times for the small local
fixtures, including process startup, two sessions, edit/history exercises
and writing the copy, were Word 384/19/17/19/20 ms, Excel 13/13/16/13/13 ms,
and PowerPoint 18/19/25/19/18 ms. Filesystem cache state was uncontrolled.
This does not qualify app startup, peak memory or engine warm-session
performance.

Prototype source SHA-256 for this run, in file order:

- `src/main.rs`: `6329ab9e083d33859241e22c9b38ea9be3a2ea59ba099b72d178a6428651e832`
- `src/parts.rs`: `e287d3436089bd53b75e56ea4bdf89831bc2e1a8036f7c8b13d065c368dfb638`
- `src/session.rs`: `efdfa8912922d563642b0860286fe508b0aec0dd53c53a5ab33e2e82df1e3538`
- Debug executable: `fd1dcf6d3459daa8545a0c90fba6a2563a19840080ea571531fa8e7ed5e1a832`

The next prototype iteration can enumerate a bounded page of eligible
text runs and existing worksheet cells, returning their current values and
session-owned selection IDs. The editor checks the same run and cell
eligibility when applying an edit. A fresh listing invalidates the prior
page's IDs in this prototype. Using listed targets, the DOCX text edit,
reordered XLSX cell edit and reordered PPTX title edit all reproduced the
previously reopened copies exactly, and their source hashes were unchanged.
The formula cell A3 was absent from the selectable results and no output
was created for it.

The above source hashes identify the preceding selection-ownership test
run. The newer listing code also contains `src/targets.rs`.
The app binding still needs to map visible controls and the frozen Office
transaction types to these identities. A listing by itself is not proof
that the entire package is writable. The mutation validates package
protection and signatures again before changing the session.

The workbook probe now distinguishes literal text, finite numbers, booleans
and clearing an existing cell. Independent reopening with ExcelJS verified
`000456` remained a string, `42.5` was numeric, `true` was boolean, and
the cleared cell read as blank. In each output only the targeted sheet part
changed. The unrelated formula, cached result, validation rule and other
sheet were verified after reopening. The original source hash was unchanged.
The probe rejected NaN, a formula cell, a merged cell and a validation-covered
cell before creating a destination. Date and formula input, creation of
missing cells, extended validation variants and recalculation require
separate evidence. These are prototype checks outside Adperastra.

The Rust prototype now applies a bounded batch on a private candidate before
advancing its live revision. In the Word, Excel and PowerPoint fixtures, a
batch with a valid first edit and an invalid second target left the live
snapshot and undo history untouched. Cancellation after the last candidate
edit also left both untouched. The successful two-target batch used one
revision and one undo entry, and redo restored the exact edited bytes.
Reopening in LibreOffice showed both edits in each file, and byte comparisons
found only the intended document, worksheet or slide part changed. Original
hashes were unchanged.

The prototype rejects overlapping operations in one run or cell. The future
binding still needs to combine a same-range delete/insert pair from the
PowerPoint editor into one range replacement before invoking this batch.
This experiment does not establish the performance of large transactions.

A Word review fixture combined an existing custom XML part with a comment,
tracked insertion/deletion and a complex field. Editing a normal run changed
only that run's bytes. The comment part, relationships, field and review
markup were byte-identical, and the copy reopened in the isolated renderer.
The tracked insertion and field result were excluded from the target list
and both direct edit attempts failed before creating a destination.
Source SHA-256 was `77c621ca681c1ed9b1918fb03bad513add303b38c70bce30d20e9b29157dad0d`
and copy SHA-256 was `ebba92de6c9271bd66d19d89011c4883cb07f6c1912c978e70f4213742ccf0f5`.

The reviewed prototype source and dependency lock are now retained in
`tools/office-edit-preflight`, a standalone tool outside the app workspace.
The exact debug executable tested under Windows had SHA-256
`7bf35327592ac9669e4dfbb3f524e23a55a50a95c88d1e79c04a2bdeecc71dc3`.
It used the app's AppContainer launcher, a 256 MiB job memory limit, a
10-second deadline, a read-only executable folder and one private working
folder. Valid Word, Excel and PowerPoint operations completed in 563, 47
and 85 ms respectively. Each output matched the independently reopened
copy byte for byte and each original retained its hash.

Two additional launches per format attempted to read a file in an ungranted
folder or write the output there. All six attempts returned Windows error
5 and produced no output. This covers the tested filesystem boundary.
At that point the harness still needed a bounded typed worker protocol and a
production session binding. A fresh-process timing sample is not peak-memory
or warm-session evidence.

## Bounded worker protocol and native codec, 2026-11-04

The retained tool now has a separate newline JSON worker mode. Its source and
the actual native codec are inventoried in [worker-protocol-results.json](worker-protocol-results.json).
The tested worker executable SHA-256 is
`abaa42e052a8b850b6265bde7daaf14511f241e6b58975fdd63a3557b6a02cd5`.
No document or capture path is accepted in a message. The launch fixes both
private paths. Frames are at most 64 KiB; IDs are fresh UUIDs; commands carry
an expected revision; requests are capped at 10,000 per worker. A list reply
contains one eligible run/cell plus a forward cursor so worst-case JSON text
escaping stays below the application's line-reader bound.

Unlike the preceding listing prototype, paging now retains issued target
identities until a successful mutation, undo or redo. Repeating a page at the
same revision returns the same IDs. The retained-selection limit is 256 and
an admission failure does not partially replace the selection table.

The native codec rejects mismatched reply IDs, revision jumps, unexpected
payloads/fields, invalid cell addresses, non-forward cursors, empty/oversized
capture sizes, duplicate edit targets and invalid values. A test caught
Serde's treatment of unknown fields on unit command variants; empty struct
variants now reject those fields. Malformed/truncated/oversized input closes
the worker without accepting a request. Errors contain stable codes.

Executed checks: six standalone worker/range/session tests; five native app
codec tests; thirteen driver tests, which include those same five codec tests
and eight existing launcher/stream/argument tests. The driver is retained in
`tools/office-edit-preflight/windows/confined_protocol.rs` and includes the
application's actual confinement, bounded stream reader and native codec.

Three Windows AppContainer runs listed an eligible target, edited it, refused
an old-revision edit, undid/redid, captured and closed. The DOCX, XLSX and PPTX
outputs exactly matched the previously independently reopened reference
copies. Only `word/document.xml`, `xl/worksheets/sheet1.xml` and
`ppt/slides/slide1.xml`, respectively, differed from the original packages.
All original hashes were unchanged. A second capture refused to overwrite
the first. Six additional launches refused ungranted reads/writes, producing
no foreign output. The policy allowed no network capabilities; a network
probe was not performed. One parallel lifecycle sample per family during
project checks was 700/694/692 ms; these are not warm-edit benchmarks.

Remaining integration: selected-engine registration, the native session
adapter, mapping frozen transactions to worker targets, rendering/layout,
reusable immutable capture ownership, cancellation/death recovery and a
packaged in-app edit/save/reopen check. Capture is currently exclusive and
one-shot per worker. Sensitive input has no proved memory-only route. The
tool and codec do not activate an app engine, signed pack, editing capability
or source replacement. T4/D3 and full fidelity/performance acceptance remain
open. No user installation/configuration action is needed for this work.
