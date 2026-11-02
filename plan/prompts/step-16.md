# Coding assignment: step 16 — Windows integration and release polish (v0.4)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-16.md](../steps/step-16.md). Guide SHA-256: `2d91a520acf522bccb4ee6fcb1a817bfeac46684b42ae306466bbd20d1cfe066`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

|Field|Value|
|---|---|
| State | guide; documentation reviewed; implementation not started |
|Difficulty|4/5|
|Branch|step-16-windows-polish|
|Tag|v0.4.0 original milestone; AI-inclusive promise not fulfilled in this scope|
|Depends on|03a shell helper;08d release/update;09c activation-1;10c profile-root-1;12a packs-1|
|Written before|07a was built|
|Interface revision|windows-integration-1;resident-mode-1|

Settings reservation: 42 -> 43; screenshot reservations: 161-162. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08d producer guide](../steps/step-08d.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 12a producer guide](../steps/step-12a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses, data and public exports

|Ref|Producer/task/file/revision|Exact use|
|---|---|---|
|U1|09c E4/E6;activation.ts/activation.rs;activation-1|ActivationRequest/Ack,onOpenRequest/activationReady; optionalintentD3 additivecoordinatorchange,notprivateworkerfork|
|U2|08d E1-E6;updates.ts/portable.rs;release-1|UpdateInfo/checkForUpdates/openUpdatePage,PortableLocation/ArtifactRecord; noarbitraryURLs|
|U3|10c profile_root.rs;profile-root-1|ProfileRoot base_dir/profile_dir/shared_packs_dir/profile_id/portable; registryledgerprofile-independentinstallationstate|
|U4|09a documentclose;09h recovery;12a E2/E5|Awaitdirtydecision,releaseengines/packleases,retainonlyexplicitbackgroundpolicy;neverwriteuntestedhistorycontent|
|U5|03a classic_menu.rs/helper.rs;baseline|Existingisolatedshellmenuhost/timeout; noDLLloadinmain|

Canonical `src/services/windowsIntegration.ts`,native `windows_integration_types.rs`; registry mutation onlynativeledger.

|Type|Fields|
|---|---|
|IntegrationStatus|classic_enabled bool;modern state unavailable/awaiting_owner/available/enabled;associations string[]<=128;startup_enabled bool;reason_code nullablestring|
|RegistryOwnedValue|key fixedownedrelativepath;name string;installed_value bytes<=64KiB;previous_value optionalbytes;type enum;app_version SemVer;ledger_schema1|
|ResidentStatus|state visible/closing_decision/resident/restoring/quitting;enabled bool;start_with_windows bool;private_bytes safeu64;measured_unix safeu64;active_jobs u32|
|IntegrationRequest|classic_enabled bool;extensions lowercasealphanumeric[]<=128fromallowlist;start_with_windows bool;modern_requested boolfalseunlessapproved |

|Ref|Exact export/signature|Consumers|
|---|---|---|
|E1|services/windowsIntegration.ts integrationStatus()->Promise<IntegrationStatus>;applyWindowsIntegration(request:IntegrationRequest)->Promise<IntegrationStatus>|Settings/installer; native windows_integration_status/apply; userchoiceonly|
|E2|services/resident.ts residentStatus()->Promise<ResidentStatus>;setResidentMode(enabled:boolean,startWithWindows:boolean)->Promise<ResidentStatus>;showResidentWindow()->Promise<void>|startupSettings/tray; native resident_status/set/show; closeeventsmanagednative|
|E3|native resident.rs ResidentCoordinator.request_close()->Future<Result<CloseDecision,String>>;activate(request:ActivationRequest)->Future<Result<(),String>>|CloseDecision keep_visible/hide/exit;09a dirtyclose callback is supplied bycoordinator,notduplicated UI prompt|
|E4|native windows_integration.rs restore_owned_registration(ledger:&RegistryLedger)->Result<IntegrationStatus,String>|Uninstaller/disable;onlycurrentmatchingownedvaluesrestored|

Errors windows_integration.bad_request/denied/changed/identity_required/failed andresident.busy/failed. EveryIPCensure_main/allowlist/validation; no registrykey/commandlineacceptedfromUI.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## UI/text/tasks

StartupSettings existingsection adds twoSwitches plusactualmemorylabel; WindowsIntegrationSettings max960px uses classiccheckbox,modernstatus/learnmore,associationlistvirtualizedrow28,Choose defaultsButton. No default-selectiondarkpattern. `.adp-resident-memory` body12pxmutedtoken;`.adp-integration-status` gap8,border/radiustokens. Traymenusnativekeyboardaccessible; visiblecontextneverlostclosingcancel.

|Keys|English|Spanish|
|---|---|---|
|windowsIntegration.title / windowsIntegration.classic / windowsIntegration.modern / windowsIntegration.defaults|Windows integration / Add commands under Show more options / Windows 11 main menu / Choose default apps…|Integración con Windows / Agregar comandos en Mostrar más opciones / Menú principal de Windows 11 / Elegir aplicaciones predeterminadas…|
|windowsIntegration.identityRequired|The main Windows 11 menu needs an approved package identity and trusted deployment.|El menú principal de Windows 11 necesita una identidad de paquete y una distribución de confianza aprobadas.|
|resident.enable / resident.startWindows / resident.memory|Stay in background / Start with Windows / Current background memory: {size}|Permanecer en segundo plano / Iniciar con Windows / Memoria actual en segundo plano: {size}|
|resident.open / resident.disable / resident.quit|Open / Turn off stay in background / Quit|Abrir / Desactivar permanencia en segundo plano / Salir|
|resident.explain|Keeps a small idle window ready. Other background tasks keep their own settings.|Mantiene lista una ventana pequeña e inactiva. Las demás tareas conservan su propia configuración.|
|errors.windows_integration.failed / errors.resident.failed|Windows integration could not be changed. / Background mode could not be changed.|No se pudo cambiar la integración con Windows. / No se pudo cambiar el modo en segundo plano.|

Commands app.windowsIntegration/app.stayBackground,labelsabove,icons PanelsTopLeft/Moon,globalshortcutnone,helpwindows-integration/stay-in-background. Updatekeysreuse08d. Othererrorsmapfailedwithstablecode; identity_requiredusestextabove.

|Task;commit|Files/work;dependencies|Namedtests:input->oracle|
|---|---|---|
|T1;`feat(windows): owned optional registration ledger [step-16/T1]`|windows_integration_types.rs,registry_ledger.rs,services/windowsIntegration.ts;U1/U3.|userchoice_untouched;foreign_changed_key_preserved;disable_restores_exactpreviousvalue;selection257_refused|
|T2;`feat(windows): Explorer activation and association choices [step-16/T2]`|integration_commands.rs,WindowsIntegrationSettings.tsx;coordinator09cintentextension;U1.|convert_intent_opens_review_noautooutput;paths_quotes_singleargument;defaults_notforced;oldactivation_defaultsopen|
|T3;`feat(startup): dirty-safe resident state machine [step-16/T3]`|resident.rs,resident_state.rs,services/resident.ts;U4.|dirtycancel_keepsvisible;activation_resident_onewindow;turnoff_exits_after_safeclose;no_tasks_enabled_by_residence|
|T4;`feat(tray): localized background controls and memory [step-16/T4]`|tray.rs,resident_memory.rs,StartupResidentSettings.tsx;U4.|onetray_after_languagechange;memory_value_fromsample;engines_unload_whenresident;Quit_doesnotdiscarddirty|
|T5;`build(installer): clean upgrade uninstall and offline packs [step-16/T5]`|installerintegration/ledger/offlinecatalogspec;coordinatorpackage scripts;U2/U3.|offlinehash_verified;upgrade_dirty_exitcancel;uninstall_keepsdatadefault;foreignroot_neverremoved|
|T6;`docs(windows): modern-menu checkpoint evidence [step-16/T6]`|unsignedmodernpackage/COMregistrationplanandtradeoffreport;U1;noinstallation.|modern_status_not_claimedenabled;classic_label_truthful;ownercheckpoint_onlydependentpath|
|T7;`docs(help): Windows startup associations and updates [step-16/T7]`|Fourpagesbelow;coordinator schema43/keys/updatecache/report/evidence.|migration42_preservesprefs;updatesoff_nonetwork;classichelper_timeout_survives|

## Exact file and test allocation

Feature-owned roots: src-tauri/src/{windows_integration_types,registry_ledger,integration_commands,resident,resident_state,tray,resident_memory}.rs; src/services/{windowsIntegration,resident}.ts; src/views/settings/WindowsIntegrationSettings.tsx and StartupResidentSettings.tsx. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src-tauri/src/windows_registry_step16_tests.rs|
|T2|src-tauri/src/windows_activation_step16_tests.rs|
|T3|src-tauri/src/resident_step16_tests.rs|
|T4|src/__tests__/step16-resident.test.tsx|
|T5|src-tauri/src/installer_step16_tests.rs|
|T6|src/__tests__/step16-modern-checkpoint.test.ts|
|T7|src/__tests__/step16-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Coordinator commit labels (workers do not commit)

- feat(windows): owned optional registration ledger [step-16/T1]
- feat(windows): Explorer activation and association choices [step-16/T2]
- feat(startup): dirty-safe resident state machine [step-16/T3]
- feat(tray): localized background controls and memory [step-16/T4]
- build(installer): clean upgrade uninstall and offline packs [step-16/T5]
- docs(windows): modern-menu checkpoint evidence [step-16/T6]
- docs(help): Windows startup associations and updates [step-16/T7]

## Required handoff

Return `handoff/step-16/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-16/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
