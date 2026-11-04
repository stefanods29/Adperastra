# Limited OOXML fallback selection

The owner delegated implementation choices ("I totally approve your decisions
now"), authorized installations, and repeatedly requested continued in-app
editing after the measured limitations were reported. The coordinator selects
the plan's basic-editor fallback for DOCX text, XLSX existing literal cells and
PPTX text under that delegation. This does not approve full Office parity or
release acceptance.

The first-party implementation is the retained `ooxml-editor-probe` 0.1.0
library at `tools/office-edit-preflight`, under Adperastra's MIT license.
Its range-preservation and Windows evidence and exact source/artifact hashes
are in `results/ooxml-preservation/`. The checkout is on
`codex/integrate-handoffs`, based on `fcb3fee`; this integration is not committed
or tagged. Changed worker source needs updated evidence before qualification.

The app links this first-party code and runs its own fixed helper flag inside
the existing Windows AppContainer. It is not an unsigned external Office
pack. Third-party Office rendering/conversion keeps the verified pack route;
no pack signature or trust check is changed. Dependencies are admitted
roxmltree 0.21.2, zip 9.1.3, serde 1.0.229, serde_json 1.0.154 and uuid 1.29.0,
with MIT/Apache-compatible licenses. No LGPL runtime is linked by this route.

Integration files are `office_ooxml_worker.rs`, `office_ooxml_binding.rs`,
`office_ooxml_operations.rs`, `office_edit_basic.rs` in `src-tauri/src`, and
the basic surface/service in `src/office` and `src/services`. Keep the shared
OfficeController and existing immutable snapshot/Save a Copy publication.
The first version has a clearly labelled basic text/cell surface. Unsupported
structures are preserved-only. Source replacement, new cells, formulas,
advanced formatting and sensitive editing remain disabled until proved.

Bounded memory snapshot messages permit repeated captures without granting
shared output-file authority. Capabilities remain off until the actual
helper/transaction/capture path passes checks. The actual application binding
now passes native DOCX/XLSX/PPTX transaction/capture/undo/redo/discard and copy
checks on disposable fixtures; live Word editing and Save a Copy also passed.
The XLSX follow-up reuses the existing virtualized SheetEditor rather than
showing cells as text cards. It reads real sheet names, dense bounded windows,
existing literal values, cached formula results and basic fonts/fills/alignment.
Blank insertion, formula recalculation, merged-cell geometry, row/column sizes,
theme colors and full numeric/date formatting are not implemented by this
worker. No original-layout parity claim follows from the grid.
Layout, peak memory, cold/warm
performance, packaged interaction and the complete hostile corpus remain
acceptance work; this limited selection does not complete Step 20a.
