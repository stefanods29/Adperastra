# Coding assignment: step 10f — Accessibility (v0.2)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-10f.md](../steps/step-10f.md). Guide SHA-256: `4ee0f393c960a87b9dc84c25536642e7c4ff0d91a8994c7f4a412f9cd40fefde`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10f-accessibility |
| Tag | v0.2.0 |
| Depends on | 10a contrast/themes;10b keyboard;10c formats/profiles;10e shell registries |
| Written before | 07a was built |
| Interface revision | accessibility-1; read-aloud-1 |

Settings reservation: 32 -> 33; screenshot reservations: 128-130. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 10a producer guide](../steps/step-10a.md)
- [Step 10b producer guide](../steps/step-10b.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10e producer guide](../steps/step-10e.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and exact dependencies

Read v1 step10c;rules/UI/speed/10a-e guides, current appearance.rs/UI_SCALES, all shared controls/Dialog/Menu/FileList/Toast/ribbon routing, media subtitles/animation,09c transfer,12a future storage interface only throughregisteredprovider. Use WCAG2.2 official guidance and real Narrator/NVDA checks; axe alone cannot certify reading order or usable flows.

| ID | Producer/task; canonical symbol | Use |
|---|---|---|
| U1 | 05d appearance.rs is_ui_scale/zoom_factor/screen_point,services/appearance.ts setUiZoom | Extend allowedscalesadditively225/250/275/300; includezoomandDPIinnativepopupcoordinates; preserve75-200existingvalues |
| U2 | 10a E4 contrastRatio/resolveReadableAccent;10a ThemeRuntime | Forcedhighcontrastwins decorativecolors/materials;samecontrastmath,notduplicate |
| U3 | 10b E3 KeyboardRouter;09c E1/E2 contentTransfer/TransferRegistry | Click-pick-dropusesthesametypedpayload/targetnegotiation,notsecondfileoperationimplementation |
| U4 | 10e E1/E2/E3 Home/Nav/Statusregistries;commandsregistry | Simplemodehidesadvancedpresentationonly,commandavailability/safetyrulesunchanged;criticalactionsstillreachableviashortcut/palette |
| U5 | 09a FileGrants memorybacking/nativegrants;files.ts fileUrl | Speechchunksmemory-only,rawWAVviaadpfile;noJSONaudio/base64orordinarycache |
| U6 | 10cProfileRoot/settingsschema32,UiHistoryRegistry09aE9 | Schema33defaults/persistence;perprofilepreferences,applyoneUndo,Windowsforcedsettingsnotpersistedoveruserchoices |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work/imports | Required tests/oracles |
|---|---|---|
| T1 `deps: add pinned OpenDyslexic assets [step-10f/T1]` | coordinatorassetdownloads/licensetable;workerswriteassetmanifesttestonly.U6 | accessibilityAssets.test.ts:fourbytes/hashessourcetablematch;OFLpreserved;nofontfromMicrosoftbundled |
| T2 `feat(accessibility): effective preferences and system state [step-10f/T2]` | accessibility.ts,accessibility_types.rs,accessibility_system.rs,AccessibilityContext.tsx;coordinator schema33/scales/root.U1/U2/U6 | accessibility.test.ts:systemforcedmotionwins;zoommax300notdouble;legacy200unchanged;invalidspacingsreject;forcedcolorsrestorepriorpreferences |
| T3 `feat(accessibility): keyboard focus and responsive main flows [step-10f/T3]` | AccessibleFileAnnouncement.tsx,announcements.ts,styles/accessibility.css;coordinatorsharedcontrols/Toast/Menu/FileList.U1/U3/U4/E5 | accessibilityUi.test.tsx:logicalposinsetwithvirtualrows;oneannounce/2sprogress;focusedtoastnoexpiry;dialog300%stack;alltargets24or44;noinactiveannouncements |
| T4 `feat(accessibility): installed voice read aloud [step-10f/T4]` | readAloud.ts,read_aloud.rs,read_aloud_stream.rs,ReadAloudToolbar.tsx.U5/E3 | readAloud.test.ts/native:1001scalarssplitbounded;SSMLtreatedplain;unknownvoicerefused;32MiB+1failbeforegrant;Stoprevokesall;secretsneversaved;sourceeditdoesnotchangequeuedcapture |
| T5 `feat(accessibility): alternate input and clear presentation [step-10f/T5]` | ClickPickDrop.ts,MotorSettings.tsx,HearingSettings.tsx,CognitiveSettings.tsx,VisionSettings.tsx,MotionSettings.tsx.U2-U4/E1-E4 | accessibleInput.test.ts:pickEsc0changes;dropreusesnegotiation;StickyKeymodifiersnotrequired;simplemodekeepsSettings/help;subtitlecontrast4.5;soundalwaysvisual;noautoplayGIFposter |
| T6 `docs(help): accessibility and milestone acceptance [step-10f/T6]` | sixhelppagesbelow;docs/accessibility/step10f-checklist.md;coordinatorkeys/pseudo/realATchecks/speed/shots.U1-U6 | keyparity/help;axe plusactualNarrator/NVDAflowsrecordedindependently;captionentrydisableduntil17bproviderready;allv0.2capabilitiestraceactualevidence |

## Coordinator commit labels (workers do not commit)

- deps: add pinned OpenDyslexic assets [step-10f/T1]
- feat(accessibility): effective preferences and system state [step-10f/T2]
- feat(accessibility): keyboard focus and responsive main flows [step-10f/T3]
- feat(accessibility): installed voice read aloud [step-10f/T4]
- feat(accessibility): alternate input and clear presentation [step-10f/T5]
- docs(help): accessibility and milestone acceptance [step-10f/T6]

## Required handoff

Return `handoff/step-10f/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-10f/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
