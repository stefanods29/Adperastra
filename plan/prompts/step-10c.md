# Coding assignment: step 10c — Tab options, date and size formats, behavior, profiles, portable mode

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10c.md](../steps/step-10c.md). Guide SHA-256: `3c62d383063ad72987d6cd4c830ef26d4821434914c21f00ffcf01956fc5b5f8`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10c-preferences-profiles |
| Tag | v0.1.14-step10c |
| Depends on | 08d portable location;09a sessions;10a themes;10b shortcuts |
| Written before | 07a was built |
| Interface revision | display-formats-1; profile-root-1; tab-options-1 |

Settings reservation: 29 -> 30; screenshot reservations: 119-121. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08d producer guide](../steps/step-08d.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09b producer guide](../steps/step-09b.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 09k producer guide](../steps/step-09k.md)
- [Step 10a producer guide](../steps/step-10a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and dependencies

Read mapped v1 step10a tab/format/behavior/profile scope;08d portable.rs E5,09a/b sessions/groups,10a/b contracts; current `src/services/{settings,format,settingsFile,files,explorer}.ts`, TabStrip/tab reducers, current UI zoom and settings validation/migration; add-settings recipe; data-folder and save safety contracts.

| ID | Producer/task; exact symbol/file | Required use |
|---|---|---|
| U1 | 08d T3/E5 `src-tauri/src/portable.rs`: PortableLocation | app_dir/data_dir absolutePathBuf,portable/writablebool; data_dir is base location, never redefined to selectedprofile |
| U2 | 09a T1/T3/T5 tabs/session/StartupSettings;09b groups/saveddescriptors | New tab policies alter placement/activation through existing reducers; descriptor formats stay session-2; no persistedlivegrants |
| U3 | 05d services/settings.ts defaultSettings/normalizeSettings/loadSettings/saveSettings,main.rs validate/migrate | Schema29 -> 30, defaults/migration/fixtures together; preserveunknownnewerschemarefusal |
| U4 | baseline services/format.ts formatSize(bytes,locale),formatDate(unixSeconds,locale) | Existing two-argument behavior preserved; optional typed options added through E1, allnewcallersusecurrentcontext |
| U5 | baseline settingsFile.ts exportSettings(title,fileName,filterName)->Promise<string|null>,importSettings(title,filterName)->Promise<AppSettings|null> | Import remains preview-only, never saves byitself;10e setup builds onthissemantics |
| U6 | 09a T2 sharedDocumentRegistry/dirtyclose,09h recovery,09k sensitiveprovider | Profile switch asks dirtydecisions,locks sensitiveproviders andflushesstate; no plaintextsnapshotcopiedout |
| U7 | 09a T3/E9 UiHistoryRegistry;10a/b appearance and effective shortcuts | One history transaction for ordinarypreferences; profile switch/restart is explicitnonundoable action withwarning |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Exact files/order/imports | Tests and exact results |
|---|---|---|
| T1 `feat(preferences): tab and format schemas [step-10c/T1]` | displayFormats.ts,tabOptions.ts,preferences_validation.rs;coordinator schema30/currentfixtures. U2/U3/U4 | displayFormats.test.ts:1000decimal“1 KB”;1536binary“1.5 KiB”;missingoptionslegacy“1.5 KB”;invalidpatternreject;oldschema29migrationlegacy,newdefaultbinary |
| T2 `feat(tabs): configurable placement and previews [step-10c/T2]` | TabOptionsSettings.tsx,useTabHoverPreview.ts,tabOptionReducers.ts;coordinatorTabStrip/reducers. U2/E2 | tabOptions.test.tsx:afteractivekeepsgroupcontiguous;rightclosefallbackMRU;hovercancel;previewOnly/noautoplay/cloudskip;titlefullaria;permanentunchanged |
| T3 `feat(format): consistent dates names and sizes [step-10c/T3]` | DateSizeSettings.tsx,useDisplayFormats.ts,nameDisplay.ts,customDatePattern.ts;coordinatorformatcallsitecontext. U3/U4/E1 | formats.test.ts:59s=>now,60s=>1min,3600s=>1h;futurepositive;graphemeemojiunbroken;extensionkeptmiddle;epochlegacyblankunchanged |
| T4 `feat(profiles): bounded profile roots and catalog [step-10c/T4]` | profiles.ts,profile_types.rs,profile_root.rs,profile_catalog.rs;coordinatorbootstrapdependencyinjection. U1/U3/E3/E5 | nativeprofiles:defaultbaseunchanged;UUIDrootcannottraverse;21strefused;catalogrevisionconflictpreservesbytes;defaultcategoryclearcannotclearsharedpacks |
| T5 `feat(profiles): dirty-safe controlled restart [step-10c/T5]` | ProfileSwitchCoordinator.ts,profile_switch.rs,ProfilesSettings.tsx. U6/E4/E7 | profileSwitch.test.ts:dirtyCancelzerochanges;jobbusyrefuse;failedflushkeepsactive;pendingdurablebeforeRestart;failedtargetstartupretainslastprofile;allcontainerslocked |
| T6 `feat(portable): verified app-data copy [step-10c/T6]` | portable_copy.rs,portable_copy_manifest.rs,PortableCopyDialog.tsx. U1/E5/E6 | nativecopy:nonemptydestrefused;sourcehashfailurepublishesnocomplete;cancelkeepssource;noPrivateKeypathread;successmanifesthasheseverycopiedfile;noguessedcleanup |
| T7 `docs(help): preferences profiles and portable data [step-10c/T7]` | fullhelpbelow;docs/translating.md;coordinatorkeys/pseudo/RTLfixture/speedshots. U1-U7 | en/eskeys/ICU;RTLreadingorder/pathnotreversed;allprofile/rootconsumersreceiveE5;nohardcodedformatstrings |

## Coordinator commit labels (workers do not commit)

- feat(preferences): tab and format schemas [step-10c/T1]
- feat(tabs): configurable placement and previews [step-10c/T2]
- feat(format): consistent dates names and sizes [step-10c/T3]
- feat(profiles): bounded profile roots and catalog [step-10c/T4]
- feat(profiles): dirty-safe controlled restart [step-10c/T5]
- feat(portable): verified app-data copy [step-10c/T6]
- docs(help): preferences profiles and portable data [step-10c/T7]

## Required handoff

Return `handoff/step-10c/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10c/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
