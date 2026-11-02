# Coding assignment: step 11a — Search index, search modes, speed pass

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-11a.md](../steps/step-11a.md). Guide SHA-256: `f1c5834e8d361eacc6d5a18f1e251db034c39f99065c46ddb5357ba5aa6dfecc`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-11a-index-search |
| Tag | v0.2.1-step11a |
| Depends on | 07a background/cache/identity;07d PDFtext;07e OCR;09a watchers;09d palette;10c profiles/formats;10faccessibility |
| Written before | 07a was built |
| Interface revision | search-index-1 |

Settings reservation: 33 -> 34; screenshot reservations: 131-133. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 07d producer guide](../steps/step-07d.md)
- [Step 07e producer guide](../steps/step-07e.md)
- [Step 07f producer guide](../steps/step-07f.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09d producer guide](../steps/step-09d.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10f producer guide](../steps/step-10f.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Read first and dependencies

Read v1 step11a,roadmap/backlog,rules/background/speed;07a/07d/e/f,09a/d,10c/f. Read currentrusqlite0.41.1/notify8.2.1/regex1.13.1 source,ExplorerItem/SortSpec,allItemViewvariants/selection. ExistingregexisalreadyresolvedinCargo.lockbutadddirectdependencyonlythroughcoordinatorapprovedmanifesttask.

| ID | Producer/task; canonical symbol/file | Use |
|---|---|---|
| U1 | 07a T3/E4 BackgroundPolicy/scheduler andSourceStamp;07a E9 FileIdentityKey | filename_index/content_indextasks; noforegroundbudgetsteal,full100nstampvswhole-secondSourceIdentitykeptdistinct |
| U2 | 09a T4/E8 services/explorer.ts watchSubscribe(path,listener,options{recursive:bool} optional)/watchUnsubscribe | Recursiveindexedroots,128subscriptionsmax;eventgeneration/pairedold_pathoptional/overflowrescan;unsubscribeonlyownID |
| U3 | 07d E3 readPdfText(sessionId,page,afterRun)->Promise<PdfTextPage>;07e OCRcachedresults;07f E7 normalizedbook/othertext | Nativeextractoradaptersuseverifiedhelperbackings;boundchunks,neverexecutecontent;OCRonlyexplicitcontentsettingandinstalledlanguage |
| U4 | 09d FolderPresentation/ColumnSpec,ItemViewProps;handlers/openPipeline.ts planOpen | SearchresultsareExplorerItem-basedandusenormalview/selection/openrules;actualdiskpaths,notindexIDaspath |
| U5 | 10c E5 ProfileRoot/E1 displayformats;10f E1 EffectiveAccessibility | Storeunderprofile_dir;displaylocaleindependentindexkeys;allmainsearchscreenaccessibilitybar |
| U6 | 06d jobs.rs Jobs/JobContext/spawn_job;services/jobs.ts runJob/JobHandle.completion | Indexbuildandregexscanssharedjobs,poll100ms,cancellable;noTauriChannel |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Texts, UI and tasks

| Key | English | Spanish |
|---|---|---|
| search.title / search.name / search.content / search.filters / search.regex / search.searchBox | Search / Name / Content / Filters / Regex / Search indexed files… | Buscar / Nombre / Contenido / Filtros / Expresión regular / Buscar archivos indexados… |
| search.index / search.roots / search.addRoot / search.contentOptIn / search.ocrOptIn / search.pause / search.rebuild | Indexing / Indexed folders / Add folder… / Index file contents / Include OCR in these folders / Pause indexing / Rebuild selected index | Indexación / Carpetas indexadas / Agregar carpeta… / Indexar contenido / Incluir OCR en estas carpetas / Pausar indexación / Reconstruir índice seleccionado |
| search.save / search.savedName / search.updated / search.partial / search.truncated / search.prefixShort | Save search… / Search name / Results changed; the first page was refreshed. / Index coverage is incomplete. / Only part of this file was indexed. / One- and two-character queries match name prefixes. | Guardar búsqueda… / Nombre de búsqueda / Cambiaron los resultados; se actualizó la primera página. / La cobertura del índice está incompleta. / Solo se indexó parte de este archivo. / Las consultas de uno o dos caracteres coinciden con prefijos del nombre. |
| search.aiUnavailable / search.openStorage / search.usn / search.usnWarning | Set up AI search to use this mode. / Open App storage / Enable optional NTFS fast indexing / Windows will ask permission for this metadata-only helper. Ordinary indexing works without it. | Configura la búsqueda con IA para usar este modo. / Abrir almacenamiento de la aplicación / Activar indexación rápida NTFS opcional / Windows pedirá permiso para este ayudante de metadatos. La indexación normal funciona sin él. |
| search.empty / search.loading / search.foundBy / search.count | No matching files. / Searching… / Found by {mode} / {count, plural, one {# result} other {# results}} | No hay archivos coincidentes. / Buscando… / Encontrado por {mode} / {count, plural, one {# resultado} other {# resultados}} |
| errors.search.invalid / errors.search.regex / errors.search.too_large / errors.search.changed / errors.search.unavailable / errors.search.index_limit / errors.search.denied / errors.search.failed | This search is not valid. / This regular expression is not supported. / This query exceeds the search limits. / Search results changed. Start again. / The search index is not available. / The index limit was reached; review indexed folders or storage. / This indexing request was not allowed. / The search could not finish. | Esta búsqueda no es válida. / Esta expresión regular no es compatible. / Esta consulta supera los límites. / Cambiaron los resultados. Vuelve a buscar. / El índice no está disponible. / Se alcanzó el límite; revisa las carpetas o el almacenamiento. / No se permitió esta solicitud. / No se pudo terminar la búsqueda. |

Filterfieldlabelkeyssearch.fieldKind/Extension/Author/Size/Width/Height/Duration/Pages/Modified/Created/DateTaken/Folder useEnglishKind/Extension/Author/Size/Width/Height/Duration/Pages/Modified/Created/Date taken/Folder andSpanishTipo/Extensión/Autor/Tamaño/Ancho/Alto/Duración/Páginas/Modificado/Creado/Fecha de captura/Carpeta. Operatorlabelssearch.opEquals/Contains/AtLeast/AtMost/All/Any/Not=>Equals/Contains/At least/At most/All/Any/Not andIgual a/Contiene/Como mínimo/Como máximo/Todos/Cualquiera/No. UIsearchbar44px;filterDialog760px;resultsreuseviewcomponents;modebuttonaccessible/disabledreason/help;AIentrydisableduntil17cproviderregistration. Commandsapp.search(Search,Ctrl+FonlywhenExplorerhasfocus),app.indexSettings(Database) nootherglobalkeys;existingeditorCtrl+Funchanged.

| Task; commit | Files/order/imports | Tests and exact oracle |
|---|---|---|
| T1 `deps: register bounded search dependencies [step-11a/T1]` | coordinatorsearch-indexCargo/features/licenserecords;workersnewcratemanifestproposal.U1/U6 | searchDependency.test:rusqlitebundledhooks/regex1.13.1pinned;noFTSloadableextensionorGPLdependency |
| T2 `feat(index): bounded roots and metadata store [step-11a/T2]` | crates/search-index/src/{types,store,scan,limits}.rs;search_index.rs;services/search.ts;schema34.U1/U2/U5 | step11a_index_tests:overlaprootsdedup;cloud0contentreads;loopguard;1M+1pause;DBbudgetincludesWAL;permissionerrorpartialnotempty |
| T3 `feat(index): incremental watchers and opt-in content [step-11a/T3]` | index_watch.rs,content_extractors.rs,search_tags.rs;U1-U3/E4/E6 | indexWatch.test/native:renamepairedidentity;overflowrescan;oneunsubleavesothertab;stalegenerationignore;OCRoff0calls;100filebudgetstop;sensitivevirtualrefused |
| T4 `feat(search): typed bounded name content and regex queries [step-11a/T4]` | query.rs,filter.rs,paging.rs,regex_scan.rs;queryParsing.ts.U4/U6/E1/E7 | step11a_query_tests:reportcontainsportat>=3;re1-2prefix;FTSoperatorsliteral;regexbackrefreject;ASTdepth5reject;cursorchangedinvalid;page256/768KiBcap |
| T5 `feat(search): accessible modes filters and saved searches [step-11a/T5]` | SearchResultsView.tsx,SearchModePicker.tsx,FilterBuilder.tsx,IndexSettings.tsx,saved_searches.rs,styles/search.css.U4/U5/E1-E3 | searchUi.test.tsx:focusedCtrlTab4modesnotMRU;askdisabled0network;typingstaleresultdiscard;savequerynotresults;all9viewmodeswithnormalopen |
| T6 `feat(index): optional scoped NTFS metadata helper [step-11a/T6]` | usn_index_helper.rs,usn_records.rs,usn_admin.rs;coordinatorWindowsfeatures.U1/U6 | step11a_usn_tests:badlength/offset/versionreject;cycledepthcap;UACdeniedfallback;helpercannotwrite/opencontents;foreignSIDpipeblocked |
| T7 `test(speed): ordinary search and application speed pass [step-11a/T7]` | writtenbenchmarkcases/searchfixtures;coordinatorscripts/actualruns.U1-U6 | 100kfolder/coldstartup/tab/searchmedians7runs;nomissedtiershidden;contentcoverageexplicit;baselinecomparison<=20%regression |
| T8 `docs(help): search modes filters and indexing privacy [step-11a/T8]` | fivehelpfilesbelow;coordinatorkeys/pseudo/registries/screenshots.U1-U6 | allqueryprefixesdocumented;en/esICUparity;normal/disabledAIhelpdistinct |

## Coordinator commit labels (workers do not commit)

- deps: register bounded search dependencies [step-11a/T1]
- feat(index): bounded roots and metadata store [step-11a/T2]
- feat(index): incremental watchers and opt-in content [step-11a/T3]
- feat(search): typed bounded name content and regex queries [step-11a/T4]
- feat(search): accessible modes filters and saved searches [step-11a/T5]
- feat(index): optional scoped NTFS metadata helper [step-11a/T6]
- test(speed): ordinary search and application speed pass [step-11a/T7]
- docs(help): search modes filters and indexing privacy [step-11a/T8]

## Required handoff

Return `handoff/step-11a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-11a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
