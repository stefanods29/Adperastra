# Step 08b: PDF, document, table and archive conversion; batch presets

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-08b-more-conversions |
| Tag | v0.0.28-step08b |
| Depends on | 08a E1-E7;07d E1-E7;06d/06e archive service;06f data-views |
| Written before | 07a was built |
| Interface revision | conversion-2;export-snapshot-2;conversion-presets-1 |

Guide only. Workers implement code/tests from these tables; coordinator installs/wires/executes checks. All conversions use08a registry, immutable snapshot, queue, output and reporting contracts. Do not create a second converter job system.

## Goal and exclusions

Convert images to PDF, PDF pages to images, Markdown/HTML to safe HTML/PDF, CSV to/from XLSX, ZIP to/from7z. Save validated batch presets and run them on compatible selections. No Office-engine formats/media12b, PDF editing14a, original replacement before09f, macros/formula evaluation, scripts or model generation.

## Read first

Full08a/07d/06e guides; v1 08a mapped non-image conversions/presets; current CSVdecode/table/archive APIs; pinned pdf-lib1.17.1,calamine0.37.0,rust_xlsxwriter0.102.0 source. Reuse markdown-it15.0.3/DOMPurify3.4.17. New font embedding dependency @pdf-lib/fontkit1.1.1 MIT is recorded explicitly by coordinator, with explicitly provisioned licensed Inter font bytes described below; no Inter binary exists in the baseline.

## Decisions and algorithms

- D1. Adapter IDs: images/pdf,pdf/png,pdf/jpeg,markdown/html,markdown/pdf,html/pdf,csv/xlsx,xlsx/csv,zip/seven_z,seven_z/zip. All register through08a E1 and use its typed ConvertOptions variants. Each declares actual capability/preservation/losses. Unsupported source/target options fail before output staging, not silently ignored.
- D2. Images-to-PDF preserves input selection order, one image per page; default page exactly image size converted at96dpi to points, with optional A4/Letter from DocumentConversionOptions. Apply orientation before embedding. Pin pdf-lib create/embedPng/embedJpg/addPage/drawImage/save; non-PNG/JPEG input converted in existing image helper first. Full output generated in07d E7 pdf_write host,768MiB/60s,512MiBoutput cap; parent owns publication. Batch<=1,000images/10,000pages; perpage100MP and overall current memory bounds.
- D3. PDF-to-image uses07d session/render; selected PageRanges normalized, stableascendingpageorder. Each OutputDraft has name_part page {page:actual 1-based page}; the parent appends the minimum-three-digit page suffix to the effective stem before expanding ConversionRequest.naming once. With the default pattern the result is `<stem>-page-<page padded at least3digits>.<ext>`; common numbered publication resolves collisions. DPI72-600, default150; pixel width=ceil(width_pt*dpi/72),height similarly; obey07d pixel/rendercap, reject if requested quality cannot be met rather than silently claiming chosenDPI. NoPDFscript/action/externalresourceexec.
- D4. Markdown-to-HTML: html disabled in markdown-it; DOMPurify; output UTF8 with app-owned standalone document structure, licensedlocalfontCSS embedded only when explicitlychosen; no remote URLs/scripts/eventhandlers. HTML-to-PDF uses sanitized block model, not executable browser HTML. Support paragraph/headings1-6,ordered/unorderedlists,pre/code,basictable,authorizedlocalimages. Strip unsafe tags/remoteURLs and report loss categories; unsupported layout warns before user acceptance. Layout withpdf-lib font metrics, A4(595.28x841.89pt)/Letter(612x792),margins20mm default, body11pt, lineheight1.4, wrap at measuredwordwidth; splitlongwordatUnicodeboundary; headings16/14/13/12/11/11pt; tablecellswith8ptpaddingandrepeatheader. Registerfontkit/embedexistingInter; unsupportedglyph fails with expliciterror, neverdrops text.
- D5. CSV-to-XLSX: use current CSVdecoder/delimiter; default cells stay strings, no inference turning account IDs into numbers/dates/formulas. Header option affects styling only. Explicit formula-preserve allowed only for alreadytypedXLSXsource/specified trustedformula input, never automatic CSV execution. calamine reader uses reader-based API under source guard; rust_xlsxwriter new/add_worksheet/write_string/write_number/save_to_buffer verified in pinned source. Max100sheets/1,048,576rows/16,384columns and5,000,000cells, celltext32,767UTF16units; no truncation without failure/report.
- D6. XLSX-to-CSV chooses explicit sheet when multiple, neverdrops others silently; outputonefilepersheet optionally using OutputDraft.name_part sheet {sheet:original worksheet name};08a normalizes that sheet component and derives the effective stem before expanding the one naming template. The default result is `<stem>-<normalized sheet>.<ext>`. Formula option text emits formula text, preserve keepscachedvalueonlywhenavailablewithdisclosure(noevaluation). CSV quoting: quote delimiters/quotes/newlines, doubleembeddedquotes; chosenLF/CRLF; BOMoffUTF8. Stringcells starting =,+,-,@,tab/CR are marked potentiallyactive on spreadsheetopen; safe text mode prefixes apostrophe and lists modified-cell count beforeapproval; numericnegativecells remain numeric and unprefixed. Original workbook unchanged; no macros/externallinks followed.
- D7. Archive conversion uses06e guardedlisting/read/create, never genericunpack. Stream validatedentries to owned intermediate files underdata convert-input, boundedexistingarchive/path/ratio/sizecaps; then writer with selectedcompression/password. Preservenames/timestamps/commentswhereformatallows,reportunsupported/encrypted/malformedentries explicitly; outputnotpublishedascomplete unlessallrequiredentriesverified. Both input and output passwords memory-only, redactedDebug/logs,stdinonly, excludedpresets. Extend ArchiveConversionOptions with source_password optionalredactedString; existing password remainsoutputpassword.
- D8. Presets are `conversion-presets.json` schema1 underdata,atomic appstatewrite,max100presets,name1-60Unicodecharacters,uuidID,validatedconverterID+typedoptions+outputnaming. No absoluteinput/destinationhistory bydefault, passwords,tokens,snapshotsorcode. New schema17 `conversion.last_preset` optionalUUID defaultnull, `conversion.prompt_for_losses` bool fixedtrue; existing fields retained. Built-ins web-jpg (JPEG90,maxwidth1920,no_upscale,metadataKeep),images-pdf (images/pdf,source-sizedpages), table-csv (UTF8commaCRLF) shownonlywhencompatible.
- D9. Naming template is bounded data grammar, not code/regex: literal validfilenamecharacters plus tokens stem,ext,index,date; braces onlyaround these tokens; index1-basedpadding3; dateUTCYYYY-MM-DD captured onceperjob. A pattern contains exactly one `{ext}` in final `.{ext}` position; stem/index/date occur at most once. Max128characterspattern/255UTF16result; invalidnamesrejectedwithpreviewbeforeconversion. Output name_part is applied before template expansion; no adapter appends an extension or page/sheet suffix afterward. Presets never contain executable expressions. Batch summary/retry/Undo exactly08a.

## Uses from other steps

| Ref | Producer; exact canonical export | Contract |
|---|---|---|
| U1 | 08a E1/E2/E3/E6/E7 registry,ConverterSpec/ConvertOptions/ConversionInput/Report/MetadataCategory | Register adapter IDs above, matching option-kind; common queue/preview/publish/report, no duplicated types |
| U2 | 08a E4/E5 exportSnapshots/ExportSnapshots | Unsavedsource resolves immutable revision; release onjobclose; sensitive input staysmemoryonly |
| U3 | 07d E1/E2/E3/E7/E8/E9 services/pdf.ts,webview_helper.rs,pdf_snapshot_resolver.rs;pdf-reader-2/helper-transport-1 | openPdfInput(input:PdfInput,password?) returns JobHandle<PdfSession>; renderPdfPage(PdfRenderRequest) and readPdfText(sessionId,page,afterRun) preserve PdfSourceIdentity. PdfInput file carries the guarded path/optional expected SourceStamp; snapshot carries PdfSnapshotRef {snapshot_id,document_id,revision,content_id} from the immutable ExportSnapshot. Use raster {kind:dpi,value:options.dpi}; no topedge field or fake snapshot path. Snapshot leases remain retained until closePdf; release every returned CacheLease. |
| U4 | 06d/06e archive/create/read and owned_io | ExistingArchiveFormat/entry/path limits andcreate APIs fromthoseguides; use validatedstreamingentrydata, not sourcepathunpack |
| U5 | 06f data-views table/decode;05a/06c settings/format | decode_text/parse_table etc actualcanonicalexports; preserve identifiersandlocale; settings16->17 |

## Data shapes and exports for later steps

Canonicaltypes remain08a convert/types. Add presets in `src/services/conversionPresets.ts` and native `src-tauri/src/conversion_presets.rs`. Pure namingrules in `crates/convert/src/naming.rs` and mirroredpreviewhelper `src/convert/naming.ts`; backend authoritative.

| Ref; name | Exact fields/signature/validation |
|---|---|
| E1 ConversionPreset | id UUID; name String/string1-60; converter_id ConverterId; options ConvertOptions with allsecretfieldsremoved; name_pattern String/stringdefault{stem}.{ext}; destination_mode source/ask defaultsource; versionu32fixed1; created_unix/modified_unixu64safewire; no inputpaths |
| E2 PresetCatalog | schema_version1; presets ConversionPreset[]max100; immutablebuiltinUUIDs00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003 shownseparately, UI slugsweb-jpg/images-pdf/table-csv; importedunknown/newerversionrefusedwithoutchangingstore |
| E3 listConversionPresets/saveConversionPreset/removeConversionPreset | conversion_presets_list()->PresetCatalog; conversion_preset_save(preset)->PresetCatalog; conversion_preset_remove(id)->PresetCatalog; TS Promise ofcatalog; removalisappstateundoableviapreviouscatalogsnapshot |
| E4 applyConversionPreset | TS(presetId string,inputs readonlyConversionInput[],destDir string,namingDateUTC string)->Promise<ConversionRequest> aftervalidation,lossconfirmation/destinationselectionstillrequired. 09e/palette/12b use this, not rawoptioncopy |
| E5 renderConversionName | Rust(pattern str,stem str,ext str,indexu32,date_utc str)->Result<String,ConvertError>; TS sameinputs->string/errorpreview. stem is already the effective stem after08a OutputNamePart normalization; ext is canonical target extension without dot. index1/datevalidated; expand once, never append suffix/extension after this call; no filewrites |
| E6 HtmlBlock | tagged paragraph/heading/list_item/code/table/image; text escapedString<=64KiB; level optionalu8; cells optionalString[][]max1000x100; image optionalExportSnapshot/authorizedlease descriptor; no rawHTML/eventattributes; canonical src/convert/documentTypes.ts/native types.rs |
| E7 readDocumentBlocks | services/documentConversion.ts wrapper doc_blocks_start(request_id,input ConversionInput)->HtmlBlockPage job; page has blocks<=256,next_cursoroptionalUUID,completebool. Helper-onlysanitization/markupconversion;11a/13 canconsume normalizedtext without executingcontent |

PageRange/PdfConversionOptions/DocumentConversionOptions/TableConversionOptions/ArchiveConversionOptions are importedunchangedfrom08a; source_password addition optional/defaultedandredacted. These fields are explicitly excludedfromserializePreset, including nestedsourceSnapshots/passwords; allowlistonlynamedpersistablefields,notblacklistonepasswordkey.

Adapter option-kind/input-mode mapping is fixed: images/pdf uses document/combine;pdf/png andpdf/jpeg usepdf/each;markdown/html,markdown/pdf,html/pdf usedocument/each;csv/xlsx,xlsx/csv usetable/each;zip/seven_z,seven_z/zip usearchive/each. Built-inweb-jpgUUID...001 choosesimage/jpeg,width1920,allow_upscalefalse,quality90,metadatakeep;images-pdfUUID...002 choosesimages/pdf,documentpage_sizesource;table-csvUUID...003 choosesxlsx/csv,tableUTF8commaCRLF. Do notclaimPDFcompression/optimization. All presetnamingfieldsarecopiedintoConversionRequest.naming {pattern,date_utc,start_index1}; explicitdestDirargumentisvalidatedbutnotpersisted. Everyoutputpage/sheetuses08aConversionOutput/pagedreport/history_id,neverasingleoutput_pathorunboundedcreated_paths.

Font asset provisioning belongs T1/coordinator, before embedding: official Inter4.1 SILOFL1.1 static TTFsRegular/Bold/Italic/BoldItalic from https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip ; exact memberpaths/sizes/SHA256 andfontIDs are fixed in `plan/parallel/API-EVIDENCE.md` beforedispatch. Storeselectedsourceassetsinassets/fonts/inter-4.1/, copytofrontendpublic/fonts/ andPDFhelperresourceswithoutOSfontinstallation;includeOFLnotices. Missingfontreturnsconvert.font_unavailablebeforeoutput,notfallbackMicrosoftfont. PDF-libregisterFontkit/embedFont APIsverified https://pdf-lib.js.org/docs/api/classes/pdfdocument . @pdf-lib/fontkit1.1.1MIT runtimebundleincludesotherlicensedcode;coordinatorauditsbundle/transitivenotices,notpackageMITfieldalone.

## Texts and UI

ReuseQuickConvertlayout08a. Formatoptionsgroup adds Page range/DPI/Sheet/Delimiter/Header/Formula mode/Compression/Password/Encrypt names, allcontrolledtypedinputs. Presetdropdown besideformat, Savepresetbutton, nameDialog400px; saved/builtindistinctlabels; removeconfirm. Batchpresetcontextsubmenuonlycompatibleenabledentries. No expandednewtab/engine-specificUI.

| Key | English | Spanish |
|---|---|---|
| convert.pageRange / convert.dpi / convert.sheet | Page range / Resolution (DPI) / Sheet | Intervalo de páginas / Resolución (PPP) / Hoja |
| convert.delimiter / convert.header / convert.formulas | Delimiter / First row is a header / Formula handling | Delimitador / La primera fila es un encabezado / Manejo de fórmulas |
| convert.formulaText / convert.formulaCached | Keep as text / Use saved values | Conservar como texto / Usar valores guardados |
| convert.compression / convert.password / convert.encryptNames | Compression level / Output password / Encrypt file names | Nivel de compresión / Contraseña de destino / Cifrar nombres de archivo |
| convert.sourcePassword | Source password | Contraseña de origen |
| convert.preset / convert.savePreset / convert.removePreset / convert.presetName | Preset / Save preset… / Remove preset / Preset name | Ajuste preestablecido / Guardar ajuste preestablecido… / Quitar ajuste preestablecido / Nombre del ajuste preestablecido |
| convert.webJpg / convert.imagesPdf / convert.tableCsv | Web JPG / Images as PDF / Table as CSV | JPG para la web / Imágenes como PDF / Tabla como CSV |
| convert.namePattern / convert.patternHelp | File name pattern / Available fields: stem, ext, index and date. | Patrón de nombre de archivo / Campos disponibles: stem, ext, index y date. |
| convert.safeCells | {count, plural, one {# text cell needs a safety prefix.} other {# text cells need a safety prefix.}} | {count, plural, one {# celda de texto necesita un prefijo de seguridad.} other {# celdas de texto necesitan un prefijo de seguridad.}} |
| errors.convert.invalid_range / errors.convert.invalid_preset / errors.convert.invalid_pattern / errors.convert.missing_glyph | This page range is not valid. / This preset is not valid for these files. / This file name pattern is not valid. / This document contains characters the export font cannot display. | Este intervalo de páginas no es válido. / Este ajuste preestablecido no es válido para estos archivos. / Este patrón de nombre de archivo no es válido. / Este documento contiene caracteres que la fuente de exportación no puede mostrar. |

Eachslashentryisindependentfullkey. Existingerrorsconvertloss/space/cancel/changedreuse08a. Commands explorer.runConversionPreset openscompatiblepresetlist, labelconvert.preset, iconListFilter, no globalshortcut; helpbatch-conversion-and-presets. Do not labelanydeterministicpresetasAI.

## Tasks

| Task; commit | Files and algorithm | Exact tests/oracles |
|---|---|---|
| T1; `deps: add document and table conversion engines [step-08b/T1]` | Coordinator pdf-lib/fontkit/calamine/rust_xlsxwriterdeps/notices; create converteradapterstypes; schema17defaults/migration, source_passwordredaction. | knownoptionskindmustmatchadapter; unknownnewerschemafailwithoutmutation; passwordsabsentfromDebugandpresetserialization;16es/darkkeepquality90 |
| T2; `feat(convert): images and PDF page conversion [step-08b/T2]` | crates/convert/src/pdf.rs;src/pdf-write-helper/{main,pdfImages}.ts;nativePDFadapter; E1/E2/U3. | twoimagesorderpreserved;72ptat150DPI->150px using raster dpi150; snapshot source keeps document/revision/content identity and is released only after closePdf; namepart page2 plus pattern`{stem}-{index}.{ext}` givesphoto-page-002-001.png; pixel cap refuses requested DPI rather than downsampling; invalidrange0/last<firstrefusedbeforeoutput;1001imagecap; cancelreleasespageleases/originalunchanged |
| T3; `feat(convert): safe document HTML and PDF export [step-08b/T3]` | src/convert/documentTypes.ts;helperdocparser/layout,fontadapter; E6/E7. | script/remoteimgmakezeroexec/fetch; paragraphwrapmeasuredfontwidth; A4width595.28pt-margin2*(20*72/25.4) ->481.89417ptavailablewithin1e-4; unmappableglyphfailswithoutsilentdrop |
| T4; `feat(convert): safe CSV and workbook conversion [step-08b/T4]` | convert table_read.rs/table_write.rs/csv_output.rs; typedoptions/currentdataviewimports. | text000123remains000123; string=1+1writesstringnotformula; CSVa,quote,newlinequoted/doublequotes; missingcacheformulaexplicitwarning; formula_safety_prefix/formula_cached_value/sheet_selection acknowledgements required before output.begin; sheet Budget2026 plus pattern`{stem}-{index}.{ext}` givesbook-Budget2026-001.csv; selectingonesheetdoesnotclaimallconverted |
| T5; `feat(convert): guarded ZIP and 7z conversion [step-08b/T5]` | convertarchiveadapter andownintermediatelifecycle; nativearchive/passwordreuse. | traversalfails; malformed/passwordwrongpublishesnothing; noforeignintermediatecleanup; names/entryhashesroundtrip; metadataunsupportedreported |
| T6; `feat(convert): validated batch presets and naming [step-08b/T6]` | conversion_presets.rs/services/conversionPresets.ts,convert/naming.rs/ts; catalogatomicwriteanddialogs. | stemphoto/extjpg/index2/date2026-11-01,pattern`{stem}-{index}.{ext}` producesphoto-002.jpg; unknowntokenrefused;101presetsrefused; importneverpersistspassword/token/path |
| T7; `docs(help): batch conversions and presets [step-08b/T7]` | exactkeys/helpbelow; coordinatormenuregdock/pseudo/tests/measures/shots. | presetcompatibility/keyboard/lossack, bilingualhelp/keys; staleunsavedsnapshotnotreloaddisk; identicalregistrytypesacrossalladapters |

Namingpatternactualsyntaxusesbracedtokens: `{stem}-{index}.{ext}` ->photo-002.jpg; narrativetokenlistisnotliteralunbracedpattern. Everyhelper/outputuses08aownedpublish/report/Undo; workersnotruncommands. PureRusttests crates/convert/tests/step08b_*;UItests conversionPresets/documentConversion/conversionNaming.test.ts(x).

## Full help

`batch-conversion-and-presets.md`, English **Batch conversion and presets**. Intro: “Reuse a conversion setup on several files.” How to use: “Select files and open **Convert to…**. Choose a compatible **Preset**, or adjust the options and choose **Save preset…**. Give it a name. Review the destination, file name pattern and any changes, then choose **Convert**. Review the per-file summary.” Good to know: “Presets store options, not passwords or unsaved document contents. File names can use stem, ext, index and date fields. Not every format keeps all data or metadata. Originals are kept.” Last: `See also: "Converting files" and "The job queue".`

Spanish **Conversión por lotes y ajustes preestablecidos**. Intro: “Reutiliza una configuración de conversión en varios archivos.” Cómo usar: “Selecciona archivos y abre **Convertir en…**. Elige un **Ajuste preestablecido** compatible o cambia las opciones y elige **Guardar ajuste preestablecido…**. Dale un nombre. Revisa el destino, el patrón de nombre y los cambios indicados y elige **Convertir**. Revisa el resumen de cada archivo.” Para tener en cuenta: “Los ajustes guardan opciones, no contraseñas ni contenido sin guardar. Los nombres pueden usar los campos stem, ext, index y date. No todos los formatos conservan todos los datos o metadatos. Se conservan los originales.” Last: `Consulta también: «Convertir archivos» y «La cola de tareas».`

Updateconverting-filesEnglish/Spanishwith“PDF, document, table and archive choices appear when compatible.” / “Las opciones de PDF, documentos, tablas y archivos comprimidos aparecen cuando son compatibles.” Append exactly English “Use Page range to choose PDF pages and Sheet to choose workbook data. Text cells that could act as formulas need the displayed safety prefix. Formulas are not evaluated here.” Spanish “Usa Intervalo de páginas para elegir páginas PDF y Hoja para elegir datos de un libro. Las celdas de texto que podrían actuar como fórmulas necesitan el prefijo de seguridad indicado. Aquí no se evalúan fórmulas.” No claimfullOfficefidelity.

## Check by hand / speed / screenshots

Retainedfixtures:2syntheticimagesknownorder;3pagePDF;Markdownheadings/table/Spanishtext;HTMLscript/remoteimage;CSV000123/quotedcomma/linebreak/formulalikestring;XLSX2sheets/cachedformula/Unicode;ZIP3entrieswithfixednames/times,7zprotectedknownpassword. Coordinatorcreatesfixturesandrecordsbyte/contentexpectations; checkallroutes/presets/restart/secretsnotpersisted/cancel/partialresults/sourcehashes. Repeatesdark,pseudo,keyboard,200%zoom.

Measures step08b.preview.document/pdf/table/archive Fast1s; smallconvert Waiting1-10s;batchjobprogressCancel; unchangedcommoninteractiontiers. Reserve82-pdf-convert,83-table-convert,84-conversion-presets inthreevariants.

## Done when

- [ ] Eachlistedadapterimplementsactualcapabilitiesvia08aregistry; typedoptions/naming/presets andexactexportsconsistent.
- [ ] Noactivecontent/formula/macros/unsafeunpack/sourceoverwrite; metadata/contentlossacknowledgedandreported,source/unsavedrevisioncorrect.
- [ ] Reviewerexecutesunit/integration/fidelity/secret/safetychecksandpackage,localization/help/pseudo/screenshots/speed/report; nofalsemilestoneacceptance.

## Cross-step validation rules

T2/T3/T4 use08a ConversionRequest.accepted_warning_codes independently from accepted_losses. Required typed warnings are layout_loss for unsupported document layout, formula_cached_value for selected cached-value export, formula_safety_prefix for each disclosed active-looking text transformation, and sheet_selection when selecting only part of a multi-sheet workbook. A changed input identity, sheet, layout option or formula policy clears the prior acknowledgements. The native preflight validates the exact set before sink.begin; warnings are never converted into metadata category names or arbitrary helper prose. Tests reject a missing required acknowledgement with convert.warning_required and zero created files.

T2 uses the07d NativePdfSnapshotResolver installed by08a T2. Disk sessions compare PdfSourceIdentity.kind disk/stamp; snapshot sessions compare kind snapshot/document_id/revision/content_id/sensitive. Never cast the union to SourceStamp. Rendering honors resolved_scale/rendered_rotation from PdfPageImage and its exact pixel cap. Document/image adapters use the native snapshot authority issued for that document; any encoder capture MIME is registered through SnapshotAuthorityRegistry.permit_capture_mime by a trusted native provider, never granted by a UI field.
