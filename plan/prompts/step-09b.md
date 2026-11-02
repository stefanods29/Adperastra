# Coding assignment: step 09b — Tab groups and saved groups

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09b.md](../steps/step-09b.md). Guide SHA-256: `516ac51a98b2d09dfa0b7dab3c74e412007d0d80e0f965f618b71e791454a5d7`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-09b-tab-groups |
| Tag | v0.1.2-step09b |
| Depends on | 09a T1-T7, contract tabs-documents-1/session-2 |
| Written before | 07a was built |
| Interface revision | tab-groups-1; saved-groups-1 |

Settings reservation: 20 -> 20; screenshot reservations: 93-94. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| ID | Producer/task and canonical symbol | Exact consumption and lifetime |
|---|---|---|
| U1 | 09a T1/T3; `src/services/tabs.ts`: TabsState, TabState, openFolderTab, activateTab | Use existing tab IDs/order/active/history; additions below are optional on input and normalized on output. Never duplicate permanent Explorer. Revision tabs-documents-1 |
| U2 | 09a T5; `src/services/viewState.ts`: registerViewStateCodec; SessionData in tabs.ts | Saved descriptors use the same versioned64KiB/view, depth8,4MiB/session validation and secret exclusions. Revision session-2 |
| U3 | 09a T2/T6; DocumentRegistry and last-view close coordinator | acquire/release reference counts per view; dirty document confirmation occurs once before atomic group close. Do not discard a document still viewed elsewhere |
| U4 | 04a `planOpen(path,registry,openWith)` normal open decision;09a missing placeholders | Restore through this pipeline, not direct handler construction. Canonical path is src/handlers/openPipeline.ts |
| U5 | 03b `src/services/undo.ts`: UndoStack.push(UndoEntryInput), peek/confirm Undo/Redo | Extend FileAction only with the exact variant E7. Executor confirms history cursor only after successful restore/write |
| U6 | 09a TabHistory API in `src/services/tabHistory.ts` | record(before SessionData,after SessionData,labelKey string,labelArgs optional Record<string,string|number>)->UndoEntryInput; apply(id string,reverse boolean)->Promise<void>; releaseUnreferenced(ids readonly string[])->void. This is09a E10, tabs-documents-1 |
| U7 | fs-service atomic_write for app state; owned_io for user export; existing Dialog/Menu/Tooltip | Atomic catalog changes, no-replace export, existing focus trapping/translated labels; no unowned temporary-file cleanup |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

### T1: Canonical state and validation

Files: create tabGroups.ts, tabGroupValidation.ts, saved_group_types.rs; coordinator extends tabs/session types and root serde defaults. Dependencies U1/U2. Define all tables, reject duplicate/multiple membership, normalize legacy empty groups. Preserve optional future fields only through known descriptor codecs.

Tests `src/__tests__/tabGroups.test.ts`: `gathers_scattered_tabs_in_display_order`, input permanent,A,X,B grouping A/B ->permanent,A,B,X; `rejects_pinned_and_permanent_members` leaves input unchanged; `drops_empty_group`; `legacy_session_defaults_to_no_groups`; native `refuses_duplicate_membership` and `refuses_newer_catalog` expect groups.invalid/unsupported_version. Commit `feat(tabs): validated tab group state [step-09b/T1]`.

### T2: Group reducers and undo

Files: tabGroupActions.ts, tabGroupHistory.ts; coordinator reducer/Undo dispatch wiring only. Dependencies U1/U3/U5/U6. Implement D2/D3, atomic group transactions, dirty-safe close preparation, bounded history. Never call save/discard until all required dirty decisions are collected; cancellation has no structural effects.

Tests tabGroupActions.test.ts: `remove_member_places_it_after_group`, A/B/Cgroup removeB ->A,C,B; `active_hidden_member_expands`; `cancel_close_preserves_all_tabs`; `shared_document_prompted_once`; `undo_reopens_through_host_without_old_tokens`; history failure does not confirm cursor. Commit `feat(tabs): atomic group actions and history [step-09b/T2]`.

### T3: Saved catalog

Files: savedGroups.ts,saved_group_store.rs,saved_group_validation.rs; coordinator native command/state wiring. Dependencies U2/U7. Implement E4, compare revision under cross-process app-state lock, bounded read/atomic write, allowlisted descriptors. No lock held across source parsing/opening.

Tests native `revision_conflict_keeps_original_bytes`, expected3/current4 ->groups.changed; `one_hundred_and_first_group_refused`; `virtual_names_and_tokens_not_saved`; `failed_write_keeps_old_catalog`. UI savedGroups.test.ts mirrors revision args exactly. Commit `feat(tabs): atomic saved group catalog [step-09b/T3]`.

### T4: Open, import and export

Files: restoreSavedGroup.ts, saved_group_transfer.rs, savedGroupTransfer.ts. Dependencies U2/U3/U4/U7. Implement E5/E6 and capacity reservation, rollback only newly created runtime state on host failure, missing placeholder success. Export never overwrites; import never executes/open paths.

Tests `src/__tests__/restoreSavedGroup.test.ts`: `visible_first_two_open_limit`; `missing_member_does_not_abort_others`; `capacity_failure_opens_nothing`; `unknown_provider_placeholder`; native `import_assigns_fresh_ids`, `four_mib_plus_one_rejected`, `export_collision_keeps_both_files`. Commit `feat(tabs): restore and transfer saved groups [step-09b/T4]`.

### T5: Group and catalog controls

Files: TabGroupLabel.tsx, TabGroupMenu.tsx, SavedGroupsPanel.tsx, styles/tabGroups.css. Coordinator TabStrip/nav/plus-menu routes. Dependencies U1/U3/E1-E8. Implement specified roles/labels/menu/widths/keyboard; close catalog only after awaited success. Group drag uses tab IDs, not external content payloads.

Tests tabGroupsUi.test.tsx: name/color/collapse keyboard paths, Enter opens selected saved group, Esc restores trigger, readonly/error/empty states,200%zoom and Spanish label fixtures. Check no two TabStrip owners and no lost view identity on group movement. Commit `feat(tabs): accessible group and saved group controls [step-09b/T5]`.

### T6: Localization, help and reviewer integration

Files: help/en/tab-groups.md,help/es/tab-groups.md,help/en/saved-tab-groups.md,help/es/saved-tab-groups.md; coordinator locales/commands/measurements/screenshots/registry records. Add all keys above, no worker-generated pseudo file. Test group help links and command uniqueness in dedicated step09b test. Commit `docs(help): tab groups and saved groups [step-09b/T6]`.

## Coordinator commit labels (workers do not commit)

- feat(tabs): validated tab group state [step-09b/T1]
- feat(tabs): atomic group actions and history [step-09b/T2]
- feat(tabs): atomic saved group catalog [step-09b/T3]
- feat(tabs): restore and transfer saved groups [step-09b/T4]
- feat(tabs): accessible group and saved group controls [step-09b/T5]
- docs(help): tab groups and saved groups [step-09b/T6]

## Required handoff

Return `handoff/step-09b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
