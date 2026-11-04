# Coding assignment: step 09c — Dragging between tabs, content between tabs, opening files from Windows

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09c.md](../steps/step-09c.md). Guide SHA-256: `10e4cd0605534816faf1e9a4bc04ed6da6cf824e9a325738bca8f1f6db7d6c8f`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09c-tab-transfer |
| Tag | v0.1.3-step09c |
| Depends on | 09a tabs-documents-1;09b tab-groups-1;03b file transfer |
| Written before | 07a was built |
| Interface revision | content-transfer-1; activation-1 |

Settings reservation: 20 -> 21; screenshot reservations: 95-96. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| ID | Producer/task; canonical export | Exact consumption |
|---|---|---|
| U1 | 09a T2/E3/E4 `src/documents/types.ts`, DocumentRegistry | DocumentHandle id/source/info/getState/captureSnapshot, one09a controller binding owns the mutable edit model; document revision and sensitive policy remain authoritative |
| U2 | 08a T3/E4/E5 `src/services/exportSnapshots.ts`, native ExportSnapshots | ExportSnapshot snapshot_id/document_id/revision/mime/byte_len/source/storage_policy; hold native lease through insertion; release once. No current-source reread |
| U3 | 09a T3/E1/E2 and09b T2/E1/E2 | TabsState and exact group reducers; activation/reordering and group assignment are separate transactions from file copy |
| U4 | 03b `src/services/fileops.ts` transfer wrappers, existing drag service | Reuse conflict policy merge/skip/keepBoth, OpProgress/OpReport, main-window target validation. No Replace capability inferred |
| U5 | 04a `src/handlers/openPipeline.ts`: planOpen(path,registry,openWith)->Promise<OpenDecision> | All Windows/bar/group file opens and activation paths follow this decision, not direct handler invocation |
| U6 | 06a unsaved coordinator,09a TabHistory, existing command/ribbon registries | Mutation/close decisions await completion; duplicate views share document, each has independent selection |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task/commit | Exact owned files and work; dependencies | Required tests and oracle |
|---|---|---|
| T1 `feat(transfer): bounded content payload contracts [step-09c/T1]` | transfer/types.ts,transferValidation.ts;transfer_types.rs,transfer_validation.rs. U1/U2; all DTO/limits; secret policy comes from native source | transferValidation.test.ts: `refuses_html_and_unknown_action`; `rejects_nonfinite_cells`; `snapshot_revision_is_immutable`; native `sensitive_cannot_be_downgraded` |
| T2 `feat(transfer): leased content registry [step-09c/T2]` | contentTransfer.ts,content_transfer.rs,transfer_leases.rs. U1/U2; TTL/aggregate budgets/cancel | `thirty_third_lease_refused`; `expired_token_rejected`; `last_release_drops_snapshot`; `cancel_keeps_source_and_target_unchanged`; native forgedtoken denied |
| T3 `feat(transfer): target negotiation and atomic insertion [step-09c/T3]` | TransferRegistry.ts,TransferChoiceDialog.tsx,useContentPaste.ts,styles/transfer.css. U1/U6/E1; static text/PDF viewer copy adapters, mutation onlyexistingtexteditor whereproven | transferRegistry.test.ts: readonly noactions; ambiguity asks; revisionchangefailswithoutedit; supportedrichpaste oneUndo/oneRevision; disposer cancels pendingaccept |
| T4 `feat(tabs): hover activation and typed drop routing [step-09c/T4]` | useTabDropTarget.ts,tabDropRouting.ts; coordinator TabStrip/groups/folders/shared schema21. U3/U4/U5 | tabDrop.test.tsx:599ms noactivate/600ms activate;leavecancel;barplanOpen;groupmembership;folderdelegatesfileops; malformedMIMEneverauthorizespath |
| T5 `feat(shell): user-scoped single instance activation [step-09c/T5]` | activation.rs,activation_pipe.rs,activation_security.rs,activation.ts; coordinator entrydispatch/eventwiring. U5 | native activation_tests: wrongSID/remote denied;768KiB+1 rejected;17thqueuedbusy;helperflagrejected;sameUUIDhandledonce;initialrequestbeforeUIreadyretained |
| T6 `docs(help): cross-tab content and Windows opening [step-09c/T6]` | sixhelppagesbelow; coordinator translations/commandhelp/measurements/shots. U1-U6 | bilingualkeys/help;copyintextinputunchanged;pendingclosedtargetnotcalled; usersensitivewarningrequired |

Tests go in `src/__tests__/{transferValidation,contentTransfer,transferRegistry,tabDrop,activation}.test.ts(x)` and native module tests; helper/read-path safety also requires coordinator-run integration fixtures, not mocks alone. No synthetic success stub for editors arriving later; they register E2 when implemented.

## Coordinator commit labels (workers do not commit)

- feat(transfer): bounded content payload contracts [step-09c/T1]
- feat(transfer): leased content registry [step-09c/T2]
- feat(transfer): target negotiation and atomic insertion [step-09c/T3]
- feat(tabs): hover activation and typed drop routing [step-09c/T4]
- feat(shell): user-scoped single instance activation [step-09c/T5]
- docs(help): cross-tab content and Windows opening [step-09c/T6]

## Required handoff

Return `handoff/step-09c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
