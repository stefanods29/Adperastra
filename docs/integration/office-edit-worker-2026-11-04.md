# Office editing worker transport follow-up

The user's priority remains usable in-app DOCX text, XLSX cell and PPTX text
editing with safe copies. No request for another configuration change or
installation is needed at this stage. The application does not yet install
an editing engine, and this follow-up does not claim that it does.

Implemented the previously unfinished `worker` entry point in the retained
OOXML preflight. Requests have explicit identities and expected revisions;
messages are bounded and contain no input/output paths. Added the native
codec to the app's compiled modules. It validates reply identity, revisions,
payload types, targets, cursors and capture sizes before any consumer can
accept a result. A regression test exposed unexpected fields being ignored
on unit commands; struct variants now reject them. Paging also retains target
identities at the same revision, under a bounded selection budget.

The retained Windows driver uses the app's actual confinement, stream reader
and native codec. The final worker binary performed list/edit/stale refusal/
undo/redo/capture/close for three disposable fixtures, refused second capture,
and refused ungranted input/output locations. Copy bytes matched references
that had already been independently reopened. Original hashes and every
unmodified package part were checked. Full evidence, artifact hash and source
inventory are in the adjacent [preflight report](../office-engine/results/ooxml-preservation/preflight.md)
and [machine-readable results](../office-engine/results/ooxml-preservation/worker-protocol-results.json).

Focused checks passed: five native codec tests, six standalone worker/session/
range tests and thirteen driver tests (including the five native codec tests).
The full project gate printed `GATE PASSED`: Rust formatting, Clippy with
warnings as errors, workspace Rust tests, translations, IPC validation,
405 UI test files / 2,241 UI tests, and the frontend type check/build passed.
The Rust test phase took 723 seconds. The full log is
`%TEMP%/adperastra-office-worker-protocol-gate.log`.
No app package or end-to-end application success is claimed by those tests.

Next work is the session adapter, frozen transaction mapping, actual layout
and selection rendering, immutable capture ownership reusable across saves,
and packaged edit/save/reopen verification. The current capture path is
exclusive and one-shot. Sensitive input has no proved memory-only path.
Keep capabilities disabled until these real paths are connected and checked.
Preserve the existing integration work and do not substitute a mock engine.
