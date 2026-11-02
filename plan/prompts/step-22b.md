# Coding assignment: step 22b — AI for decks and the style library (v1.0)

You are the implementation worker for this single Adperastra step. The coordinator has already written your complete guide; write the code and tests from it. Do not write your own guide, redesign another step, or continue to the next step.

Adperastra is a Windows11 MIT file explorer using Rust/Tauri2 and React/TypeScript. Read AGENTS.md and the owner decisions in plan/STATUS.md, plus rules/conventions/pitfalls/libraries/contracts. The owner's specific parallel workflow applies: **you write code/tests; the coordinator executes all checks and integrates**. No compiling, test execution, package manager, install, lockfile changes, formatting, generators, app launch, benchmark, screenshot, download or API request. Use file-reading and file-writing tools only for this assignment. Do not commit/merge/push/tag/release or read private signing-key storage.

Read plan/parallel/OWNERSHIP.md and WORKER-PROMPT.md. Use a separate writable checkout prepared for you. If you have only a shared writable checkout, return proposed new file contents/patches instead of editing it. Existing baseline files, shared declarations/registries and earlier producers' files are coordinator-owned; return exact proposed edits for them. Create only new feature files/tests/help/styles assigned to this step. A shortened path resolves through the guide's canonical definition, never a guessed directory. Locale JSON additions, pseudo-locale, manifests/lockfiles, root wiring and plan updates are coordinator proposals.

Read the **entire** linked guide, including amendments after Done when, before coding. The copied sections below aid navigation; the guide and its producer definitions remain authoritative. Use exact function/variable/type names, canonical definition files, parameters, return/error shapes, units, bounds and ownership. Import public exports; do not reach into a provider's private variables or duplicate canonical types. An unfinished producer may be imported against its specified contract; no production stub or fake success. Later extensions to a shared enum/method are proposals to its owner, not a replacement module.

For a mismatch, cite the two precise symbols/guide locations and continue only independent tasks. Do not guess an API or weaken a rule/test. Real OWNER CHECKPOINTS and artifact/evidence gates stay open; do not invent approval, pack hashes, keys, benchmark numbers or unsupported capabilities.

## Your exact inputs

Complete guide: [plan/steps/step-22b.md](../steps/step-22b.md). Guide SHA-256: `a8ecc6a8bfdb3dae19f80836efa96959c7a7bf8bf29ae7c2c93166c05244b1d4`. Source baseline: `0154c69b3ea5afbfadc39ffa8ee2637733396348`. Packet revision: `parallel-guides-2026-11-02`. Compare with [GUIDE-MANIFEST.json](../parallel/GUIDE-MANIFEST.json) using file reading or ask coordinator; do not run a command to do so.

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty |5/5 |
| Branch |step-22b-ai-decks-styles |
| Original reserved milestone |v1.0.0; reserved until real evaluations, verification and owner publication approval |
| Depends on |22a E6/E7;20a Office proposal/draft boundary;17a provider/schema/evaluation;09a UI history;08a snapshots |
| Written before |07a was built |
| Contract revision |deck-style-library-1;office-deck-ui-1;office-edit-1 |

Settings reservation: 55 -> 56; screenshot reservations: 199-202. These are future integration values, not today's application state. Coordinator owns their updates.

## Producer guides to read

- [Step 08a producer guide](../steps/step-08a.md)
- [Step 09a producer guide](../steps/step-09a.md)
- [Step 20a producer guide](../steps/step-20a.md)
- [Step 22a producer guide](../steps/step-22a.md)

Also read every baseline file and producer task named in the exact Uses section; the list above contains earlier-step references only and is a navigation aid, not a substitute. Later-step references in a producer guide reserve additive extensions; they do not reverse the integration order. Producer data/Exports fix full shapes. For a type extension, use the latest additive definition across the producer's full guide and record the extension in your handoff.

## Uses and exact exports

| Ref | Producer; canonical definition | Exact use |
|---|---|---|
| U1 |20a E1 office/types.ts | DeckTheme/DeckLayout/OfficeRect/OfficeFont/TextFormat/ParagraphFormat; samefieldnames/pointgeometry/colorvalues, no privatecopyofmastertypes. |
| U2 |22a E6 deckThemes.ts applyDeckTheme(controller,theme,slideIds|null)->Promise<OfficeTransactionResult> | One atomic validatedthemechange,preserve_manual_formattingtrue,livecapability/revision checks,overflowreview; nativeenginepreservesunknowncontent. |
| U3 |22a E7 deckThemeImport.ts inspectDeckTemplate(input ConversionInput)->Promise<JobHandle<DeckTemplateInspection>>;importDeckTheme(inspectionId,themeId,name,fontMappings)->Promise<DeckTheme> | Isolatedapprovedtemplateinspection/import; boundinspection ID/source revision/expiry; no fileformatguess. POTX/OTPinspection support is anadditiveOfficeFormatextensionin12bcanonicalengineTypes,notaneweditablehandlerclaim. |
| U4 |09a E9 services/uiHistory.ts UiHistoryRegistry | registerAdapter/record/apply/releaseUnreferenced;catalogadaptervalidates4MiBstatesandpre-reserveshistorybeforemutation. Failureleavescatalog/cursorunchanged. |
| U5 |08a ExportSnapshot/ConversionInput and09f ownedfilepublication | Safe stylefileimport/exportandcatalogatomicwrites;neverreuseuserprovideddeletepath. |
| U6 |22a DeckEditor/DeckCommandContext/deckRibbon;baselineCommandRegistry/RibbonDef | WireDesign>Stylelibrarytoownedpanel;statictrustedregistration,keyboardmode/dirtydocumentownershipunchanged. |

Canonical `src/office/deck/styles/styleTypes.ts`,nativemirror`src-tauri/src/deck_style_types.rs`. DeckStyle fields idUUID,builtinbool,name_key nullablei18nkey forbuiltins,name nullableuserstringforimports,description_key nullablekey,themeDeckTheme,densitycomfortable/compact,guidance{max_bulletsu81-10,max_words_per_bulletu81-30,advice_key nullablekey},created_unix/modified_unixsafeu64(0builtins),versionu32fixed1. Exactlyoneofname_key/name;styleid=theme.id;stylenamesarenevercomponentCSSclasssuffixes. DeckStyleCatalog schema_version1,styles DeckStyle[]useronly,revision safeu64;builtinsprovidedseparatelybyconstantregistry.

| Export | Exact signature and lifetime |
|---|---|
| E1 `styles/builtins.ts` BUILTIN_DECK_STYLES | readonly DeckStyle[8] in fixedtableorderbelow;deepfrozenappdata, not editablecatalogrecords. |
| E2 `src/services/deckStyles.ts` listDeckStyles/saveDeckStyle/removeDeckStyle | list()->Promise<DeckStyleCatalog>;save(style:DeckStyle,expectedRevision:number)->Promise<DeckStyleCatalog>;remove(id:string,expectedRevision:number)->Promise<DeckStyleCatalog>. Native deck_styles_list/save/remove validatesmainwindow,sourcecatalogrevision andbuiltinfalse;saveonlynormalizedapprovedtheme/noengineobjects. |
| E3 `styles/DeckStyleLibrary.tsx` DeckStyleLibrary | props controllerOfficeController,selectedSlideIdsreadonlystring[],onClose()->void,onOpenHelp(slug)->void;scopecontrolledwithinpaneldefaultwhole;noarbitrarydocumentpathprop. |
| E4 `styles/styleApplication.ts` prepareDeckStyle/applyDeckStyle | prepare(controller,style:DeckStyle,scopeIds:readonlystring[]|null)->Promise<DeckStylePreview>;apply(controller,preview:DeckStylePreview)->Promise<OfficeTransactionResult>. Preview idUUID,style_idUUID,themeDeckTheme,expected_revisionnumber,slide_idsnullableUUID[],warningsStyleWarning[]<=32,expires_unixnow+300. Nativeauthoritativepreviewrecordbindsallfields;UIcannotforgewarningapproval. |
| E5 `styles/styleImport.ts` importTemplateStyle/importStyleFile/exportStyleFile | importTemplateStyle(inspectionId:string,themeId:string,name:string,fontMap:readonlyStyleFontMapping[])->Promise<DeckStyle>;font mapping {from_family:string<=128,to_asset_id:inter-regular/inter-bold}; convert explicitly to20a OfficeFontMapping with the declared licensed Inter OfficeFont,explicitlyconfirmed. importStyleFile(input:ConversionInput)->Promise<DeckStyle>;exportStyleFile(styleId:string,destPath:string)->Promise<void> usesnativeownednewfile. Catalogsaveisexplicitseparateactionafterpreview. |
| E6 `styles/styleValidation.ts` validateDeckStyle | (input:unknown)->DeckStyle or stabledeck_style.invalid/too_large/font_missing/unsupported/schema_newer/changed/history_full. Unknownacceptedonlyatvalidationboundary;publicstylepayloadsarefullytyped. Noclassinstance/prototypekeys/functions/URLs/code. |

Every StyleWarning has id UUID and is tagged kind font_missing{asset_id},font_mapped{from_family,to_asset_id},overflow{slide_id,shape_id},manual_format_preserved{slide_id},template_content_omitted{};all stabletranslatedkeys. Nativecommandsdeck_style_prepare(requestcontroller/session/styleID/scope),deck_style_apply(preview_id,acknowledgedwarningIDs),deck_style_import_start(request_id,input,name,font_map),deck_style_file_import_start,deck_style_file_export_start areexactmain-onlyIPC;startjobsreturnunitanduseexistingjob_poll/cancel. ServiceE4/E5wrapjobswherelong;fixedsignaturesaboveawaitjobcompletion,neverreturneitherjoborvaluebasedonruntime. Applyuses22a engine transaction;stylefilesandcatalogupdatesdo notmodifydocumentunlessuserchoosesApply.

## Exact task and file allocation from your guide

Write the tasks in order within this step; other workers may implement other steps at the same time. Read their public contract, never depend on their private local variables. The tasks below describe all required behavior/tests, but direct edits to shared/existing files become coordinator proposals under OWNERSHIP.md.

## Tasks

| Task; exact commit | Files/work and dependencies | Tests and exact oracle |
|---|---|---|
|T1;`feat(styles): fixed manual deck style contracts [step-22b/T1]`|styleTypes.ts,styleValidation.ts,nativedeck_style_types.rs;U1/U3;alllimits/IDs/schemas/fonts.|deckStyleValidation.test.ts8builtins/64layouts/uniqueUUIDs;unknownkey/function/URLrefused;newerschemaretained;65thuserstylerejected;templatecontentnotserialized.|
|T2;`feat(styles): eight palettes and deterministic layouts [step-22b/T2]`|styles/builtins.ts,styleLayouts.ts,stylePalettes.ts,styleFonts.ts;U1;exacttablesandimmutablebuiltinrecords.|deckStyleBuiltins.test.tsbusiness-titleIDexact;two-columnrects36/372,width312;allrectswithin720x405;blank0placeholders;technicalbackground101820;allbody/muted contrast>=4.5;guidanceoverrunneverrewritestext.|
|T3;`feat(styles): bounded atomic user-style catalog [step-22b/T3]`|deck_styles.rs,deck_style_catalog.rs,services/deckStyles.ts,styleCatalogHistory.ts;U4/U5;atomiccatalogrevision/pre-reservedUIhistory.|styleCatalog.test.tsbuiltindeletefails;caseinsensitivenamecollisionasksnewname;source catalog revision R+1 rejects stale R;failedwritekeepscatalog;Undo/Redorestoresexactcatalog;4MiB+1refused.|
|T4;`feat(styles): previewed one-transaction style application [step-22b/T4]`|styleApplication.ts,stylePreview.ts,deck_style_application.rs;U1/U2;capturesource/scope/warningsandtypedapply.|deckStyleApply.test.ts720x405->1440x810rectx36->72;text18->36;4:3dimensionspreserved;overflowcancelnoedit;sourcechangefails;oneapplyoneUndo;manualobjects/notes/animationsunchanged.|
|T5;`feat(styles): safe template import and style exchange [step-22b/T5]`|styleImport.ts,StyleImportDialog.tsx,deck_style_import.rs,deck_style_exchange.rs;U3/U5;approvedenginepreview/noactivecontent,fontmappingexplicit,ownednewfileexport.|deckStyleImport.test.tspotx/otpacceptedonlyregisteredcapability;externalrelationships/macroexecution0;missingfontrequiresmap;templatewordsabsentcatalog;unknownschemabytehashunchanged;cancelkeepssource/catalog;foreignexistingexportnotreplaced.|
|T6;`feat(styles): accessible library cards and details [step-22b/T6]`|DeckStyleLibrary.tsx,StyleCard.tsx,StyleDetails.tsx,styles/deck-style-library.css;U6;fixedgrid/keyboard/scope/density/guidance.|deckStyleLibrary.test.tsx8nameslocalized;readonlyApplydisabled;Enteronlyfocusedeligiblecard;Spaceshowsdetails;Escfocusrestore;selectedscopeactualIDs;nocopyofactivedocumentinpreview.|
|T7;`docs(help): manual presentation styles and imports [step-22b/T7]`|Fullhelpbelow;coordinatorkeys/pseudo/commandregistration/measurements/shots.|deckStyleHelp.test.tsall8styles/8layouts/bilingualguidance;manual style actions work with AI disabled; original v1.0 not marked complete until all acceptance evidence exists;handedoffchecksnotfalselyreportedrun.|

UItestsunder`src/__tests__/`;nativecatalog/import/securitytestsbesidenewmodules;productionhelpersuseapproved20a bindingonly. Sourcesstayunder400lines;builtinsdatafactorymustusefixedtablevalues,notinventruntimepalettegeneration. No newfontdownloadfromcodingworker;coordinatorprovisionsdeclaredassetsandnotices.

## AI tasks after manual T7

| Task; Files; dependencies | Numbered work | Named tests; input → oracle | Exact commit |
|---|---|---|---|
| T8; deckAiTypes.ts,office_deck_ai_types.rs,deckAiSettings.ts;AU1/AU3/AU4/AU5 | 1.DefineAItypes/schemas/limits. 2.Schema55→56defaults. 3.Registerdeck.outline.v1andalltrustedpromptIDs. 4.Addcompletekeys/pseudo. | deckAiTypes.test.ts `deck_ai_defaults_off`:false/empty; `deck_outline_no_geometry`:modelx/y/XMLrefused; `deck_outline_limit`:31slidesrefused; `deck_style_allowlist`:unknownstyleUUIDrefused | `feat(ai-deck): typed outline and provider contracts [step-22b/T8]` |
| T9; assets/ai/prompts/deck,deckAiPromptSelection.ts;AU3/AU5 | 1.Write3-5examples/action/style/languagefromfixedtables. 2.Includestylelimits/realavailablelayoutsandprotectedfacts. 3.Sourcearguments trustsource,neverinstructions. 4.Version/hashesretained. | deckAiPrompts.test.ts `deck_prompt_8x2`:eightstylesbothlanguages; `deck_prompt_examples_bound`:each3-5; `deck_prompt_technical_units`:512MiBpreserved; `deck_prompt_injection_source`:sourcecannotregisterprompt | `feat(ai-deck): bilingual examples for eight styles [step-22b/T9]` |
| T10; services/deckAi.ts,deckAiSources.ts,deckAiGeneration.ts;AU1/AU4/AU5/AU6 | 1.Capturecurrentselectedsources/anchors. 2.Prepareselectedbackendpayload. 3.APIpreview/Sendonlyexplicit. 4.Validateoutline/facts/allowlists. 5.Cancel/releasestalejobs;nocontentlogs. | deckAiGeneration.test.ts `deck_api_send_gate`:0requestswithoutconsent; `deck_api_sensitive_refused`:0network; `deck_source_unsaved`:currentcaptureused; `deck_invented_citation`:unknownsourceIDrefused; `deck_no_cloud_fallback`:localfailure0APIrequests | `feat(ai-deck): consented source-grounded outline generation [step-22b/T10]` |
| T11; outlinePlacement.ts,deckAiLayoutValidation.ts,deckAiDraft.ts;AU1/AU2/AU3 | 1.Maplayoutkindtorealstylelayout. 2.NativecreateE23draftforcreate. 3.Buildadd_slide_with_id/add_shape/set_notes/apply_layouttypedoperations. 4.E21cloneactualrender/overflow. 5.Keepnewdraftunsaved/sourceunchanged. | deckAiPlacement.test.ts `outline_uses_real_layout`:title_bodybusinessrectmatchesmanualtable; `outline_model_never_draws`:noimageusedasfullslide; `outline_overflow_blocks`:actualoverflowcan_applyfalse; `draft_no_overwrite`:sourcebytesunchanged; `outline_blank_empty`:blank0hiddenplaceholders | `feat(ai-deck): real layout placement and draft clone preview [step-22b/T11]` |
| T12; deckAiAcceptance.ts,deckAiLifetime.ts,deckAiProtectedFacts.ts;AU1/AU2/AU3 | 1.Revalidateprotectedfacts/scope/revision/content. 2.SeparateE22humanAcceptfromoutboundSend. 3.Oneatomictransaction/Undo. 4.Styleproposalrequiresmanualapplyreview. 5.Cancel/expiryreleasepreviewsbutretainuserediteddraftviaunsavedpolicy. | deckAiAcceptance.test.ts `deck_accept_one_undo`:30slidesoneUndo; `deck_source_changed`:R+1rejects0effects; `deck_notes_only`:notesactionvisualtexthashsame; `deck_shorten_selected_only`:otherslidesunchanged; `deck_style_one_undo`:stylechangereversible; `deck_human_grant_required`:assistantcannotapply | `feat(ai-deck): explicit atomic draft and slide acceptance [step-22b/T12]` |
| T13; DeckAiPanel.tsx,DeckAiOutlineEditor.tsx,DeckAiPreview.tsx,DeckAiWarnings.tsx,src/styles/deck-ai.css;AU1/AU3/AU4 | 1.Buildpanel/outlineedit/reorder/actualpreview. 2.Wire6commands/ribbon. 3.Editinvalidatespreviewandpayloadconsentifsourcechanges. 4.Showtier/style/Experimentalstates. 5.Focus/keyboard/announcementrules. | deckAiPanel.test.tsx `deck_six_actions`:alltranslated; `deck_outline_keyboard_reorder`:AltDownmoves1→2andannounces; `deck_edit_requires_new_preview`:Acceptdisabled; `deck_send_not_accept`:Send0mutations; `deck_no_focus_steal`:resultarrivalretainsactiveinput | `feat(ai-deck): accessible outline and draft review [step-22b/T13]` |
| T14; tests/fixtures/ai/decks,tests/ai/suites/deckEvaluation.ts,docs/ai/deck-tuning-protocol.md;AU5 | 1.Add10EN+10ESsourcecasesperstyle=160createdecks,plus20cases/action/languageforadd/shorten/notes/layout/style. 2.Require100%schema/layout/font/license/safeopchecks; actualoverflow0accepted,protectedfacts100%,imageautodownload0; blindhumanstylefit≥4/5eachstyle/language,groundedness≥95%,readability≥4/5,Spanishdrop≤0.25points. 3.A/Bpromptrevisionssamecorpus/hardware/seeds. 4.Recordrealfailureanalysis;LoRAprotocolonlyifneeded/legal/explicitrights/costapproval,trainoutsideappGit,noautotraining. 5.FailingqualityExperimental/off;safetyblocksaction. | deckEvaluation.test.ts `deck_all_styles_required`:missing1of16language/stylegroupsfails; `deck_overflow_zero_tolerance`:oneacceptedoverflowfails; `deck_protected_facts`:120→12fails; `deck_tuning_no_weights_git`:artifactmanifestrejectsrepositoryweightpath; `deck_eval_pending`:noscoresuntilactualrun | `test(ai-deck): bilingual style quality and legal tuning protocol [step-22b/T14]` |
| T15; fullhelpbelow,manualhelpupdates,commands/settings/helpcatalog/measurements/shots/releasechecklist;AU1-AU6 | 1.AddAIhelpandfixmanualhelpclaims. 2.AddAIshots201/202. 3.Verifyallmanual+AIrequirements. 4.Recordactualgate/package/speed/eval/security/fidelity/ownercorpus. 5.Preparev1.0draftonly;askownerbeforepublication. | deckAiHelp.test.ts `deck_ai_help_all_actions`:sixcommandsbilingualhelp; `deck_manual_works_without_ai`:stylelibraryofflinenoAPIcalls; `deck_release_needs_evidence`:unrun/failedsuiteorunapprovedreleaseunpublished | `docs(ai-deck): full help and v1.0 acceptance evidence [step-22b/T15]` |

Tests under src/__tests__ unlessnativecontracttestsbelong20amodules. Workerdoesnotrunmodels/train/install/build; coordinatorownsallsharedwiringandexecution. Nooutput isdeemedacceptedmerelybecauseatypecheckorparserpasses.

## Coordinator commit labels (workers do not commit)

- feat(styles): fixed manual deck style contracts [step-22b/T1]
- feat(styles): eight palettes and deterministic layouts [step-22b/T2]
- feat(styles): bounded atomic user-style catalog [step-22b/T3]
- feat(styles): previewed one-transaction style application [step-22b/T4]
- feat(styles): safe template import and style exchange [step-22b/T5]
- feat(styles): accessible library cards and details [step-22b/T6]
- docs(help): manual presentation styles and imports [step-22b/T7]
- feat(ai-deck): typed outline and provider contracts [step-22b/T8]
- feat(ai-deck): bilingual examples for eight styles [step-22b/T9]
- feat(ai-deck): consented source-grounded outline generation [step-22b/T10]
- feat(ai-deck): real layout placement and draft clone preview [step-22b/T11]
- feat(ai-deck): explicit atomic draft and slide acceptance [step-22b/T12]
- feat(ai-deck): accessible outline and draft review [step-22b/T13]
- test(ai-deck): bilingual style quality and legal tuning protocol [step-22b/T14]
- docs(ai-deck): full help and v1.0 acceptance evidence [step-22b/T15]

## Required handoff

Return `handoff/step-22b/README.md` plus your patch/new files and exact shared-file proposals under `handoff/step-22b/`. The report must contain:

1. Completed task IDs, new/changed paths, and implementation choices already fixed by the guide.
2. Every consumed producer symbol with its canonical import path/revision, exact arguments/return type and lifetime; list exports you implemented. Report any missing dependency, without a substitute API.
3. Exact proposed shared edits keyed to the containing symbol/registry, including manifests/dependencies, IPC handler+isolation entries, canonical type extensions, English/Spanish keys/help catalog, settings/migrations and measurement hooks. Do not edit generated pseudo-locale or lockfiles.
4. Written tests by path/name, fixture/input and expected outcome. State **not run**. Include coordinator commands/checks required by the guide, without executing them.
5. Cancellation/cleanup, stale revision/content identity, sensitive source, no-overwrite/Undo and partial failure handling relevant to this step.
6. Owner/evidence gates and remaining independent tasks. State no build, tests, runtime, model/provider, performance or screenshot acceptance has been performed.

Stop after this handoff. Do not dispatch other AIs, implement another step or claim a release is ready.

AI reminder: assistant text uses17a's selected Local/API gateway; Meta is the first API provider, Local the initial choice. No automatic cloud fallback. Keys stay native; file-derived payloads need exact one-use reviewed consent. Speech/image/embeddings remain local. Reading a file never authorizes uploading it. Do not call a real provider or download a model in this assignment.
