# Coding assignment: step 11b — Tags, smart folders, views

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-11b.md](../steps/step-11b.md). Guide SHA-256: `ef14d0675b3c7ceb6bf1a83f433364075ff60a34903e6ef435c083b2e30f76e3`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-11b-tags-smart-views |
| Tag | v0.2.2-step11b |
| Depends on | 07a identity;07b metadata;09f identity effects;10e shell sections;11a search-index-1 |
| Written before | 07a was built |
| Interface revision | tags-1; smart-views-1; map-tiles-1 |

Settings reservation: 34 -> 35; screenshot reservations: 134-137. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07a producer guide](../steps/step-07a.md)
- [Step 08c producer guide](../steps/step-08c.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09e producer guide](../steps/step-09e.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 10a producer guide](../steps/step-10a.md)
- [Step 10c producer guide](../steps/step-10c.md)
- [Step 10d producer guide](../steps/step-10d.md)
- [Step 10e producer guide](../steps/step-10e.md)
- [Step 10f producer guide](../steps/step-10f.md)
- [Step 11a producer guide](../steps/step-11a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Goal, exclusions and read first

Tag files/folders, manage tags with Undo, save live smart folders, and browse Timeline/Calendar/By kind/Recent activity plus an explicit-online optional photo map. No AI organizing, natural-language/photo-content search, cloud sync, backgroundmapdownloads or reading other apps’ activity. Read mapped v1 step11b,full11a/10e/10d/09f contracts,currentExplorerItem andidentitystore/metadatahelpers,searchpaging/rootauthorization,FileList/ItemView/NavPane/HomePage,allmandatoryfile-safety/privacyrules.

| ID | Producer/task; canonical export | Exact use |
|---|---|---|
| U1 | 07a E9 services/fileIdentity.ts FileIdentityKey/readFileIdentity | Stablevolume8hex/file16hex pluspath_key/stablebool;do not infer volume fromExplorerItem.file_id |
| U2 | 09f E8 IdentityEffect/subscribeIdentityEffects;09e completedrenameeffects | Followonlynativeguardedcompleteeffects;copyinheritswithoutremovingsource;movechangeskeyafterverifiedpublication. Unprovencaseleavesrecordwithwarning |
| U3 | 11a E1/E3 SearchQuery/SearchPage/search/searchPage/SavedSearch | Smartfolderisthesamequery;allviewsusepagednativequeriesandnormalfileopening,notfakesources |
| U4 | 11a E6 TagSearchUpdate/apply_tag_search_updates | TagStoreemitsdurablemembershipmirrorupdatesinbatches256;revisionrejectsstaleupdates;searchtagsfilterusescanonicalAST |
| U5 | 10e E1/E2 HomeSectionRegistry/NavigationRegistry;10a E4contrast;10fAccessibility | Registertagged_files/tags/viewswithoutrootfork;colorsalsohavevisiblelabels/icons/patterns |
| U6 | 10c E5 ProfileRoot;09a E9 UiHistoryRegistry;07aBackgroundPolicy | Perprofileboundedmetadata/history;atomicappstateUndo;nogeotag/cloudreadsoutsideallowedpolicy |
| U7 | 08c E5 XmpEdit/rewrite_xmp;08aownedpublication/ConversionReport | OptionalembeddedkeywordsuseverifiedXMPnamespaceadapter,notimaginedlittle_exifXPKeywordsAPI. Existingtargetwritesremaincapabilitygated |

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; commit | Files/work/dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(tags): bounded identity-keyed tag store [step-11b/T1]` | tags.ts,tag_types.rs,tag_store.rs,tag_transactions.rs;schema35.U1/U4/U6 | step11b_tags_tests:7defaultsUUIDstable;1001cataloglimit;duplicatecasefoldname;cloud0contentreads;batch1Undo;historycapacitybeforewrite |
| T2 `feat(tags): verified move copy and search integration [step-11b/T2]` | tag_identity_effects.rs,tag_search_bridge.rs,TagPicker.tsx,TagManager.tsx;U1-U5/E1/E2 | tags.test.ts:crossvolumemovechangesexactkey;copykeepssource;unprovedreceiptignored;staleindexrevisionignored;hardlinkstableidentitysame;Ctrl1stilltab |
| T3 `feat(tags): safe tag exchange and embedded copies [step-11b/T3]` | tag_transfer.rs,tag_xmp.rs,TagImportDialog.tsx;U7/E3 | tagTransfer.test/native:defaultnofilepaths;importidentitymismatchrefused;XMPunknownnamespacepreserved;pixelhashunchanged;existingwriteunavailable0writes;copypublishedpathrecorded |
| T4 `feat(views): smart folders timeline calendar and kinds [step-11b/T4]` | smartViews.ts,smart_folders.rs,indexed_views.rs,SmartFolderView.tsx,TimelineView.tsx,CalendarView.tsx,ByKindView.tsx;U3/U5/E4 | smartViews.test.tsx:querysameSearchQuery;cannotpasteintoquery;localmonthboundary;missingdateundated;Calendar6x7;cancelstaleresults;Nav/Homeproviderregistration |
| T5 `feat(activity): bounded local activity view [step-11b/T5]` | activity.rs,RecentActivityView.tsx,activityProviders.ts;U5/U6/E5 | activity.test.ts:onlysuccessfulappactions;lockedcontentexcluded;1001dropsoldest;older30daysexcluded;Pause0new;Cleardoesnotdeletefiles |
| T6 `feat(map): explicit online geotagged photo view [step-11b/T6]` | mapTiles.ts,map_tiles.rs,geo_points.rs,MapView.tsx,mapProjection.ts,styles/indexedViews.css;U2/U5/U6/E6 | map.test.ts/native:disabled0network;lat0/lon0/z0=>128,128;latitudeclamp;invalidxydeny;2requestsmax;closeabort;attributionalwaysvisible;7daycachefallback;foreignredirectdeny |
| T7 `docs(help): tags smart folders and indexed views [step-11b/T7]` | helpbelow;coordinatorkeys/pseudo/registries/speed/shots.U1-U7 | allscopepagesexist;ICU/keyparity;allnewviewsAT/highcontrast/300%;noAIorganizingentry |

## Coordinator commit labels (workers do not commit)

- feat(tags): bounded identity-keyed tag store [step-11b/T1]
- feat(tags): verified move copy and search integration [step-11b/T2]
- feat(tags): safe tag exchange and embedded copies [step-11b/T3]
- feat(views): smart folders timeline calendar and kinds [step-11b/T4]
- feat(activity): bounded local activity view [step-11b/T5]
- feat(map): explicit online geotagged photo view [step-11b/T6]
- docs(help): tags smart folders and indexed views [step-11b/T7]

## Required handoff

Return `handoff/step-11b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-11b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
