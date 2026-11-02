# Coding assignment: step 09k — Locked folders

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09k.md](../steps/step-09k.md). Guide SHA-256: `38f5b5027b84f7f68bcaa19035b26e21076a30c6785eddedc78cffd5026b3dab`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 5/5 |
| Branch | step-09k-locked-folders |
| Tag | v0.1.11-step09k |
| Depends on | 09a DocumentRegistry/controller/grants;08a sensitive snapshots;09f replace-capability-0;06e guarded archive |
| Written before | 07a was built |
| Interface revision | locked-container-1; sensitive-provider-1 |

Settings reservation: 26 -> 27; screenshot reservations: 112-113. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 09h producer guide](../steps/step-09h.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

| ID | Producer/task and exact export | Consumption |
|---|---|---|
| U1 | 09a E3/E4/controller.ts DocumentProvider/DocumentHandle/DocumentRef/DocumentControllerBinding | Register provider locked; source virtual {provider:locked,container_path,entry_id};no fakeOSpath/FileTypeInfo; single sharedmodel;sourceoriginalreadRange vscapturecurrentencodedbytes |
| U2 | 07d E8 file_grant_backing.rs GrantedBacking/FileGrants.grant_backing/resolve_backing, consumed unchanged by09a | Boundedmemoryrangegrants, sensitiveclassification native; diskpath_forreturnsNoneforvirtual |
| U3 | 08a E4/E5 ExportSnapshot/ExportSnapshots | Sensitiveencoded snapshots max256MiB/source,1GiBaggregate, memoryonly; no genericcache/recovery/clipboard fallback |
| U4 | 06e archive guard/owned_io;09f replacefalse | ReadouterZIPthroughguardedhelper,validateeveryentry;newcontainer OwnedOutput.publish_name/no-replace;nevergenericunpackoroverwrite |
| U5 | 09c TransferRegistry/sensitive_copy disclosure;09h recovery capture | Refuseordinaryrecovery/index/history/thumbnaildiskspool; explicitCopyoutonlyroute;encryptedpendinggenerationrecoverybelow |
| U6 | 07a BackgroundPolicy/CacheServiceSourceStamp;09aTabHistory/session | Sensitivevirtualprovidersarenotregisteredbackgroundsources;persistonlycontainerpath/opaqueentryID,notinnername/view/password |

Pin age0.12.1 (MIT OR Apache-2.0,Rust1.74),defaultfeaturesoff;useage::secrecy reexport. Existingresolvedzeroize1.9.1 (MIT/Apache,Rust1.85) directdependencyforbuffers. Verify09kmetadatafromcrates.io/API/docs.rs versionedsource,recordlicenses/notices. Ageuses scrypt0.11,notcurrentincompatible0.12. Noassumptionpre1.0libraryisproductionproven;reviewmustassessthisexactformatandimplementation.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks / exact tests / commits

| Task | Files / ordered work / imports | Required tests with oracle | Commit |
|---|---|---|---|
| T1 | newlocked-storecrate manifest/lib/types/limits;coordinatorage/zeroize/notices;U1-U4 | metadata/version/licensecheck;sourcecredentialDebugredacted;unsupportednewerschemarefused | `deps: add standard age container encryption [step-09k/T1]` |
| T2 | crypto.rs/keyslots.rs/recovery_key.rs;U3;standardseparateageslots | step09k_crypto_tests.rs:passwordandindependentrecoverydecryptsameidentity;mixedrecipientheadernevercreated;workfactor19refusedbeforeKDF;truncatedagestreamnoexposure;wrongpasswordgenericerror | `feat(locked): standard password and recovery keyslots [step-09k/T2]` |
| T3 | format.rs/index.rs/chunks.rs/validation.rs;docs/formats/locked-container-v1.md;U4 | step09k_format_tests.rs:pathtraversal/duplicatechunk/casecollision/refwronghash/reorderedchunks/newerversion/oversizedindexrefused;zero/emptyfileexactlength;finalauthchecked | `feat(locked): bounded authenticated container format [step-09k/T3]` |
| T4 | create.rs/verify.rs/native locked_create.rs;U2/U4 | step09k_create_tests.rs:cancel/noSpace/corruptverificationoriginalkept;allchunksverifiedbeforepublish;foreignpartial/outputkept;plaintextoriginalwarningrequired | `feat(locked): verified encrypted copies without source removal [step-09k/T4]` |
| T5 | locked_provider.rs/locked_sessions.rs/LockedDocumentProvider.ts/VirtualTextView.tsx;U1/U2/U3 | sensitive_virtual.test.ts:readRangeoriginal/captureediteddistinct;two viewsonemodel;fakepathneverused;lastgrantcancelreadthenzeroize;noordinarycache/recovery/clipboard/indexwrites | `feat(locked): memory-only virtual document provider [step-09k/T5]` |
| T6 | pending.rs/generations.rs/locked_lock.rs/lockedFolders.ts;U1/U3/U5 | step09k_lifecycle_tests.rs:idletimer5min;workstationlock;pendingpersistfailnotreportlocked;crashnewgenerationdecryptable;Savecopydoesnotrebindorcleantheoriginal;originalcontainerhashkept | `feat(locked): encrypted recovery and safe locking lifecycle [step-09k/T6]` |
| T7 | LockedFolderView.tsx/CreateLockedCopyDialog.tsx/UnlockDialog.tsx/LockPendingCurtain.tsx/styles/lockedFolders.css;schema27coordinator | lockedUi.test.tsx:confirmationpasswordspaceskept;min12;recoveryexportcollision;protectedunsupportedroutesexplicit;keyboard/Spanishwarningnooverflow | `feat(locked): encrypted container controls and disclosures [step-09k/T7]` |
| T8 | sixhelpfilesbelow;coordinatortranslations/pseudo/registry/speed/shots/securityreport | fulladversarialroundtripindependentreviewrequired,notmockonly;allkeys/help/consumersresolved | `docs(help): locked containers recovery and protection limits [step-09k/T8]` |

## Coordinator commit labels (workers do not commit)

- deps: add standard age container encryption [step-09k/T1]
- feat(locked): standard password and recovery keyslots [step-09k/T2]
- feat(locked): bounded authenticated container format [step-09k/T3]
- feat(locked): verified encrypted copies without source removal [step-09k/T4]
- feat(locked): memory-only virtual document provider [step-09k/T5]
- feat(locked): encrypted recovery and safe locking lifecycle [step-09k/T6]
- feat(locked): encrypted container controls and disclosures [step-09k/T7]
- docs(help): locked containers recovery and protection limits [step-09k/T8]

## Required handoff

Return `handoff/step-09k/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09k/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
