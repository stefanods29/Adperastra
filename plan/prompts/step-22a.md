# Coding assignment: step 22a — PowerPoint-style editing

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-22a.md](../steps/step-22a.md). Guide SHA-256: `9509d67dcaeef000d7143a5e850183a00bf0f38ef36252625aa443fd0dec8912`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty |5/5 |
| Branch |step-22a-presentation-editor |
| Reserved tag |v0.5.10-step22a |
| Depends on |20a office-edit-1;09a documents;09c transfer;13 read-only Office;08a snapshots;09h recovery |
| Written before |07a was built |
| Contract revision |office-deck-ui-1; deterministic deck UI;21b included independently |

Settings reservation: 54 -> 55; screenshot reservations: 196-198. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 07d producer guide](../steps/step-07d.md)
- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 09c producer guide](../steps/step-09c.md)
- [Step 09f producer guide](../steps/step-09f.md)
- [Step 09h producer guide](../steps/step-09h.md)
- [Step 12b producer guide](../steps/step-12b.md)
- [Step 13 producer guide](../steps/step-13.md)
- [Step 15 producer guide](../steps/step-15.md)
- [Step 16 producer guide](../steps/step-16.md)
- [Step 20a producer guide](../steps/step-20a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Dependencies and exact exports

| Ref | Producer; canonical export | Exact use |
|---|---|---|
| U1 |20a E1/E3-E11/E18/E24,office/types.ts,officeEdit.ts,OfficeController,src-tauri/src/office_edit_leases.rs | DeckTheme/Layout/Shape/Patch/Transition/Animation,OfficeRect,OfficeSelection/State/Viewport/Transaction; typedoperations/capabilities/render/items/capture/export. Samegeometry/mastercontractsused22b. |
| U2 |09a controller.ts/DocumentRegistry/DocumentHandle | registerOfficeControllerFactory('office-slide','deck') bridge; reference-countedoneeditablemodel, notifyContentChangedoncepermutation;captureencodedcurrentrevision/content_id. |
| U3 |09c E1/E2 TransferRegistry/TransferPayload | target `office-deck:<document_id>`; text/rich_text/cells/image/pdf_pages; PDFpages becomeexplicitimages; token/source/sensitivevalidation/lossconfirmation andatomicreceipt. |
| U4 |13 E5/E6 office-slide/OfficePresenter;12b engineTypes.OfficeFormat | Read-onlyfallback;16:9notassumedforimportedslides;actualenginepreservationlimits. |
| U5 |08a snapshots/09f publication/06b versions/09h recovery | Currentrevisionexports,safeownedoutput/version/identitychecks, encryptedproviderrecovery; noenginewritesourcepath. |
| U6 |07d E7 start_webview_helper/WebviewHelperSession.update_inputs/request/close,kind presentation and typed envelopes;baseline commands/ribbon/layout | Newtrustedreadonlypresentationentryusesstaticconfig; no independentunboundedhelperframework. ExistingCommandRegistry/RibbonDef/ToolbarDockhandleUI. |

20a already defines the required DeckOperation variants in itscanonicaldeckOperations module: insert_text {slide_id UUID,shape_id UUID,position TextPosition,text<=1Mi scalars}; delete_text {slide_id,shape_id,span TextSpan}; format_text {slide_id,shape_id,span,patch TextFormatPatch}. The live textspanmustbelongtothattextshape. NewlinecreatesaDeckTextParagraphwithauniqueUUID;enginecontrollerownsparagraphIDs. Import these existing20a variants unchanged; do not define another union.

Canonical `src/office/deck/deckUiTypes.ts`: DeckEditorViewState slide_id UUID|null,selection OfficeSelection deck|null,viewport OfficeViewport,active_ribbon_tab oneoftentabIDsbelow,notes_open booltrue,slides_open booltrue,comments_open boolfalse,snap boolfalse. DeckEditorProps document DocumentHandle,active bool,savedState DeckEditorViewState|null,onStateChange(state)->void,onStatus(FileTabStatus)->void,onOpenHelp(slug)->void,previewOnly boolfalse. DeckCommandContext controller,state,selection,view,openDialog(id DeckDialogId)->void;dialogIDs shape/image/table/chart/layout/theme/transition/animation/notes/comment/pageSetup/export/print/properties/compatibility/present.

| Export | Exact signature and ownership |
|---|---|
| E1 `src/office/deck/DeckEditor.tsx` DeckEditor | DeckEditorProps; normal/virtualadaptersforwardactualDocumentHandle. |
| E2 `deckCommands.ts` registerDeckCommands;`deckRibbon.ts` deckRibbon | registerDeckCommands(CommandRegistry<DeckCommandContext>)->void;deckRibbon()->RibbonDef;tentalabels/groupsbelow. |
| E3 `deckTransfer.ts` deckTransferTarget | (controller OfficeController)->TransferTarget; oneaccept->oneDeckOperationtransaction. Textatcurrenttextbox;otherwisecreatesatextshape;cells->real table;image->shape;PDFpageimagescapturefirst,bounded100pages/lossack. |
| E4 `deckViewState.ts` deckViewStateCodec |09a version1boundedstateencoder/decoder;clampzoom10-400/viewport,validateknownslide,stripnotes/content/tokens. |
| E5 `src/services/presentation.ts` presentationDisplays/startPresentation/presentationNavigate/endPresentation | displays()->Promise<PresentationDisplay[]>;start(sessionId:string,request:PresentationRequest)->Promise<PresentationState>;navigate(presentationId:string,intent:PresentationIntent)->Promise<PresentationState>;end(id)->Promise<void>. Native office_presentation_displays/start/navigate/end, main-only. |
| E6 `deckThemes.ts` applyDeckTheme | (controller OfficeController,theme DeckTheme,slideIds readonlystring[]|null)->Promise<OfficeTransactionResult>; validategeometry/fonts/overflowthenoneapply_theme transaction, preserve_manual_formattingtrue.22bmustusethisexactentrypoint. |
| E7 `deckThemeImport.ts` inspectDeckTemplate/importDeckTheme | inspect(input ConversionInput)->Promise<JobHandle<DeckTemplateInspection>>;import(inspectionId:string,themeId:string,name:string,fontMappings:readonlyOfficeFontMapping[])->Promise<DeckTheme>. Inspection {inspection_id UUID,themes DeckTheme[]<=32,warnings string[]<=32,source_revision number,expires_unix safeu64}; helper usesapprovedbindingonly, noremote/customcode. Forwards20a E15 services/officeDeck.ts; all inspection/font-mapping types are imported there, not duplicated.22bconsumer. |

Presentation types are imported from20a presentationTypes.ts/E16; the following recaps exact fields, not a second definition. PresentationDisplay idstring<=128,nameescaped<=128,rect{left,top,width,height i32physicalpixels},primarybool;monitorIDsareopaqueandnevercommandtext. PresentationRequest slide_idUUID,start_from first/current,output_display_idstring,presenter_display_idnullable string,show_presenterbool;revalidateIDsatstart. PresentationState presentation_idUUID,session_idUUID,slide_idUUID,slide_indexu32,slide_countu32,step_indexu32,elapsed_ms safeu64,pausedbool,blackbool,endedbool,output_display_idstring. PresentationIntent tagged next/previous/first/last/end/toggle_black/toggle_pause/reset_timer/go_to{slide_idUUID}. Onlyendedsessioncannotnavigate;duplicateend succeeds.

20a E15/E16 binding methods already frozen: presentation_start(session_id,slide_id)->BindingPresentation;presentation_step(binding_presentation_id,intent)->BindingPresentationFrame;presentation_end(id)->unit;inspect_template(authorizedinput)->DeckTemplateInspection;extract_theme(inspection_id,theme_id,name,font_mappings)->DeckTheme. BindingPresentation idUUID,initial_slide_idUUID;BindingPresentationFrame fields are the canonical20a E16 record; image is OfficeBinaryLease released with E18, including memory-backed sensitive presentation frames. Renderedframeuploadbounded8MiB/max4,194,304px, atmost2liveframeleases, engine/helpermemorywithin20abudget; animateonlywhenprovenrendererproducesboundedframeupdateswithoutactivecontent. Usernotes/nextslideframestravelonlytopresentergrant. Do notclaimfullanimationsonstaticPDFfallback. Nativewrapperopensreadonlypresentationhelper/output,presentercontrols remainmainowned. EveryTauricommandlistedE5/E7validatesensure_main/session/capabilities/displayIDs/inputs;helpersneveracquirewritepermissions.

### Exact persistent audience helper transport

Canonical payloads live in `src/services/presentationHelperTypes.ts`, native mirror `src-tauri/src/presentation_helper_types.rs`; both import20a PresentationIntent and07d HelperRequestEnvelope/HelperReplyEnvelope/HelperGrantDTO. These are audience records only; notes/comments, presenter previews, file paths and engine handles are absent and rejected as unknown fields.

| Action/type | Exact request -> success payload |
|---|---|
| PresentationAudienceFrame | presentation_id UUID;slide_id UUID;frame_revision u32;image_grant_id UUID;width/height u32positive;black bool;paused bool. image grant is exactly one approved PNG<=8MiB/4,194,304pixels, not URL text chosen by content |
| presentation.frame | payload PresentationAudienceFrame ->PresentationFrameAck {presentation_id:UUID,frame_revision:u32,displayed:bool}. Helper waits for its granted image decode and successful canvas paint or black fill, then acknowledges exact revision; failed decode returns presentation.failed, no blank success |
| presentation.wait_intent | PresentationWaitIntentRequest {presentation_id:UUID,after_sequence:safeu64,wait_ms:u16 fixed8}->PresentationIntentReply {presentation_id:UUID,sequence:safeu64,intent:PresentationIntent|null}. Sequence starts0; each queued audience keyboard intent increments once; null reply retains last acknowledged sequence |
| presentation.end | PresentationAudienceEnd {presentation_id:UUID}->PresentationEndAck {presentation_id:UUID,ended:bool fixedtrue}; clears image/object URLs/canvas/queue and restores no file data |

Native `src-tauri/src/presentation_inputs.rs` exports prepare_audience_frame_input(session_id:Uuid,presentation_id:Uuid,frame:&BindingPresentationFrame)->Result<HelperInputGrant,String>. It first checks that the native presentation registry binds presentation_id to session_id, then calls20a E24 resolve_office_lease(session_id,frame.image.lease_id). FileGrants alone cannot prove Office lease/session ownership and is not a substitute for that resolver. Validate returned immutable backing length and sensitive policy against the authoritative OfficeBinaryLease, MIME image/png, PNG signature/header dimensions equal frame.width/height, size<=8MiB and pixels<=4,194,304 before creating the grant. Retain the Office lease until frame replacement/end; the returned Arc independently retains backing lifetime during helper reads. Create one HelperInputGrant with a fresh random grant_id UUID, name fixed frame.png, mime image/png, source HelperInputSource::Snapshot {backing:Arc<GrantedBacking>,document_id:presentation_id string,revision:frame.frame_revision asu64,content_id:frame.image.lease_id,sensitive:frame.image.storage_policy==sensitive}. PresentationAudienceFrame.image_grant_id is exactly this returned grant_id, never a guessed lease ID. These IDs describe immutable rendered frame identity; no SourceStamp/path is fabricated and no source Office bytes reach audience helper. Native20a lease registry remains authoritative; another session or revoked lease fails before input update.

22a native presentation_session.rs starts one07d session with static kind presentation,entry presentation-helper.html,placement HelperWindowPlacement::Audience with explicitly chosen/validated live display ID/physical monitor rect (child revalidates before fullscreen creation), no inputs until first frame, memory256MiB, perrequestoutput cap8MiB, no output body reservations (audience consumes input frames only). For sensitive frames complete07d private-profile proof before any tokens/bytes. Native wrapper obtains20a binding frame, prepares the single bounded grant, calls session.update_inputs, then session.request with presentation.frame. After exact frame ack it may release the prior Office lease/input; at most2live frame leases, no unbounded queue. When no new frame pending it calls presentation.wait_intent; consume reply sequence once, validate intent/session, then route through main-owned20a binding state. Unknown/replayed/malformed navigation cannot call a save/filesystem command. Parent polls at most once per16ms when idle; animations obtain/paint only latest bounded frame, never promise parity without actual binding support/performance.

Audience JS queues at most16 typed keyboard intents from arrows/PageUp/Down/Home/End/Escape/B/P; Escape maps end, B toggle_black,P toggle_pause. No text/notes/current-document controls enter this queue. Full queue coalesces duplicate adjacent next/previous only, otherwise drops newest repeat and keeps Escape/end by removing the newest non-end entry; sequence is assigned only to retained events. Only one host request active; frame/end requests finish before another wait. Waiting expires8ms with null intent; feature request deadline2s, update deadline2s from07d; cancel/window close/display loss closes session and releases both frame leases. Parent handles display relocation/pause and notes UI; audience receives only its current rendered frame and black/paused flags. Presenter notes/next-slide data never share the audience helper input registry or envelopes. Trusted helper exposes only07d helper_reply and packaged static assets.

T7 creates presentation_helper_types.rs,presentation_inputs.rs,src/services/presentationHelperTypes.ts,src/presentation-helper/{main,frames,intents}.ts and native presentation_helper_step22a_tests.rs. Exact tests: frame_after_update_has_matching_grant; office_lease_from_other_session_refused_before_update; revoked_office_lease_refused; png_header_must_match_frame_dimensions; fresh_grant_id_independent_of_office_lease; one_shot_runner_not_used; old_frame_lease_released_after_ack; max_two_frame_leases; notes_field_rejected_from_audience_payload; audience_registry_never_gets_next_slide_or_notes; repeated_intent_sequence_applies_once; queue16_keeps_end; private_preflight_before_sensitive_frame; cancelled_input_update_releases_both_frames; unknown_parent_command_refused. Native transport/policy fakes do not count as real dual-monitor/frame performance or sensitive disk-leak evidence.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files/work and dependency rows | Tests and oracle |
|---|---|---|
| T1; `feat(deck): shared presentation controller and state [step-22a/T1]` | deckUiTypes.ts,deckViewState.ts,deckController.ts;U1/U2/U4,20aextensionsandcanonicalhandlerupgrade. | deckController.test.tsonecontroller/twoviews;protectedviewmutationdenied;no21bdependency;unknownstate/tokensstripped;schema54 -> 55preservespriorprefs. |
| T2; `feat(deck): slide canvas thumbnails and notes [step-22a/T2]` | DeckEditor.tsx,SlideStrip.tsx,SlideCanvas.tsx,SlideNotes.tsx,deckCoordinates.ts;U1/U2. | deckCanvas.test.tsxscreen96pxat100%=>72pt;720x405aspect16/9;dragcancel0transactions;10000slidesvirtualized;notesneverpartofoutputalttext;reorderoneUndo. |
| T3; `feat(deck): ten-tab ribbon header and backstage [step-22a/T3]` | deckCommands.ts,deckRibbon.ts,DeckHeader.tsx,DeckBackstage.tsx,styles/office-deck.css;U1/U6. | deckRibbon.test.tsx10tabsordered;missingcapabilitydisabled;allfourribbondocks/keyboard;FileEscfocus;Sharelocalonly;mixedtextformatnotdefaulted. |
| T4; `feat(deck): shapes text tables charts and transfers [step-22a/T4]` | DeckShapeTools.tsx,DeckTextControls.tsx,DeckInsertDialogs.tsx,deckTransfer.ts;U1/U3. | deckShapes.test.tsxfirstshapeUUIDowned;imageimmutable;tabletypedcellsformula-likeinert;onepasteonetransaction;groupdepth17refused;resizeNaN/outsidecapsfails;copydoesnotdiscardoriginaledits. |
| T5; `feat(deck): masters layouts and theme application [step-22a/T5]` | DeckLayoutPicker.tsx,DeckMasterEditor.tsx,deckThemes.ts,deckThemeImport.ts;U1/E6/E7. | themechangeoneUndo;unmatchedshapepreserved;overflowcancelunchanged;invalidlayoutduplicateUUIDrefused;templateexternalmediarefused;manualformattingretained;style22bimportswithoutprivatelocals. |
| T6; `feat(deck): transitions animations and review [step-22a/T6]` | DeckTransitions.tsx,DeckAnimations.tsx,DeckComments.tsx;U1. | unsupportedanimationpreservedroundtrip;fade500msstoredexactly;selectedslideeffectdoesnotchangeothers;deletecommentconfirm;staleeffectIDrejected;noactivecontentexecution. |
| T7; `feat(present): display-aware presentation and presenter view [step-22a/T7]` | services/presentation.ts,presentation.rs,presentation_displays.rs,presentation_session.rs,PresentationControls.tsx,presentation-helper.html,src/presentation-helper/{main,frames,intents}.ts;presentation_helper_types.rs,presentation_inputs.rs,src/services/presentationHelperTypes.ts;U1/U6,staticboundedhelper. | presentation.test.tsxdisplaynegativeoriginvalid;disconnectpauses;Escends/restoresfocus;nextstepbeforenextslide;hiddenexcluded;notesneveronoutput;endtwiceworks;helpercannotinvokesave;noarbitrarydisplayIDcommand. |
| T8; `feat(deck): safe exports recovery and fidelity cases [step-22a/T8]` | deckExport.ts,deckRecovery.ts,DeckExportDialog.tsx;U2/U5. | capturedunsavedcontentexported;saveR/editR+1staysdirty;failedexportnoforeignoverwrite;allimageshaveactualreportpaths;unknownparts/masters/notes/effectsurvive; sensitiveplaintextneverwritten. |
| T9; `docs(help): editing and presenting slides [step-22a/T9]` | Fullbilingualhelpbelow;coordinator48/settings/pseudo/handler/IPC/measurements/shots. | deckHelp.test.tsallkeys/10tabcommands/help;keyboard/en/esdark/pseudo/200%zoom;non-AIfallbackclaimhonest. |

Nativehelper/display/bindingtestsbelongnewmodulenative tests;UItestsunder`src/__tests__/`. Allsourcefilesunder400lines;splithelperlogicintoframes/state/modulesbeforelimit,usingthefixedpathsabove. Coordinatorreturnsexactsharedwiringratherthanworkerseditinganotherstream.

## Coordinator commit labels (workers do not commit)

- feat(deck): shared presentation controller and state [step-22a/T1]
- feat(deck): slide canvas thumbnails and notes [step-22a/T2]
- feat(deck): ten-tab ribbon header and backstage [step-22a/T3]
- feat(deck): shapes text tables charts and transfers [step-22a/T4]
- feat(deck): masters layouts and theme application [step-22a/T5]
- feat(deck): transitions animations and review [step-22a/T6]
- feat(present): display-aware presentation and presenter view [step-22a/T7]
- feat(deck): safe exports recovery and fidelity cases [step-22a/T8]
- docs(help): editing and presenting slides [step-22a/T9]

## Required handoff

Return `handoff/step-22a/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-22a/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.
