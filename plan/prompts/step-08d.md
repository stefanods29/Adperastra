# Coding assignment: step 08d — First release (v0.1)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-08d.md](../steps/step-08d.md). Guide SHA-256: `c2f18d3f5b631eb5597e4c075946c2e69f2c5c033d7683064ffc5aaada4a9873`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 2/5 |
| Branch | step-08d-release |
| Tag | v0.1.0 (reserved, not created by planning) |
| Depends on | all00-08c feature/acceptance requirements, no openBlocker/Major |
| Written before | 07a was built |
| Interface revision | release-1 |

Settings reservation: 18 -> 19; screenshot reservations: 88-90. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 07f producer guide](../steps/step-07f.md)
- [Step 07g producer guide](../steps/step-07g.md)
- [Step 08a producer guide](../steps/step-08a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses from other steps

| Ref | Producer; canonical dependency | Exact use |
|---|---|---|
| U1 | 01a setup-core anddependencies.jsonpublicmanifest | Existingverify/checksum/sourceformat; no signingkeyaccess; no unsignedpayloadsubstitution |
| U2 | 01b/05d/06c settings/data-root/help | Existingsettingsmigrate/atomicwrite,language/theme,helpregistry; schema18->19; preserveeverypriorsection |
| U3 | 07a/07d/07f/07g helperassetmanifests | Packagealltrustedhelperentries/workers/fonts/codecsresources actuallyregistered; excludeunregisteredtestpages |
| U4 | 08a/b/c registries andreports | Verifyadvertisedcapabilitiesandlimitations; releasenotesfromobservedbehavior/CHANGELOG,notunbuiltguides |
| U5 | currentgate/CI/package scripts | Sameverificationbar;unsignedpackagingpathandno-debug-portassertions; neverweakenchecks |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exactcommit | Files/work | Tests and evidence expected |
|---|---|---|
| T1; `feat(release): deterministic unsigned artifact manifest [step-08d/T1]` | releaseversion.rs/artifact_inventory.rs; coordinatorpackage/buildmetadata/versionmanifest; fixedartifactlistandallowlistedruntimeassets. | version/tagmismatchfails;debugport/testkey/model/privatefileinartifactfails;sha256knownbytesabc=>ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad |
| T2; `feat(installer): data-preserving per-user install [step-08d/T2]` | new installer/ directoryNSIScustomhookstext; coordinatorTauriconfig/packageoptions. D2upgrade/uninstallownership/inusepaths. | defaultuninstallkeepsdata;unknown/junctiondatafolderrefusedforremove;failedbinaryupgradepreservesoldapp/data;noadministratorcore requirement |
| T3; `feat(portable): explicit portable data location [step-08d/T3]` | portable.rs andsettingsbootstrapextension; coordinatorportableZIPmarker. D3/E5, writepreflightandchoice. | markeractiveusesadjacentdata;nonwritableofferschoose/cancelwith0writes; cancelledchoicepreservesoldlocation; longpathworks |
| T4; `ci(release): verified unsigned artifact workflow [step-08d/T4]` | coordinatorrelease.yml,build/verificationcontentchecker,release-notesgenerationinstructions. D4-D6exactSHAs,nopublishjob. | workflowcannotpublishbytagalone;non-main/unverifiedrefcannotbecalledrelease;artifactallowlisttested;no keyfolderpathaccessorcertificateinstall |
| T5; `feat(updates): opt-in release checks [step-08d/T5]` | updates.rs/services/updates.ts/UpdateSettings.tsx;coordinatorschema19/status/help. D7/E1-E4. | default0networkrequests;1.10.0>1.9.0;foreignHTMLURLrefused;response256KiB+1refused;timeoutdoesnotblockUI; noautomaticdownload |
| T6; `docs(release): bilingual install and verification guidance [step-08d/T6]` | README/releasedocs/helptextsbelow;coordinatortext/pseudo; draftsremainingevidence/checklist. | bothlanguages/helpexist;unsignedwarning/checksumstepsclear;pendingMajornevermarkedpassed;What'snewshownonceonsuccessfulrecord |
| T7; `test(release): installer and milestone acceptance matrix [step-08d/T7]` | docs/releases/0.1.0/acceptance.md pluswrittenautomationtests;coordinatorexecutesSandbox/fullgate/package/security/speed/screenshotsandreport. | cleaninstall/upgrade/reinstall/uninstallKeep/Remove/portable/offline/missingWebView2;everyv0.1featuretracedtoactualpassing evidence;openBlocker/Majorstopsreadiness |

Workerswritecode/tests/instructionsbutrunneitherNSISnorworkflow/Sandbox. Testswithoutrealinstalleruseinjectedfilesystem/inventory/HTTP;actualuserdataremovedonlyinasyntheticSandboxcheckwithpre-createdfixturesandexplicitconfirmation.

## Coordinator commit labels (workers do not commit)

- feat(release): deterministic unsigned artifact manifest [step-08d/T1]
- feat(installer): data-preserving per-user install [step-08d/T2]
- feat(portable): explicit portable data location [step-08d/T3]
- ci(release): verified unsigned artifact workflow [step-08d/T4]
- feat(updates): opt-in release checks [step-08d/T5]
- docs(release): bilingual install and verification guidance [step-08d/T6]
- test(release): installer and milestone acceptance matrix [step-08d/T7]

## Required handoff

Return `handoff/step-08d/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-08d/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
