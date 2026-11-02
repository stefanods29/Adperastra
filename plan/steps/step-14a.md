# Step 14a: PDF annotations, page tools, signatures and forms

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 4/5 |
| Branch | step-14a-pdf-tools |
| Tag | v0.3.1-step14a |
| Depends on |07d pdf-reader-2/helper-transport-1;08b PDF writer/font asset;09a document controller;09c content-transfer-1;09f approved save capability |
| Written before |07a was built |
| Interface revision |pdf-edit-1 |

Guide only; workers write code/tests, coordinator runs all verification. Existing-target Save remains disabled where09f has not proved safe replacement. Save a copy remains usable.

## Goal, exclusions and reading

Annotate PDFs, add visual signatures, rearrange/merge/split pages and fill supported AcroForms with Undo/Redo and safe copies. No certified digital signing, redaction, XFA editing, PDF scripts or arbitrary existing-text reflow. Read v1 step14a,07d transforms/host,08b pdf-lib1.17.1/fontkit/Inter provision,09a controller binding,09c transfer,09f safety. Official low-level reference: Adobe PDF32000-1:2008 chapter12.5/12.7, https://developer.adobe.com/document-services/docs/assets/35e4369068f86065372c18787171a17e/PDF_ISO_32000-1.pdf . Verified pdf-lib APIs: PDFContext.obj/register/formXObject;PDFPage.node.addAnnot/removeAnnot;PDFDocument.copyPages/insertPage/removePage/getForm;PDFForm.getFields/updateFieldAppearances. Do not invent a high-level createHighlight/createComment method.

## Decisions and algorithms

1. D1. One document-owned immutable `PdfEditModel` per document_id, factory registered for existing PDF handler; views share edits, not scroll/tool selection. On transaction validate operands, create next immutable model/content_id, push exact inverse history and call09a notifyContentChanged once. PreviewOnly/protected or an actually locked/revoked provider session refuses mutation. An unlocked sensitive provider is editable only through the proved memory-only adapter below. Capture encodes the captured model revision, not a fresh disk reload. Read original via authorized ranges; writing/parsing happens in07d isolated pdf_write host, 1GiB/60s, source/output<=256MiB for edited snapshots, max10000pages/100000annotations.
2. D2. Coordinates are unrotated PDF user-space points with actual CropBox origin; use07d inverse viewport matrix for pointer/text quads. Store geometry in those coordinates; page rotation is a separate0/90/180/270 field. Rectangles normalized min/max and clipped to CropBox. Stroke width0.25..24pt, opacity0..1; color RGBA from fixed accessible swatches or validated picker. UI zoom never changes stored geometry. Point cap100000/stroke and2million/model; simplify consecutive points closer than0.25pt, preserve endpoints.
3. D3. New annotations are indirect dictionaries appended to the page Annots array; existing unknown annotations/objects remain unchanged. Common keys Type=Annot,Subtype,Rect[4numbers],P=page reference,NM=UUID,M=PDF UTC date,T=author text,Contents=Unicode text,F=Print(4),C=RGB[3numbers],CA=opacity. Encode human text with PDFHexString.fromText; never interpolate it into operators, names or raw PDF syntax. New app IDs live in NM, not private executable actions.
4. D4. Highlight: Subtype Highlight; QuadPoints eight numbers per quadrilateral in counterclockwise boundary order with first edge following text baseline (unrotated example lower-left/lower-right/upper-right/upper-left); Rect union of quads; AP/N is an app-built Form XObject filling the same quads with ExtGState BM=Multiply/ca=opacity. Ink: Subtype Ink,InkList array of alternating x/y arrays,BS width/Solid, AP/N matching strokes. Text box: Subtype FreeText,DA references embedded Inter font and validated size6..144pt,Contents text,Q alignment0/1/2, AP/N matching wrapped glyphs. Always provide appearances; verify alternate-reader visibility rather than relying on viewer-specific regeneration.
5. D5. Comments use Subtype Text,Name Comment,Open false; optional Popup has Parent pointing to the Text annotation. Replies use IRT parent annotation reference and RT=R, same page and author/time fields. UI comment text max8192/reply,1000replies/thread. A visual signature is Subtype Stamp with AP/N Form XObject containing drawn strokes, embedded raster or typed text; no Sig/ByteRange/certificate fields are created. Image signature cap10MP/8MiB; never persist signature files/passwords by default. Existing real signature fields trigger invalidation warning and Save a copy only.
6. D6. Appearance Form XObject has Type XObject,Subtype Form,FormType1,BBox local annotation bounds,Matrix identity,Resources containing only referenced embedded Font/XObject/ExtGState. Use verified pdf-lib operator constructors (push/pop graphics state, moveTo,lineTo,stroke,fill,beginText,setFontAndSize,showText,endText,drawObject), not raw unescaped text. Appearance bounds translated from page space to local lower-left. All file bytes/raw output use helper grants/protocol, never JSON.
7. D7. Page operations are stable page IDs, not array-index identities: reorder uses a full permutation exactly once; delete cannot remove last page; split selected ranges creates separately named outputs through08a multi-output publication; insert/merge uses authorized immutable PDF/image snapshots and pdf-lib.copyPages or image pages. Keep outline/annotation/form references consistent; refuse operations whose unsupported cross-page structures cannot be preserved. All destructive page actions confirm affected counts and are undoable before Save.
8. D8. Supported forms: PDFTextField.setText,PDFCheckBox.check/uncheck,PDFRadioGroup.select,PDFDropdown.select,PDFOptionList.select; names from enumerated getFields only, max10000fields/text32767UTF16. Never execute calculations/actions. Rich-text fields, XFA, signatures and unknown form types read-only; if changing another field would require flattening/dropping unknown content, refuse save. updateFieldAppearances uses embedded licensed Inter; unsupported glyph returns missing_glyph, never drops text. Do not call flatten or deleteXFA implicitly.
9. D9. Serialize fresh output with existing objects preserved; independent07d reload/render and dictionary inspection confirm page count, annotations, form values and unchanged unrelated structures. No ignoreEncryption repair mode; encrypted unsupported input gets read-only fallback. Snapshot capture includes content_id; Save delegates09a native commit/source checks/version hook; SaveCopy does not mark original clean. Schema38 -> 39 adds pdf_tools.author string<=128 defaultempty; absent author uses localized Anonymous label at creation, not machine login identity.

## Uses and exports

| Ref | Producer/task/file/revision | Exact dependency |
|---|---|---|
|U1|07d E1-E9;services/pdf.ts,handlers/pdf/pdfCoordinates.ts,webview_helper.rs,pdf_snapshot_resolver.rs;pdf-reader-2/helper-transport-1|openPdfInput(PdfInput),PdfSourceIdentity,PdfRasterSpec/PdfRenderRequest/renderPdfPage/readPdfText and inverse coordinate transform; pdf_write host, native GrantedBacking and snapshot resolver retention |
|U2|08b T2/T3;pdf-write-helper;conversion-presets-1|pdf-lib1.17.1/fontkit1.1.1 and verified licensed Inter asset manifest; no assumed existing font path |
|U3|09a T2;documents/controller.ts;tabs-documents-1|DocumentControllerContext/Binding/factory,notifyContentChanged(content_id),immutable capture/saved_revision semantics |
|U4|09c T1-T3 E1/E2;src/transfer/types.ts,src/transfer/TransferRegistry.ts;content-transfer-1|TransferPayload/Envelope/Target/Action/Receipt;createTransfer/getTransfer/releaseTransfer andregister/describe/accept; validated immutable snapshot/page/image/text offers, never private DataTransfer JSON or guessed OS paths |
|U5|09f approved save;06b versions;08a snapshots/outputs|Version hook and identity-bound commit only when capability true; safe new-name copies/Undo otherwise |

U1 exact coordinate module is `src/handlers/pdf/pdfCoordinates.ts`, with pdfViewportPoint and its inverse as07d E5 specifies. Helper calls use07d E7 run_webview_helper(config,inputs,request,cancel) with multiple named grants and validated WebviewHelperResult outputs. Coordinator extends its fixed action allowlist with pdf.edit.serialize/pdf.edit.inspect in this step; unknown actions remain refused. Sensitive inputs require Memory results and the proved nonpersistent browser route, otherwise helper.sensitive_unsupported.

Canonical types `src/pdf-edit/types.ts`; helper mirror `src/pdf-write-helper/editTypes.ts` imports the same serializable definitions. TS model stays document-owned; no UI model enters session JSON.

| Type | Exact fields |
|---|---|
|PdfPoint/PdfRect|{x:number,y:number} finitepoints / {x:number,y:number,width:number,height:number} nonnegative withinpage |
|PdfPageState|id UUID; origin_source ExportSnapshot; origin_page positiveinteger; rotation0/90/180/270; crop PdfRect; annotation_ids UUID[]<=100000 |
|PdfAnnotation|id UUID;page_id UUID;kind highlight/ink/text/comment/signature;rect PdfRect;color4finite0..1;opacity finite0..1;author string<=128;created_unix safeinteger;text string<=8192;quads PdfPoint[][] optionalexact4each;strokes PdfPoint[][] optional;parent_id optionalUUID;image optionalExportSnapshot;font_size optional6..144 |
|PdfFormValue|field_id string<=512 fromenumeration;kind text/check/radio/choice;value string/bool/string[] matchingkind;readonly bool |
|PdfEditModel|schema_version1;document_id UUID;content_id UUID;pages PdfPageState[]1..10000;annotations PdfAnnotation[]<=100000;forms PdfFormValue[]<=10000;source_snapshot ExportSnapshot;history memorybounded128MiB/1000transactions |
|PdfEditOperation|tagged add_annotation(annotation),update_annotation(id,replacement),remove_annotation(id),set_form(field_id,value),reorder_pages(ids),rotate_pages(ids,quarter_turns integer),delete_pages(ids),insert_pages(after_id nullable,page descriptors[]); allvalidatedatomically |

|Ref|Public export/signature|Consumers|
|---|---|---|
|E1|pdf-edit/PdfEditRegistry.ts acquirePdfEditor(document:DocumentHandle)->Promise<PdfEditController>|14a views,09c page transfer; onecontroller/document |
|E2|PdfEditController getModel()->Readonly<PdfEditModel>;subscribe(listener)->unsubscribe;apply(operation:PdfEditOperation)->Promise<void>;undo/redo()->Promise<void>;capture(revision:number,contentId:string)->Promise<ExportSnapshot>;release()->void|Controller binds09a; no arbitrarytypepayload |
|E3|pdf-edit/serialize.ts serializePdfEdit(model:Readonly<PdfEditModel>,revision:number,contentId:string)->Promise<ExportSnapshot>|09a capture/08a conversion; no disk write |
|E4|pdf-edit/PdfEditor.tsx PdfEditor(props:VirtualViewProps)|Coordinator adds editable presenter to existing PDF handler, not second MIMEclaim |

No new PDF file-writing Tauri endpoint bypasses09a. Helper actions pdf.edit.serialize/pdf.edit.inspect in existing host; boundedtypedpayloaddescriptors, not filebytes. Errors pdf_edit.bad_request/read_only/unsupported/too_large/changed/missing_glyph/signature_change/failed; use errors.pdf_edit.failed for uncategorized display.

## UI/styles/translations/commands

Existing PDF toolbar48px; mode tools Highlight/Draw/Text/Comment/Sign then page menu,Undo/Redo,Save copy/Save. Page thumbnails196pxleft; comments300pxright. Tool properties popover320px,padding12,gap8. SignatureDialog640x400maxviewportminus32, canvas560x220, three tabs Draw/Type/Image. Use token colors; annotation color is document data, selection handles use focus token. `.adp-pdf-overlay` absolute over matching viewport, `.adp-pdf-comment` padding12,border token; keyboard tools via menu, Delete selected annotation with editable-text guard, Escape cancels stroke/tool. Standard focus outline never omitted.

|Keys|English|Spanish|
|---|---|---|
|pdfTools.highlight / pdfTools.draw / pdfTools.text / pdfTools.comment / pdfTools.sign|Highlight / Draw / Text box / Comment / Sign visually|Resaltar / Dibujar / Cuadro de texto / Comentar / Firmar visualmente|
|pdfTools.pages / pdfTools.merge / pdfTools.split / pdfTools.rotate / pdfTools.delete / pdfTools.insert|Page tools / Merge PDFs… / Split PDF… / Rotate pages / Delete pages / Insert pages…|Herramientas de páginas / Unir PDF… / Dividir PDF… / Girar páginas / Eliminar páginas / Insertar páginas…|
|pdfTools.author / pdfTools.anonymous / pdfTools.reply / pdfTools.forms|Comment author / Anonymous / Reply / Form fields|Autor de comentarios / Anónimo / Responder / Campos de formulario|
|pdfTools.visualWarning|This is a visual signature, not a certified digital signature.|Esta es una firma visual, no una firma digital certificada.|
|pdfTools.signatureWarning|Changing this PDF invalidates its existing digital signatures. Save a copy.|Cambiar este PDF invalida sus firmas digitales existentes. Guarda una copia.|
|pdfTools.unsupportedForm|This field cannot be edited without risking unsupported form content.|Este campo no se puede editar sin arriesgar contenido de formulario no compatible.|
|pdfTools.deleteConfirm|Delete {count, plural, one {# page} other {# pages}}? You can undo this before saving.|¿Eliminar {count, plural, one {# página} other {# páginas}}? Puedes deshacerlo antes de guardar.|
|errors.pdf_edit.failed / errors.pdf_edit.missing_glyph|The PDF edit could not be completed. / The export font cannot display some characters.|No se pudo completar la edición del PDF. / La fuente de exportación no puede mostrar algunos caracteres.|

Commands pdf.highlight/draw/text/comment/sign/pages/merge/split/rotate/delete/insert; positional keys above, icons Highlighter/Pencil/Type/MessageSquare/PenTool/Files/Merge/Split/RotateCw/Trash2/FilePlus; no new global shortcut; help pdf-annotations/pdf-comments/pdf-signing/pdf-pages/pdf-forms. Save/Undo commands reuse existing document context. Standard common.cancel/save/saveCopy reused.

## Tasks

|Task;commit|Files and ordered work;Urefs|Tests named:input->oracle|
|---|---|---|
|T1;`feat(pdf): shared immutable edit model [step-14a/T1]`|pdf-edit/types.ts,model.ts,PdfEditRegistry.ts;U1/U3;validate/history/controller factory.|two_views_share_one_model;protected_apply_refused;undo_to_saved_clears_dirty;captureR_editRplus1_keeps_newer_dirty|
|T2;`feat(pdf): standard annotation appearances [step-14a/T2]`|pdf-write-helper/annotations.ts,appearances.ts,annotationInspect.ts;U2.|highlight_dictionary_Highlight_QuadPoints;ink_strokes_exact;freetext_unicode_escaped;existing_unknown_annotation_preserved|
|T3;`feat(pdf): comments replies and visual signatures [step-14a/T3]`|pdf-edit/comments.ts,SignatureDialog.tsx,signature.ts;U1/U2.|reply_IRT_points_parent;signature_Stamp_not_Sig;rotated_pointer_maps_original;signature_image_limit_refused|
|T4;`feat(pdf): bounded page operations [step-14a/T4]`|pdf-edit/pages.ts,PageToolsDialog.tsx;helperpageCopy.ts;U4/U5.|permutation_duplicate_refused;delete_last_refused;merge_pageorder_A1_B1;split_outputs_owned_noreplace|
|T5;`feat(pdf): safe supported form filling [step-14a/T5]`|pdf-edit/forms.ts,FormFields.tsx;helperformWriter.ts;U2.|checkbox_checked_reopens;richtext_refused;XFA_preserved_or_no_save;script_action_never_executed|
|T6;`feat(pdf): revision-safe capture and save controls [step-14a/T6]`|serialize.ts,PdfEditor.tsx,pdf-edit.css;U3/U5.|savecopy_does_not_clean_original;signature_change_requires_copy;failed_save_keeps_model;unsupported_structure_not_silently_dropped|
|T7;`docs(help): PDF tools and compatibility [step-14a/T7]`|Five pagesbelow;coordinator schema39/keys/handlerwiring/reviewerinterop.|annotations_reopen_other_reader;forms_reopen_independent;all_tools_keyboard_help|

## Exact file and test allocation

Feature-owned roots: src/pdf-edit/; src/pdf-write-helper/{editTypes,annotations,appearances,annotationInspect,pageCopy,formWriter}.ts; src/styles/pdf-edit.css. Bare filenames in a task expand inside its feature root; native filenames mean src-tauri/src/ unless an explicit crate path is given. The coordinator owns shared App/Explorer/main, settings schemas, manifests/lockfiles, command/handler/IPC registries, generated locales and asset wiring; workers submit exact insertions rather than editing those shared files. Helpers use the producer's fixed entry/action registry through coordinator integration.

Place every named test in task Tn in the corresponding file below. Rust test modules with private feature access are attached by the owning native module; they are not a fictitious standalone src-tauri library. The listed assertions remain unchanged when split into smaller test files.

|Task|Exact test file|
|---|---|
|T1|src/__tests__/step14a-model.test.ts|
|T2|src/__tests__/step14a-annotations.test.ts|
|T3|src/__tests__/step14a-comments.test.tsx|
|T4|src/__tests__/step14a-pages.test.ts|
|T5|src/__tests__/step14a-forms.test.tsx|
|T6|src/__tests__/step14a-save.test.tsx|
|T7|src/__tests__/step14a-help.test.ts|

Workers write these tests and fixtures but do not execute any command, install, compile, generate assets or claim results. Coordinator runs targeted checks, complete gate/package, real parser/process/file-safety tests and manual evidence. A mock is not evidence of native confinement, interoperability or performance.

## Full help

pdf-annotations.md — English **Highlighting and drawing on PDFs**: “Enable editing, choose Highlight, Draw or Text box and place the mark on a page. Select a mark to change its color, size or text. Undo and Redo change your edit history. Save a copy to keep the original. Marks are written as standard PDF annotations with appearances. Unsupported structures may prevent saving safely. See also: PDF comments; Rearranging PDF pages.” Spanish **Resaltar y dibujar en PDF**: “Habilita la edición, elige Resaltar, Dibujar o Cuadro de texto y coloca la marca en una página. Selecciona una marca para cambiar color, tamaño o texto. Deshacer y Rehacer recorren el historial. Guarda una copia para conservar el original. Las marcas se guardan como anotaciones PDF estándar con su apariencia. Algunas estructuras no compatibles pueden impedir guardar de forma segura. Consulta también: Comentarios en PDF; Reorganizar páginas PDF.”

pdf-comments.md — English **PDF comments**: “Choose Comment and select a page position. Write the comment and add replies in the Comments panel. Set your display author in Settings; it is not proof of identity. Select a comment to edit or delete it, then save a copy. Existing unsupported comments remain untouched. See also: Highlighting and drawing on PDFs.” Spanish **Comentarios en PDF**: “Elige Comentar y una posición de la página. Escribe el comentario y agrega respuestas en el panel Comentarios. Configura el autor visible en Configuración; no demuestra identidad. Selecciona un comentario para editarlo o eliminarlo y guarda una copia. Los comentarios existentes no compatibles no se modifican. Consulta también: Resaltar y dibujar en PDF.”

pdf-signing.md — English **Signing a PDF visually**: “Choose Sign visually, draw or type a signature or select an image, then place and resize it. This is a visual signature, not a certified digital signature. Changing a digitally signed PDF invalidates its existing signature; use Save a copy. Signature images are not stored for reuse by default. See also: PDF comments.” Spanish **Firmar visualmente un PDF**: “Elige Firmar visualmente, dibuja o escribe una firma o selecciona una imagen y después colócala y ajusta su tamaño. Esta es una firma visual, no una firma digital certificada. Cambiar un PDF firmado digitalmente invalida su firma existente; usa Guardar una copia. Las imágenes de firma no se guardan para reutilizarlas de forma predeterminada. Consulta también: Comentarios en PDF.”

pdf-pages.md — English **Rearranging PDF pages**: “Open Page tools. Select thumbnails to rotate or delete pages, drag to reorder, or choose Insert pages or Merge PDFs. Split creates new files for the chosen ranges. The PDF must keep at least one page. Review page order and Undo mistakes before saving. Unsupported cross-page structures may require refusing a change rather than losing data. See also: Filling PDF forms.” Spanish **Reorganizar páginas PDF**: “Abre Herramientas de páginas. Selecciona miniaturas para girar o eliminar páginas, arrastra para reordenar o elige Insertar páginas o Unir PDF. Dividir crea archivos nuevos para los intervalos elegidos. El PDF debe conservar al menos una página. Revisa el orden y deshaz los errores antes de guardar. Las estructuras entre páginas no compatibles pueden exigir rechazar un cambio para no perder datos. Consulta también: Rellenar formularios PDF.”

pdf-forms.md — English **Filling PDF forms**: “Enable editing and select a supported text, checkbox, radio or choice field. Enter a value and save a copy. Calculations and document scripts never run. XFA, signature and unsupported rich-text fields remain read-only; Adperastra does not flatten them silently. Reopen the copy in your other PDF app to inspect important forms. See also: Signing a PDF visually.” Spanish **Rellenar formularios PDF**: “Habilita la edición y selecciona un campo compatible de texto, casilla, opción o lista. Introduce un valor y guarda una copia. Nunca se ejecutan cálculos ni scripts del documento. Los campos XFA, de firma y de texto enriquecido no compatibles permanecen de solo lectura; Adperastra no los aplana silenciosamente. Vuelve a abrir la copia en tu otra aplicación PDF para revisar los formularios importantes. Consulta también: Firmar visualmente un PDF.”

## Fixtures, checks, speed, screenshots and completion

Coordinator retains3-page PDF with CropBox offset10/20, rotations0/90/180, one preexisting unknown annotation, form checkbox/text/radio/dropdown, XFA/digital-signature refusal specimens and two image inputs. Text fixture “Año 2026”; expected highlight rectangle20/30/40/10; validate every geometry after inverse rotation, reply reference, signature Stamp, pagecount/order/form values and source hash. Reopen independent viewer; protected/cancel/neweredits/concurrentviews/sensitive memoryonly;Spanishdark/pseudo/keyboard/200%zoom.

Measure step14a.edit.ready Fast1s after viewer, annotation.apply Instant100ms, ink Smooth16ms, serialize Waiting<=10s orjob. Reserve150-pdf-annotations,151-pdf-pages,152-pdf-forms threevariants. Done: standard interoperable output, unsupported content preserved or operation refused, immutable revision save/version/Undo semantics correct, no visual-signature certification claim; coordinator runs all tests/package/fidelity/accessibility/speed evidence.

## Immutable PDF snapshot and authority integration

T1/T6 register the trusted native PDF controller's encoded MIME application/pdf with08a SnapshotAuthorityRegistry.permit_capture_mime(document_id,mime); the issued source MIME remains descriptive, and source/sensitivity policy cannot be downgraded. Capture freezes the PdfEditModel together with the requested revision/contentId before serialization; serializePdfEdit returns the same document_id/revision/content_id, not a tuple read from live state afterward.

The14a virtualView activation obtains an authorized immutable ExportSnapshot from the same DocumentHandle. It constructs PdfInput kind snapshot with PdfSnapshotRef {snapshot_id,document_id,revision,content_id} and opens it using07d openPdfInput. NativePdfSnapshotResolver verifies every field and retains the exact backing until closePdf; release of a view cannot free another view's active page read. PdfSession.source is the canonical PdfSourceIdentity union. For an edited preview compare its snapshot document/revision/content identity; do not compare it to a disk SourceStamp. Any new capture creates a new PDF session, and late page/text responses from the old session are ignored. Disk readonly opening may use PdfInput kind file with the authorized path/expected stamp. Sensitive virtual input never receives a fake path and never materializes plaintext on disk.

Render requests use raster {kind:bucket,edge:512/1024/2048} for previews or {kind:dpi,value:72..600} for explicit export. Read the returned resolved_scale and rendered_rotation when mapping annotation coordinates; never assume the requested zoom equals rendered pixels. The07d pixel cap rejects impossible DPI. Private-helper preflight failure keeps the view unavailable and sends no sensitive bytes. T1/T6 tests virtual_pdf_uses_snapshot_identity, revoked_provider_cannot_capture, source_mime_does_not_reject_valid_pdf_capture, capture_tuple_frozen_before_encode, stale_pdf_session_response_ignored and render_rotation_uses_resolved_scale.09k encrypted recovery/Save encrypted copy policy stays provider-owned and non-rebinding.
