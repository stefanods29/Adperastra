# Coding assignment: step 09j — Disk images and clipboard history

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-09j.md](../steps/step-09j.md). Guide SHA-256: `dd5f4ba37cf5e5d0ba537258379901859f40bcc01fb3bb3412b657bc68734c19`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-09j-disk-clipboard |
| Tag | v0.1.10-step09j |
| Depends on | 09a foldertabs;09c content-transfer-1;09h DPAPI/localstorage |
| Written before | 07a was built |
| Interface revision | disk-mount-1; clipboard-history-1 |

Settings reservation: 25 -> 26; screenshot reservations: 110-111. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09h producer guide](../steps/step-09h.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first / uses

| ID | Producer/task and exact export | Consumption |
|---|---|---|
| U1 | 09a openFolderTab/FolderTabState andnormalfslisting | Mounteddriveopensanormalfoldertabafteractualmountresult;noimagepathmasqueradesasdrive |
| U2 | 03a services/explorer.ts listDrives/openInTerminal;native shellhelpers | RefreshThisPCafterattach/detach;terminalunchanged |
| U3 | 09c E1/E2 TransferEnvelope/Payload/TransferRegistry;08aExportSnapshots | ClipboarditembecomesauthorizedtransferonlyonexplicitPaste;imagesrawbytesviaadpfile/notJSON |
| U4 | 03b fileops.ts clipboardSetFiles/clipboardRead/clipboardText/clipboardImageFile;nativeclipboard.rs | Addcapturecallbacksonsuccessfulapp-copy only, passing its authoritative TransferEnvelope.transfer_id;donotchangetheOSclipboardformatsemantics |
| U5 | 09h native recovery_dpapi.rs | AddE8 protect_current_user(input:&[u8])->Result<Vec<u8>,String>,unprotect_current_user(input:&[u8])->Result<zeroize::Zeroizing<Vec<u8>>,String>,max64MiB;reuseforpersistenthistory,differentauthenticatedrecordmagic |
| U6 | 07aSourceStamp;nativehelper/job/ownedio;09cactivationsecurity | Diskidentityguard/main-onlycommands,one-operationelevatedbrokerauthority, noarbitraryprivilegedcommandchannel |

Mappedv109ddisk/clipboardparagraphs;Windows0.61.3local Vhdsource;currentClipboardDataandboundedimageencoder;helperflagdispatch;privacy/settingsrecipes. NewWindowsfeaturesWin32_Storage_Vhd/Win32_Foundation/Win32_Security/Win32_System_IOplusclipboardfeaturesverifiedbeforeinstall.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks / named tests

| Task/commit | Files/imports/algorithm | Tests and exact oracle |
|---|---|---|
| T1 `deps: enable Windows virtual disk APIs [step-09j/T1]` | coordinatormanifestfeatures;disk_image_types.rs/diskImages.ts;U1/U6 | nativeinvalidpath/nonreadonlybeforeAPI;rawIMGunsupported;verifiedISOIMGnormalizesiso |
| T2 `feat(disks): guarded read-only mount lifecycle [step-09j/T2]` | disk_images.rs/disk_mounts.rs/disk_volumes.rs;U1/U2/U6 | sourcechangednomount;actualvolumerootused;10mountlimit;externalnotdetached;inusekeepsmount;cancelnoorphanhandle;defaultreadonlyflag |
| T3 `feat(disks): narrowly scoped elevated broker [step-09j/T3]` | disk_broker.rs/disk_broker_security.rs;coordinatorhelperentry;U6/E5 | wrongpeerPID/start/SIDdenied;extraop/pathafterbinddenied;UACcancelclean;sourcejunctionrefused;parentdisconnectreadonlymountdetached;realbrokersecurityfixturebycoordinator |
| T4 `feat(clipboard): private-aware bounded history [step-09j/T4]` | clipboard_history_types.rs/clipboard_history.rs/clipboard_history_listener.rs/clipboardHistory.ts;U3/U4 | privateformatcheckedbeforepayloadread;sequencechangediscard;3busyretrylimit;101evictsoldestunpinned;21stpinrefused;image16MP+1refused;sensitiveappskipped |
| T5 `feat(clipboard): encrypted optional history persistence [step-09j/T5]` | clipboard_history_store.rs/clipboard_history_payload.rs;schema26coordinator;U5 | defaultnodiskwrites;DPAPIwronguserfails;corruptrownotplaintextfallback;clearonlyownedhistory;foreignfileskept;nohistoryuploads |
| T6 `feat(ui): disk mount actions and clipboard history [step-09j/T6]` | MountedImageActions.tsx/ClipboardHistoryPanel.tsx/styles/clipboardHistory.css;U1-U4 | clipboardUi.test.tsx:selectionnopasteuntilaction;targetreadonlyfail;PasteSpecialscopewins;keyboardpin/search/clear;mountadminconfirmbeforeUAC |
| T7 `docs(help): disk images and clipboard history [step-09j/T7]` | fourhelpfilesbelow;coordinatorlocales/pseudo/measures/shots | bilingualeject/historyhelp;commandsunique;oldTerminaltestsunchanged |

## Coordinator commit labels (workers do not commit)

- deps: enable Windows virtual disk APIs [step-09j/T1]
- feat(disks): guarded read-only mount lifecycle [step-09j/T2]
- feat(disks): narrowly scoped elevated broker [step-09j/T3]
- feat(clipboard): private-aware bounded history [step-09j/T4]
- feat(clipboard): encrypted optional history persistence [step-09j/T5]
- feat(ui): disk mount actions and clipboard history [step-09j/T6]
- docs(help): disk images and clipboard history [step-09j/T7]

## Required handoff

Return `handoff/step-09j/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-09j/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
