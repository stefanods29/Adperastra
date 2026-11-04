# Step 08c: Optional privacy cleaner

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-08c-privacy |
| Tag | v0.0.29-step08c |
| Depends on | 08a conversion/output/snapshot contracts;08b safe document adapters;06b versions |
| Written before | 07a was built |
| Interface revision | privacy-1 |

Guide only. Workers implement exact algorithms/data/text/tests; coordinator installs libraries, applies shared edits and runs all verification. Privacy cleaning is never automatic without a saved explicit user choice.

## Goal and exclusions

Inspect and remove selected hidden information from images/PDFs, normally into a cleaned copy. Show before/after information and actual results. Ordinary copies/saves/conversions keep metadata by default. No Office/media/archive cleaning12b, redaction of visible text, AI detection or claim that every possible private fact has been removed.

## Read first

v1 08b;08a E1-E7 conversion-2/export-snapshot-2;08b E6/E7; current versions/owned_io/Details/QuickConvert; little_exif0.6.23 andlopdf0.46.0 exactsource. Verified lopdf load_mem/is_encrypted/get_object_mut/prune_objects/delete_object/decompressed_content_with_limit/save_to. Do not use incremental save or unconstrained decompression for a cleaned copy.

## Decisions and algorithms

- D1. New pure crate `privacy` uses existing image metadata module/little_exif and pinnedlopdf0.46.0 MIT. Riskyinspect/clean in `--privacy-helper`,1GiB memory,60s/file;source<=512MiB,PDFobjects<=1,000,000/depth128,streamdecompression<=16MiBeach/256MiBtotal,ratio500. Snapshotinput uses08a; no parser inmain/UI. Image EXIF data<=16MiB,individualXML<=1MiB/nodes10000/depth32,DTD/entitydeclarationsrefused.
- D2. Category IDs reuse08a MetadataCategory. Image scope exif/gps/camera/date/icc/xmp/iptc/author. PDFscope author/xmp/attachments/annotations/scripts/forms plusgps/camera/date/exif only when nestedimage/XMPcoveragecanbeproved. UI offers only actually supportedcategories andexplicitcoverage. Defaults selectedcategoriesempty; firstinspect reads onlyuserselectedfiles, neverbackgroundcloudcontent.
- D3. Inspection returns category->bounded sanitizedpreview/count/coverage complete/partial/unknown; detectedvaluesescapedtext,notlinks. Global inspectorresultsmax256rows/768KiB withcursor. Missing category is absent, not fabricatedzero. “All hidden information” is not a command; removingalllistedcategoriesstillmeansdefinedscopeonly.
- D4. Image cleaning starts from guarded exactsource bytes. For GPS removeGPSIFD and its pointer, all canonicalXMPGPS/location elements/attrs and IPTClocationrecords; preserve date/camera/ICCunlessselected. EXIF broad category removes all nonstructural IFD metadata while preserving pixelstorage/requiredTIFFtags. Selecting exif, xmp or iptc expands removal to every semantic category actually stored in that selected container, per closure table below; list this expansion and require exact acceptance before cleaning. Preserve categories outside the accepted closure, never claim unselected GPS retained after broad EXIF removal. CameraremovesMake/Model/Lens*/BodySerialNumber/LensSerialNumber/OwnerName/CameraOwnerName; dateremovesDateTime/DateTimeOriginal/DateTimeDigitized andoffset/subsecondcounterparts; author removes Artist/Copyright/XPAuthor/OwnerName plus matching XMP/IPTC creator properties; overlapping OwnerName camera category is part of disclosed closure. Unknown vendorMakerNote cannot be claimed selectivelycleaned: requirewholeEXIFremoval or reportunverifiedwithoutpublishingthatclaim.
- D5. XMP manipulation occurs inisolatedtrustedXMLadapter using DOMParser/XMLSerializer on disconnected XML, with DTD/entity stringsrefusedbeforeparse. Match namespaceURI+localname, neveruserprefix; removeGPS* and locationproperties in EXIF/IPTC schemas whenGPSselected. IPTClocationdatasets2:90/92/95/100/101 andcreator2:80/85,othercategoriespreserved. Preserve unknownunselectednamespaces/data, and refuse unknown selectedcoverage. Outputcontainerrecomputedwithvalidlengths/CRC; no blindregexXMLreplacement. No userfilewriteviaMetadata.write_to_file.
- D6. PDF: traverse reachableobjectgraphwithvisitedIDs/caps; detectInfo/XMP/names/annotations/AcroForm/OpenAction/AA/JavaScript/EmbeddedFiles/associated-file arrays. Author removesAuthor/Creator/Producer andequivalentXMP; XMPremovesMetadata streams; attachmentsremoveEmbeddedFiles/AF andfileattachmentsannotations; scriptsremoveJSname-tree,JavaScript actions/OpenAction/AA and embeddedactiveactions; annotationsremoveselectedannotationobjects/refs; formsremovesAcroForm/XFA/widgets/formvalues. Content-affectingcategoriesneedexplicitconfirmation. Do not removeordinarypagecontentfor“author”.
- D7. PDF cleaning writes a fresh nonincremental document, prunesunreachableobjects,renumbers, serializesboundedstream, then reloadsindependenthelper andrerunsselected-categoryinspection. Removedoldobjects/incrementalrevisions must not remain inoutput. Digital-signaturefields/ByteRange trigger clearwarningthatcopychangesinvalidateexistingPDFsignatures; sourcekept. Encrypted/unsupportedPDFreturnsprivacy.unsupported unlessallrequestedcoveragecanbeverified; no pretendingdecryption/unknownobjectsareclean.
- D8. Verifybeforepublication: selectedcategorycoveragecomplete andaftercount0; unselectedsupportedmetadata/pixelrender/contentinvariantsunchangedexceptapprovedcontentremoval; structuraldecode/reopenpasses. Failure returns privacy.unverified, keepssourceandforeignoutputs, publishesnocleanclaim. Per-filebatchreportsactualsuccess/failure/cancel; previewsnevermutatesource.
- D9. Destination default cleanedcopy `<stem> - Cleaned.<ext>` localizedsuffixfromkey withnumberedcollisionpolicy08a. In-place optiondisableduntil09fapprovedreplacement; whenenabled firstbefore_modify reasonClean andsharedexactreplacement/recovery; sourcehash/stamp revalidatedafterinspectionbeforeclean. No originaldeletionbycleaner.
- D10. Settings schema18 adds PrivacySettings defaultmode keep,image/pdf overrides keep/ask/remove, selectedcategoriesmapempty, location_warningfalse, sharing_promptfalse. A savedremovechoice is explicitauthorization forfuturecompatibleuser-startedconversion/cleaning; never backgroundedits. Unsupportedcategoryneverignored; stop/askbeforechanging. QuickConvertcheckbox offbydefault andshowschosen categories,notvagueprivacytoggle.

## Uses from other steps

| Ref | Producer/export | Exact use |
|---|---|---|
| U1 | 08a E2/E4/E5/E7 | ConversionInput/ExportSnapshot/MetadataCategory/WorkItemResult/ConversionReport,immutableinputs,ownedoutput/framing/report/Undo. Do not copy these types |
| U2 | 08a metadata/image modules;06e owned_io | Existingvalidatedmetadataextraction/guard/staging/no-replacepublication, not outputpathreopen |
| U3 | 06b versions.rs before_modify/ModifyReason | Add Clean=>storedreasonclean, defaulted/additive; errorprivacy.version_failed; no write ifhookfails |
| U4 | 07d E7 helper transport and08c E5 privacy_xmp.rs adapter defined here | ReuseisolatedtrustedwebviewhostforXMPonlyifneeded, no nativeappmarkupinjection; staticpdf_writeentry action namespaceprivacy.xmp |
| U5 | 03a DetailsPane,06dtrackJob,08a QuickConvertDialog | OptionalPrivacysection/command/selectedcategorycheckbox; nobackgroundfilemodification |

## Data shapes and commands

Canonical Rust `crates/privacy/src/types.rs`; TS `src/services/privacy.ts`, imports08a common types.

| Type | Exact fields/types/bounds |
|---|---|
| MetadataContainer | fixed string enum exif/xmp/iptc/pdf_info/pdf_structure |
| PrivacyField | category MetadataCategory;containers MetadataContainer[]unique,max5;related_categories MetadataCategory[]unique,max16; field_id ASCII string<=128 fixedadapterpathID; label_key string<=128; preview string<=512; countu32; content_affecting bool; coverage complete/partial/unknown |
| PrivacyInspection | inspection_id UUID; input ConversionInput; source optionalSourceStamp; fields PrivacyField[]max256/page; next_cursor optionalUUID; complete bool; signatures_present bool;effective_categories MetadataCategory[] for requested inspection categories; expires_unixu64defaultnow+300s; nopathsfromuntrustedresultusedforwrite |
| PrivacyClosure | requested_categories/effective_categories MetadataCategory[];content_affecting bool;appearance_affecting bool;signatures_present bool |
| PrivacyRequest | inspection_ids UUID[]1-10,000; categories MetadataCategory[]nonempty; dest_dir absolute string; replace bool defaultfalse/refuseduntilsharedsafety; accepted_content_changes bool false; accepted_signature_change bool false;accepted_appearance_changes bool false;accepted_effective_categories MetadataCategory[] exactly disclosed removal closure |
| PrivacyResult | common ConversionReport plus inspections_before/after countspercategory (boundedMetadataCount[] withcategory,countu32,coverageenum), no arbitraryhugevalues |
| PrivacySettings | mode keep/ask/remove defaultkeep; image_mode/pdf_mode same defaultkeep; image_categories/pdf_categories MetadataCategory[]max16defaultempty; location_warning/sharing_prompt bool false |
| PrivacyDialogProps | inputs readonlyConversionInput[]; onClose callback()->void; onCompleted callback(PrivacyResult)->void; onOpenHelp callback(slug)->void; initiallyselectedcategoriesemptyunlessexplicitpreset/settings |

Nativecommands `privacy_inspect_start(request_id,inputs,categories defaultempty)` ->sharedjobresultPrivacyInspectionPage (itemsPrivacyInspection[],next_cursoroptionalUUID,completebool); `privacy_inspection_page(cursor)` ->same; `privacy_clean_start(request_id,request)` ->PrivacyResultjob; `privacy_release(inspection_id)` idempotentunit. TS `inspectPrivacy(inputs,categories:MetadataCategory[]=[])` ->Promise<JobHandle<PrivacyInspectionPage>>; `privacyInspectionPage(cursor)` ->Promise<PrivacyInspectionPage>; `cleanPrivacy(request)` ->Promise<JobHandle<PrivacyResult>>; `releasePrivacy(id)` ->Promise<void>. Mainwindow/paths/snapshot/source/expiry/cats/flagsvalidatedRust. Errors privacy.bad_request/unsupported/changed/unverified/too_large/no_space/cancelled/failed/version_failed. Inspectionid isnotmutationauthorizationforchangedsource.

## Exports for later steps

| Ref | Canonicalexport | Contract; consumers |
|---|---|---|
| E1 | services/privacy.ts DTOs/inspection,clean,release,page and effectivePrivacyCategories wrappers | 09ebatch,12bOffice/media/archiveadapters,PDF/imageeditorexport/privacyUI |
| E2 | crates/privacy/src/registry.rs PrivacyAdapter | id()->staticstr; categories()->MetadataCategory[]; inspect(&self,input:&mut dyn ReadSeek,context:&mut PrivacyContext)->Result<Vec<PrivacyField>,PrivacyError>; clean(&self,input:&mut dyn ReadSeek,categories:&[MetadataCategory],output:&mut dyn std::io::Write,context:&mut PrivacyContext)->Result<PrivacyCleanSummary,PrivacyError>; ReadSeek from08a, no duplicated source field |
| E3 | src/privacy/PrivacyDialog.tsx PrivacyDialog | PrivacyDialogProps; samecomponentDetails/context/convertcheckbox; no alternativecleanerdialog |
| E4 | src/privacy/policy.ts privacyPolicyFor | PrivacySettings,inputFormat FormatId,explicitCategoriesoptionalarray ->typeddecision keep/ask/remove withfixedcategories; unsupportedcategoryerror,never“removeall” |

PrivacyError variants exactlyBadRequest/Unsupported/Changed/Unverified/TooLarge/NoSpace/Cancelled/Failed/VersionFailed. PrivacyCleanSummary fields removedcategorycounts,retainedcategorycounts,coverage complete/unknown,output_bytesu64; no successwhenunknown. PrivacyContext is private-to-pure-crate fields cancel CancellationToken,progress Box<dyn FnMut(OpProgress)->Result<(),PrivacyError>+Send>,source_stamp Option<fs_service::SourceStamp>,max_output_bytesu64. It does not own another inputreader/output; no Tauri in purecrate.

### E5: shared bounded XMP manipulation

Native `src-tauri/src/privacy_xmp.rs` exports rewrite_xmp(source:&[u8],edit:&XmpEdit,context:&JobContext)->Result<Vec<u8>,String>, inspect_xmp(source:&[u8],context:&JobContext)->Result<Vec<PrivacyField>,String>. XmpEdit is tagged RemoveCategories {categories:Vec<MetadataCategory>} or SetKeywords {keywords:Vec<String>max1000,each1-60Unicodecharacters}; canonical mirror src/services/xmp.ts, but raw XML bytes never UIinvokeJSON. Wrappers are native/helper only;11b embedded-tag copies call theseexactexports. XML input/output<=1MiB, nodes/attrs<=10000,depth32,texttotal<=1MiB; rejectDOCTYPE/ENTITY/processinginstructions before DOMParser. Runonly07d privacy.xmp statichelperaction;networkandexternalentityresolutiondisabled. Match namespaceURI/localname, not prefix. Namespace RDF http://www.w3.org/1999/02/22-rdf-syntax-ns#,DC http://purl.org/dc/elements/1.1/,EXIF http://ns.adobe.com/exif/1.0/,TIFF http://ns.adobe.com/tiff/1.0/,XMP http://ns.adobe.com/xap/1.0/,PDF http://ns.adobe.com/pdf/1.3/,IPTC http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/.

SetKeywords replaces only dc:subject RDFBag with deduplicatedkeywordsinprovidedorder; preserves unrelated elements/attrs/namespaces. GPSremoval removesknownEXIFGPS*/IPTClocationfields;author removesdc:creator/dc:rights/PDFauthor+creator+producer/TIFFartist/copyright;date removesknownXMPCreateDate/ModifyDate/MetadataDate/EXIFDateTime*;camera removesTIFFMake/ModelandknownEXIFlens/serialfields. Unknown selected namespace coverage returns privacy.unverified; no broadname regex pretendingcomplete. RemoveCategories closure is the inspected closure defined below, not a fixed assumption that xmp/iptc contains no GPS or author information. T2 adds helpers/typedrequests, testsDTDdenied/namespacedprefixalias/unknownpreservation/keywordsBag/idempotence andremovalclosureacceptance;11b doesnotuseunverifiedlittle_exifXPKeywords.

### Exact removal closure and appearance acknowledgement

Inspection retains native field provenance through canonical PrivacyField.containers/related_categories above; categories are not assumed disjoint. Recompute closure after category selection through privacy_effective_categories(inspection_ids:UUID[],categories:MetadataCategory[])->PrivacyClosure; TS effectivePrivacyCategories(ids:readonlystring[],categories:readonlyMetadataCategory[])->Promise<PrivacyClosure>. E1 exports this DTO/wrapper. Recalculation reads retained immutable provenance only; source mismatch still requires a fresh inspect. Every command is main-only and validates IDs/limits/source/expiry before use.

| Selected category | Exact effective closure and invariant |
|---|---|
| exif | exif plus every detected semantic category of removed nonstructural EXIF fields, including gps/camera/date/author/comments when present. Required TIFF structural/pixel tags remain; unknown MakerNote demands complete broad removal or unverified |
| xmp | xmp plus every detected semantic category in removed XMP packet, including gps/camera/date/author/comments/exif/iptc when represented. Removing whole packet cannot claim those unrelated categories retained |
| iptc | iptc plus every detected semantic category in removed IPTC datasets, including gps/date/author/comments/camera when present. Removing whole IPTC block cannot claim selective preservation |
| gps/camera/date/author/comments | selected category plus any overlapping semantic categories carried by the exact removed fields. For example OwnerName participates camera+author; disclose both rather than asserting unselected author unchanged. Preserve unrelated fields from same container |
| icc | icc only; appearance_affecting true because removing a profile can change displayed color even if pixel samples are identical |
| PDF attachments/annotations/forms/scripts | include detected overlaps of removed reachable structures; content_affecting true for attachments/annotations/forms. Signature presence always separately acknowledged |

Native clean recomputes closure from retained provenance and current source identity, compares set equality with request.accepted_effective_categories, and rejects a missing/additional category as privacy.bad_request. It requires accepted_content_changes for content_affecting and accepted_appearance_changes for appearance_affecting; signatures use accepted_signature_change. Broad unknown selected provenance is privacy.unverified and publishes nothing. Verify unselected invariants outside accepted closure; selected ICC deliberately exempts color-appearance equality only after explicit acknowledgement, while preserving pixel sample/structural integrity. Never claim appearance unchanged after ICC removal. UI lists requested and additionally affected categories with privacy.additionalCategories, plus appearance warning privacy.appearanceChange; category/inspection/source changes clear all affected acknowledgements. T3 tests wholeXMPcontainingGPSandAuthor requires both in closure; wholeIPTCcreator/date requiresauthor/date; OwnerName camera selection disclosesauthor; ICC requires appearance acknowledgement and afterdecode succeeds without claiming same colors. T6 tests no cleaning until exact closure/content/appearance/signature flags accepted.

## UI and exact keys

Dialog760px,maxviewportminus32, before/aftercolumns min240px,gap16; categorycheckboxes/fieldvalues scrollarea max360px; currentDialog/focustrap; dangerouscontentremovalrequiresexplicitcheckboxwithexplanation; defaultbutton Clean copy; Replace disabled. DetailsPrivacysectioncollapsedbydefault, onlyinspectwhenopenedbyuser; optionallyGPSbadgeonlyifsettingoptedinandmetadataalreadyavailable/policyallowsread. No color-only removed/retained indication.

| Key | English | Spanish |
|---|---|---|
| commands.removeHiddenInfo | Remove hidden information… | Quitar información oculta… |
| privacy.title / privacy.before / privacy.after | Remove hidden information / Before / After | Quitar información oculta / Antes / Después |
| privacy.select / privacy.cleanCopy / privacy.cleanedName | Choose what to remove / Clean copy / {name} - Cleaned | Elige qué quitar / Crear copia limpia / {name} - Limpio |
| privacy.keep / privacy.ask / privacy.remove | Keep all metadata / Ask each time / Remove selected information | Conservar todos los metadatos / Preguntar cada vez / Quitar la información seleccionada |
| privacy.locationWarning / privacy.sharingPrompt | Show location warning / Ask before sharing location | Mostrar aviso de ubicación / Preguntar antes de compartir la ubicación |
| privacy.contentChange | Removing this information also changes document content. | Quitar esta información también cambia el contenido del documento. |
| privacy.additionalCategories | Also removes the listed related information. | También quita la información relacionada indicada. |
| privacy.appearanceChange | Removing the color profile may change how colors appear. | Quitar el perfil de color puede cambiar la apariencia de los colores. |
| privacy.signatureChange | The cleaned copy will no longer keep the existing PDF signatures valid. | La copia limpia ya no conservará la validez de las firmas PDF existentes. |
| privacy.scope | Only the listed information is checked and removed. | Solo se revisa y quita la información indicada. |
| privacy.unverified | Removal could not be verified. No cleaned file was published. | No se pudo verificar la eliminación. No se creó un archivo limpio. |
| privacy.none | No supported hidden information was found. | No se encontró información oculta compatible. |
| privacy.exif / privacy.gps / privacy.camera / privacy.date / privacy.icc / privacy.xmp / privacy.iptc / privacy.author | EXIF information / Location / Camera information / Dates / Color profile / XMP information / IPTC information / Author information | Información EXIF / Ubicación / Información de cámara / Fechas / Perfil de color / Información XMP / Información IPTC / Información del autor |
| privacy.attachments / privacy.annotations / privacy.scripts / privacy.forms / privacy.comments / privacy.timestamps | Attachments / Annotations / Scripts / Form data / Comments / Timestamps | Archivos adjuntos / Anotaciones / Scripts / Datos de formularios / Comentarios / Marcas de tiempo |
| errors.privacy.bad_request / errors.privacy.unsupported / errors.privacy.changed | These cleaning options are not valid. / This information cannot be removed safely here. / The source changed. Inspect it again. | Estas opciones de limpieza no son válidas. / Esta información no se puede quitar de forma segura aquí. / El archivo de origen cambió. Vuelve a revisarlo. |
| errors.privacy.unverified / errors.privacy.too_large / errors.privacy.no_space | Removal could not be verified. / This file exceeds the cleaning limits. / There is not enough space for a cleaned copy. | No se pudo verificar la eliminación. / Este archivo supera los límites de limpieza. / No hay espacio suficiente para una copia limpia. |
| errors.privacy.cancelled / errors.privacy.failed / errors.privacy.version_failed | Cleaning was cancelled. / This file could not be cleaned. / A version could not be kept. The file was not changed. | Se canceló la limpieza. / No se pudo limpiar este archivo. / No se pudo conservar una versión. El archivo no cambió. |

Every slash-delimitedfullkey/value isindependentandordered. Commands explorer.removeHiddenInfo and <handler>.privacy, labelcommands.removeHiddenInfo,iconShieldCheck,noglobalshortcut,help removing-hidden-information. Fieldlabelkeysarefixedcategorytableabove; unknownmetadatafieldlabelsusegenericcategorylabelplusboundedescapedfieldIDdata,notuntranslatedRustdisplaytext.

## Tasks

| Task; commit | Exactfiles/work | Tests/oracles |
|---|---|---|
| T1; `deps: add bounded PDF privacy parser [step-08c/T1]` | privacycrate manifest/types/error/registry; coordinatorlopdf/notices/schema18privacydefaults; existinglittleExifreuse. | unknowncategoryrefused; schema17 es/dark/convertpresetsretained/allprivacyoff; everytypemirrorswire; redactedinputsecrets |
| T2; `feat(privacy): bounded metadata inspection [step-08c/T2]` | privacy inspect.rs/image_fields.rs/pdf_fields.rs; nativeprivacy_helper.rs/privacysessions; E1 inspect/pages/closure; privacy_xmp.rs,src/pdf-write-helper/privacyXmp.ts,services/xmp.ts implement E5. | GPS/date/cameracategoriesdistinct;sourcechangestalesid; 257fieldspagesratherthantruncates; image/PDFbombcapped; inspectwriteszero sourcebytes |
| T3; `feat(privacy): selective verified image cleaning [step-08c/T3]` | image_clean.rs/xmp_rules.rs/iptc.rs; isolatedXMLadapter;D4/D5verification. | remove_gps_keeps_date_and_camera exactfieldvaluesunchanged; removeauthorpreservesICC/pixels; unknownMakerNoteselectedfailsunverified; XMLprefixrenamingdoesnotbypassGPSremoval; DTDrefused |
| T4; `feat(privacy): fresh verified PDF cleaning [step-08c/T4]` | pdf_graph.rs/pdf_clean.rs/pdf_verify.rs;D6/D7boundedgraphandfreshsave. | removedauthornotinInfo/XMP/unreachableobjects; selectedattachmentgoneafterreopen/prune; JS/OpenActionremoved; forms/annotationsneedcontentack; selectedunknowncoveragepublishesnothing; sourcePDFhashunchanged |
| T5; `feat(privacy): safe cleaning jobs and policy [step-08c/T5]` | nativeprivacy.rs/privacy_jobs.rs;services/privacy.ts;privacy/policy.ts; coordinator08aconversion/ownedoutput/version/Undohandoff. | defaultsremove0fields; offwarningmakes0extra reads; cancelonlyownedstage; sourcechangeafterinspectrefused; newcopycollisionkeepsboth; successfulaftercount0withretainedfieldsverified |
| T6; `feat(privacy): reviewable cleaning dialog and entry points [step-08c/T6]` | PrivacyDialog.tsx/PrivacyFields.tsx/PrivacySettings.tsx/styles/privacy.css; coordinatorDetails/context/QuickConvertcheckbox. | noselectedcategoryClean disabled;signature/content/appearance acknowledgement and exact effective-category closure required;failedafterchecknevergreen“clean”;keyboardcategoryfocus/bilingualtext; matchingpolicysharedcomponent |
| T7; `docs(help): hidden information and privacy choices [step-08c/T7]` | Bilingualpagesbelow;coordinatorpseudo/scripts/report. | helpparity/existingcommandtests,sourceinvariants/falseclaimtests,settingsmodepreservation |

Puretests crates/privacy/tests/step08c_*; UIprivacyPolicy/privacyDialog/privacyFields.test.tsx. Reportactualverificationcoverage andallretainedartifacts; workers do notexecute.

## Full help

`removing-hidden-information.md`, English **Removing hidden information**. Intro: “Inspect selected files and choose which hidden information to remove.” How to use: “Choose **Remove hidden information…**. Review the listed fields, select categories, and choose **Clean copy**. Confirm separately when removing forms, annotations or other content. Review the before-and-after result.” Good to know: “Nothing is removed by default. Originals are kept. The tool checks only the listed supported information, not every possible private fact or visible text. If removal cannot be verified, no cleaned file is published. Changing a signed PDF invalidates its existing signatures in the cleaned copy.” Last: `See also: "Privacy settings" and "Converting files".`

Spanish **Quitar información oculta**. Intro: “Revisa los archivos seleccionados y elige qué información oculta quitar.” Cómo usar: “Elige **Quitar información oculta…**. Revisa los campos indicados, selecciona categorías y elige **Crear copia limpia**. Confirma por separado la eliminación de formularios, anotaciones u otro contenido. Revisa el resultado antes y después.” Para tener en cuenta: “No se quita nada de forma predeterminada. Se conservan los originales. La herramienta revisa solo la información compatible indicada, no todos los posibles datos privados ni el texto visible. Si no se puede verificar la eliminación, no se crea un archivo limpio. Cambiar un PDF firmado invalida las firmas existentes en la copia limpia.” Last: `Consulta también: «Configuración de privacidad» y «Convertir archivos».`

`privacy-settings.md`, English **Privacy settings**. Intro: “Choose whether future actions keep information or ask you what to remove.” How to use: “Open Privacy in Settings. Keep **Keep all metadata** for normal preservation. Choose **Ask each time** for a review, or explicitly select information to remove. Location warnings and sharing prompts are separate optional switches.” Good to know: “All removal and warning options start off. Settings never authorize background changes to your files. Unsupported information cannot be silently removed.” Last: `See also: "Removing hidden information" and "Background work".`

Spanish **Configuración de privacidad**. Intro: “Elige si las acciones futuras conservan información o te preguntan qué quitar.” Cómo usar: “Abre Privacidad en Configuración. Usa **Conservar todos los metadatos** para conservarlos normalmente. Elige **Preguntar cada vez** para revisarlos o selecciona de forma explícita la información que quieras quitar. Los avisos de ubicación y las preguntas al compartir son opciones separadas.” Para tener en cuenta: “Las opciones de eliminación y los avisos empiezan desactivados. La configuración nunca autoriza cambios en segundo plano a tus archivos. La información no compatible no puede quitarse de forma silenciosa.” Last: `Consulta también: «Quitar información oculta» y «Trabajo en segundo plano».`

## Check by hand, speed and screenshots

RetainedsyntheticJPEG/PNG/TIFFwithknownGPS/date/camera/ICC/XMP/IPTC; PDFwithauthor/XMP/attachment/annotation/form/scriptandsignature-marker; malformedXML/PDFandoldincrementalrevisionwithprivateauthor. Coordinatorcreatesfixtures,records exactfield/pixel/contenthashbefore/after andvalidatesindependentreopen. CheckGPS-onlyretainsdate/camera,defaultsdoNothing,copy/collision/cancel,content/signaturewarnings,unverifiablefailclosed,Spanishdark/pseudo/keyboard/200%zoom. Never usepersonaldocumentsorclaimredaction.

Measurements step08c.inspect.firstfields Fast1s,clean1image Waiting1-10s,batchBackgroundwithCancel;reviewcontrolsInstant0.1s/commonbrowseunchanged. Reserve85-privacy-review,86-privacy-result,87-privacy-settings,threevariants.

## Done when

- [ ] Exactinspection/categories/policies/exportsE1-E5 and closure wrapper implemented,allselectedremovalverifiedandnooriginaldamage.
- [ ] FreshPDFsavereallydropsselectedoldobjects;unselectedcontent/metadataretained;unknowncoverage/refusedcaseshonest.
- [ ] Defaults/preview/backgrounddonotremoveanything; confirmation/content/signature/locale/accessibility behavior tested.
- [ ] Coordinator executesgate/package/security/fidelity/speed/screenshots/help/report,openMajor/Blockernothiddenby“clean”status.

## Shared caller requirements

PrivacyRequest is imported unchanged by09e,12b and later assistant tools. Each caller first obtains the inspection-derived PrivacyClosure, displays requested plus effective categories, and supplies accepted_effective_categories as that exact reviewed set. It also supplies accepted_content_changes, accepted_signature_change and accepted_appearance_changes only from the corresponding current user acknowledgements; no wrapper fills them with true or conflates them with08a accepted_warning_codes. Any changed inspection/source/categories clears acknowledgements and recomputes the closure. T5/T6 tests a missing appearance acknowledgement, an extra effective category, and a stale inspection from each shared caller; each must create zero published files. Sensitive snapshot policy remains native08a authority classification, including derived MIME captures; a cleaner cannot register an ordinary replacement authority to bypass it.

Integration correction (2026-11-03): the registry cannot resolve the original exact little_exif0.6.0 pin. Use exact0.6.23 (MIT OR Apache-2.0), verified from the downloaded registry source. Its get_tag_by_hex requires the explicit optional group argument. Coordinator image/metadata round-trip tests passed against0.6.23; original handoffs are preserved.
