# Coding assignment: step 20a — Office editing: engine spikes and integration

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-20a.md](../steps/step-20a.md). Guide SHA-256: `d9df8d520ae431f7f23e889a811b1d5403402c1cbc3a33af83bdb48625af32ce`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started; engine binding requires OWNER CHECKPOINT |
| Difficulty | 5/5 |
| Branch | step-20a-office-edit-engine |
| Reserved tag | v0.5.5-step20a; no tag is created while writing guides |
| Depends on | 13 read-only Office viewing; 09a documents; 09c transfer; 08a snapshots; 09f approved writes; 09h recovery; 12a packs |
| Written before | 07a was built |
| Contract revision | office-edit-1 |

Settings reservation: 49 -> 50; screenshot reservations: 184-185. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 12a producer guide](../steps/step-12a.md)
- [Step 13 producer guide](../steps/step-13.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer and canonical definition | Exact consumption and lifetime |
|---|---|---|
| U1 | 09a E3/E4, `src/documents/DocumentRegistry.ts`, `src/documents/types.ts` | DocumentHandle id/source/info/getState/subscribe/readRange/captureSnapshot/save/saveCopy/discard/release. DocumentState revision/saved_revision/content_id/saved_content_id/dirty/editing_enabled/sensitive policy; original-byte reads are not encoded current edits. One registered controller owns edited state. |
| U2 | 08a E4/E5, `src/services/exportSnapshots.ts`, native ExportSnapshots | ExportSnapshot snapshot_id/document_id/revision/content_id/mime/byte_len/source/storage_policy; immutable capture, leases, bounded raw transport and idempotent release. Native classification is authoritative. |
| U3 | 13 E1-E6, `src/services/officeView.ts` | OfficeFormat, OfficeSession/OfficePage/OfficeSection and openOfficeView/officeViewPage/officeViewSections/officeViewComments/closeOfficeView; read-only fallback. No mutation endpoint is borrowed from the viewer. |
| U4 | 09c E1/E2, `src/transfer/types.ts`, TransferRegistry | TransferPayload/TransferEnvelope/TransferTarget/TransferAction/TransferReceipt. Atomic insertion, immutable source revision, sensitive policy and supported-loss disclosure; formula payload cells remain inert text in content-transfer-1. |
| U5 | 06b versions plus 09f approved-write contract | Version hook before every existing-content save; approved target identity and original source stamp are checked separately from the logical edited revision. Engine never calls a path-based overwrite itself. |
| U6 | 09h E1/E3 services/recovery.ts saveRecoverySnapshot and documents/useRecoveryCapture.ts;12a T3/E2 native Packs.acquire/PackLease.entrypoint | saveRecoverySnapshot(snapshot:ExportSnapshot,metadata:RecoveryMetadata)->Promise<JobHandle<{record_id:string,captured_revision:number}>>; useRecoveryCapture(document:DocumentHandle,options{enabled:boolean,interval_seconds:number},onWarning(code)->void)->void, owned once/document. Packs.acquire(id:PackId,capability:&str)->Result<PackLease,String>; PackLease.entrypoint(capability:&str)->Result<PathBuf,String>. Hold lease for the complete editing session. Ordinary snapshots use09h DPAPI storage; sensitive input never uses it. No duplicate recovery/downloader. |
| U7 | Baseline `src/services/jobs.ts`; `src/commands/registry.ts`; `src/ribbon/types.ts` | runJob<T> -> Promise<JobHandle<T>>, completion carries result; CommandRegistry<C>/Command<C>, RibbonDef/RibbonTab/RibbonGroup/RibbonControl. Existing movable docking and keyboard scope remain authoritative. |

The producer guides must expose the exact U1 controller-registration, U5 publication and U6 recovery/pack signatures before this guide is dispatched. Those are coordinator-owned integration boundaries; workers do not invent substitute APIs or edit another stream's shared files.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Owned files and ordered algorithm; uses | Tests to write, exact oracle |
|---|---|---|
| T1; `feat(office): freeze engine-neutral editing contracts [step-20a/T1]` | Create all E1/value/operation modules and native mirrors/validators. Validate tags/patches/positions/caps; re-export only canonical types. U1/U2/U3/U4. | officeContracts.test.ts: `unknown_operation_rejected`, `nan_size_rejected`, `stale_span_rejected`, `max_sheet_cell_is_valid` row1048575/col16383 valid and +1 invalid; wire roundtrip exact snake_case. |
| T2; `feat(office): atomic session and controller lifecycle [step-20a/T2]` | OfficeController.ts,officeEdit.ts,office_edit.rs,office_edit_sessions.rs,office_edit_transactions.rs. U1/U2/U7; idempotency, refcounts, capability gates and absence of approved binding fail explicitly. | officeController.test.ts: two views one session; duplicate identical transaction one mutation; reused ID different payload invalid; close one view retains edits; failed operation leaves history/selection/revision unchanged; save captured1 whileedit2 remainsdirty. |
| T3; `docs(office): prepare engine comparison protocol [step-20a/T3]` | Create docs/office-engine/comparison-protocol.md and corpus-manifest format, not executable prototypes. Fixed candidates D2; report matrix fidelity/speed/RAM/disk/license/UI control/security/preservation/Windows install and reproducible build. U3/U6. | Written reviewer checks require no remote document service, no unverified license claim, exact distribution version/hash and separate source/notices per bundled component; candidate lacking supported Windows route marked infeasible. |
| T4; `docs(office): measured engine recommendation and owner checkpoint [step-20a/T4]` | Coordinator alone writes/runs throwaway spikes outside app and records docs/office-engine/results/<candidate>/<version>/ with corpus hashes, rendered diffs, cold/warm5runs,peakmemory,licenseinventory,commandmapping and source-unchanged hashes. No coding worker runs them. | Candidate must preserve comments/revisions/styles/formulas/charts/pivots/masters/animations/unknownparts or report inability; counters from real execution only. OWNER CHECKPOINT: record owner's selection or fallback before T5; continue unrelated work while waiting. |
| T5; `feat(office): integrate approved isolated engine binding [step-20a/T5]` | Create office_edit_binding.rs and approved-specific submodules named in the post-checkpoint approval record; coordinator dependency/pack/helper/manifest changes. Implement E10, D4-D9, no engine toolbar or raw engine command escape. U5/U6. | Native integration: process timeout/death keeps source; no macro/network/linkedfile execution; pack lease survives attempted uninstall; sensitive unsupported returns before plaintextfile; outputbounds;approvedversionmismatch refuses. |
| T6; `feat(office): rendering formatting and item services [step-20a/T6]` | OfficeViewport.tsx,officeFormatting.ts,office_edit_render.rs,office_edit_items.rs,office_edit_formula.rs. U3/U7; E4/E6/E7, stale suppression and accessible tile surface. | stale view render ignored/released; typed formatting mixed vsfalse; selection from another session rejected; =SUMA(1;2) parses =SUM(1,2), quoted"SUMA;"unchanged; formulas/noexternalnetwork; missingengine disabled. |
| T7; `feat(office): immutable capture and safe save integration [step-20a/T7]` | officeCapture.ts,office_edit_capture.rs,officeCompatibility.ts,src/services/officeDrafts.ts,src-tauri/src/office_drafts.rs,src-tauri/src/office_edit_leases.rs; coordinator U1/U5/U6 bindings/schema50/settings. Capture current encoded revision, preservation proof, outputlimits, recovery and newcopy; do not clear newer edits. | source untouched oncapture; lostunknownrelationship failspreservation beforepublication; versionhookfailure0sourcewrites; wrongsnapshotdocument refused; snapshotimmutableafterlateredit; no sensitiveplaintextrecovery; office_lease_wrong_session_refused (session B cannot resolve session A lease); office_lease_revoked_lookup_refused; office_lease_retained_reader_survives_release (active Arc remains until reader completes); office_lease_sensitive_disk_refused.  |
| T8; `docs(help): Office editing and compatibility [step-20a/T8]` | Full bilingual help below; coordinator texts/pseudo/packsettings/helpregistrations/measures/shots. | officeHelp.test.ts: all error/help keys; command gating; maxviewport/keyboard; schema49->50 retainsprevioussettings; no AI/dictation controls. |

Native tests live beside boundary modules; pure validators in `crates/office-edit-contracts/tests/step20a_*_tests.rs` if coordinator extracts the shared pure crate in T1, with that exact crate path recorded before dispatch. Default choice is native module tests, no unrequested new crate. UI test files `src/__tests__/{officeContracts,officeController,officeFormatting,officeCapture,officeHelp}.test.ts(x)`. All unit tests are written by workers, run by coordinator.

## Coordinator commit labels (workers do not commit)

- feat(office): freeze engine-neutral editing contracts [step-20a/T1]
- feat(office): atomic session and controller lifecycle [step-20a/T2]
- docs(office): prepare engine comparison protocol [step-20a/T3]
- docs(office): measured engine recommendation and owner checkpoint [step-20a/T4]
- feat(office): integrate approved isolated engine binding [step-20a/T5]
- feat(office): rendering formatting and item services [step-20a/T6]
- feat(office): immutable capture and safe save integration [step-20a/T7]
- docs(help): Office editing and compatibility [step-20a/T8]

## Required handoff

Return `handoff/step-20a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-20a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
