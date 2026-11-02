# Step 10f: Accessibility and the v0.2 accessibility acceptance bar

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10f-accessibility |
| Tag | v0.2.0 |
| Depends on | 10a contrast/themes;10b keyboard;10c formats/profiles;10e shell registries |
| Written before | 07a was built |
| Interface revision | accessibility-1; read-aloud-1 |

Workers write code/tests/help without execution. Coordinator installs approved assets, applies shared settings/wiring and executes every accessibility/build/package/test/measurement check. A written test is not evidence of a screen-reader pass.

## Goal and exclusions

Use all main flows by keyboard, Narrator/NVDA, high contrast and300%appzoom; offer vision/hearing/motor/cognitive/motion preferences and local installed-voice read aloud. Automatic speech-pack captions are a17b provider integration, specified below; no background microphone capture or new voice synthesis engine. Do not publish a release; milestone readiness needs actual prior-step acceptance and owner publication approval.

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

## Decisions

1. Respect Windows forcedcolors, reducedmotion andtextscaleatstartupandonchange. Webviewmediaqueriesforced-colors/prefers-reduced-motion plusnativeWindowstextscaleinputcoalesceintoEffectiveAccessibility. Effectivezoom=max(userrequested,Windowsrequested),clamp300; donotmultiplyWindows scale twice. ForcedcolorsusestheOSsystempalette,notfixeddarktheme. Backgrounds/materialsdisabledwhileforcedcolorsactive; restorepreferenceswhenitends.
2. Allcontrolsaccessiblelabel/fromlocales; iconbuttonsvisiblenameviaTooltip/aria-label; filelistannouncementcombinesname/type/formattedsize/date withoneICUkey. Virtualizedlistsaria-setsize/posinsetfromlogicalcount,oneactive-descendant/rovingfocusowner,selectioncountpoliteliveupdatesdebounced250ms. Toasterrorsassertive,ordinaryprogresspolitewithmax1announcement/2s; noannouncementoffscreen/inactivecontent. Focusrestoresoncloseandremainsvisible/notobscured.
3. Appzoomoptions75,90,100,110,125,150,175,200,225,250,275,300. Allmainflowsworkat300%withoutcontentloss; dialogsmaxviewportminus16px,internalverticalscrollandstackinglabelsbelow600CSSpx. Mainpointertargetsminimum24x24CSSpx or equivalentspacing;large-targetmode44x44minandrow44. Focusoutline2/3/4pxdefault2; cursorsnormal/large/xlarge useapp-ownedCSScursorimages32/48/64px,noexternalresources.
4. Colorblindmode none/deuteranopia/protanopia/tritanopia applies8colorpalette#E69F00,#56B4E9,#009E73,#F0E442,#0072B2,#D55E00,#CC79A7,#000000 withindexorders0-7;4,1,2,5,6,0,3,7;5,2,0,4,6,1,3,7respectively. Eachsemanticcategoryalsohasdistincttext/icon/pattern;contrastadjustthroughU2pertheme. Do notclaimmedicalcorrectionorabilitytoidentifybycoloralone.
5. Dyslexiafontoption OpenDyslexic usesfourpinnedOFLassetsbelow,regular/bold/italic/bolditalic;offdefault. Letters0-0.2emdefault0,words0-0.5emdefault0,lineheight1-2default1.4. ApplyonlyappUI/ownreaders,neverrewriteuserdocumentfontsorcodesemantics. Monospacedcodekeepsitsfontunlessuserexplicitlychoosesreaderstyle.
6. LocalReadAloudusesWindows.Media.SpeechSynthesis.SpeechSynthesizer installedMicrosoft-signedvoices only; enumerateAllVoices,chosenIDmatchedcurrentinstalledlist,SetVoice,SynthesizeTextToStreamAsync. NoSSMLandnoengineURL. Textplain1-100,000scalars,splitatsentence/spaceboundaries<=1000scalars;onechunksynthesisatonce,20stimeout/32MiBaudiochunk,64MiBcombinedmemory. Audio bytes fromSpeechSynthesisStream/DataReader toGrantedBackingMemory,neverdisk. SensitivecontentneverleaveslocalRAM; no cloudvoicefallback. Stopimmediatelyrevokesqueuedchunks;Pausekeepscurrentchunkmemory;rate0.5-2/volume0-1frontendplayback. FilenameReadAloudreadsselecteddisplaynames,notcontentsimplicitly.
7. Subtitlepreferencesfontpercent75-300default100,textcolor#FFFFFF,bg#000000,opacity0.75,positionbottom/topdefaultbottom;minimumtextcontrast4.5. Apply existing media cues; expose automatic captions only when17b speech provider is registered/available and explicitly requested. Optionalcompletionsoundoffdefault,volume0-1default0.2,onlyappownedsimpletone<=250ms;alwayspairwithvisualtoast,neverflashcontentorinterruptdialogfocus. Noaudio-onlysuccess/error.
8. Motordelaysdoubleclick100-1000msdefaultWindows,hover200-2000msdefault600,dragthreshold2-32CSSpxdefault4; consumers09a/c/10cuseeffectivevaluesfromE1,notcompetingtimers. Click-pick-drop: commandPick upselection creates09clease,clickeligiblefolder/targetasksnormaloperationchoice,Esc/closecancel;nofilechangesuntilacceptednormaldrop. Do notemulateOSdragorholdkeys;StickyKeys/VoiceAccessnamesworkwithvisiblenamedbuttons.
9. Simplemodeoffdefault;hideadvancededitgroups/rare menususingstaticpresentationflags`advanced`addedtoCommand(optionalfalse)andregistrydescriptors,neverdeletefeatures/data. “Explain this”opensfeaturehelp. Optionalconfirm_changesfrom10cremainscanonical; donotduplicate. Progresswordsalwaysincludeaction/count/state,cancellationneverrequiresprecisetiming. Toastexpiry8sordinarybutpausewhilehovered/focused;accessibilitypersistent_toastsfalsecanmakeexplicitdismissonly. Mandatoryconfirmationsnoexpiry.
10. Reducedmotion setting system/on/off defaultsystem;Windowsreducedmotioncannotbeoverriddenoff. Noautoplaysettingtruebydefaultforaccessibilitymodeonly,ordinaryglobaluserpreferencefalsemigration;stillrespectprotectedviewsalwaysnoautoplay. Animationposterfirstframewhenoff,noflashingcontent. Focuslayoutisexistinglayoutpreset overlaythatrestorespriorlayoutonexit,notdestructivereset.
11. EverylaterstepmustreportNarratorandNVDA/keyboard/200%and300%wheremainflow/highcontrast/reducedmotionresults. Revieweractualtoolavailabilityrecorded;missingNVDAisnotpassing. OwnerPCprograminstallationremainsowneractionunlessalreadyapproved;keepallindependentguideauthoringgoing.

## Data and exact exports

Canonical`src/services/accessibility.ts`,native`src-tauri/src/accessibility_types.rs`;sharedhook`src/accessibility/AccessibilityContext.tsx`;readaloud`src/services/readAloud.ts`.

| Type | Exact fields/defaults |
|---|---|
| AccessibilitySettings | large_targetsboolfalse;focus_px2 enum2/3/4;cursor normal/large/xlarge;color_mode enumD4;dyslexic_fontboolfalse;letter_spacing_em0;word_spacing_em0;line_height1.4;simple_modeboolfalse;persistent_toastsboolfalse;reduced_motion system/on/off;no_autoplayboolfalse;double_click_msoptional100-1000;hover_ms600;drag_threshold_px4;completion_soundboolfalse;sound_volume0.2;subtitleSubtitleAccessibility;read_voice_idoptionalstring<=512;read_rate1;read_volume1;auto_captionsboolfalse (17bprovideronly) |
| SubtitleAccessibility | font_percent100;text_color#FFFFFF;background_color#000000;background_opacity0.75;positionbottom/top |
| SystemAccessibility | forced_colorsbool;reduced_motionbool;text_scale finite1-3;double_click_msu16;generation safeu64 |
| EffectiveAccessibility | settingsAccessibilitySettings;forced_colorsbool;reduce_motionbool;effective_zoomnumberallowedU1;target_px24or44;generation safeu64 |
| ReadVoice | idstring<=512;namestring<=128;languagestringBCP47<=64;localboolfixedtrue |
| ReadAloudRequest | textplainstring1-100000;voice_idoptionalstring;document_idoptionalUUID;source_revisionoptionalsafeu64;sensitiveboolnativelyforcedfromdocument; noSSML |
| SpeechChunk | session_idUUID;sequenceu32;tokenUUID;name“speech.wav”;mimestringaudio/wav;byte_lenu64<=32MiB;endbool; nofilesystempath |
| SpeechSession | session_idUUID;chunk_countu32;next_sequenceu32;statepreparing/playing/paused/stopped; currentcontentcapturedrevision,notchanginglivequery |

| ID | Canonical export | Exact signature/consumers |
|---|---|---|
| E1 | accessibility.ts resolveAccessibility/getSystemAccessibility/onSystemAccessibility | resolve(settings,userZoom,systemSystemAccessibility)->EffectiveAccessibility;getSystemAccessibility()->Promise<SystemAccessibility>;onSystemAccessibility(listener)->Promise<UnlistenFn>;nativeaccessibility_system;eventaccessibility-system. AlllaterUIconsumers |
| E2 | AccessibilityContext.tsx useAccessibility | ()->EffectiveAccessibility;providerpropsvalueEffectiveAccessibility,childrenReactNode;noextraneouslocalcopyofsettings |
| E3 | readAloud.ts listReadVoices/startReadAloud/readSpeechChunk/stopReadAloud | list()->Promise<ReadVoice[]>max256;start(request)->Promise<SpeechSession>;chunk(sessionId,sequence)->Promise<SpeechChunk>;stop(sessionId)->Promise<void>. Nativeread_voices/read_aloud_start/read_aloud_chunk/read_aloud_stop;fixed20sboundedasyncchunks,notsharedfilejob |
| E4 | accessibility/ClickPickDrop.ts ClickPickDropController | pick(payloadTransferPayload,sourceDocumentIdstring|null)->Promise<void>;targets()->readonlyTransferAction[];drop(targetId,actionId)->Promise<TransferReceipt>;cancel()->Promise<void>;dispose()->void. Delegates09cE1/E2, no secondpayloadstore |
| E5 | accessibility/announcements.ts AnnouncementQueue | announce(keystring,argsRecord<string,string|number>,prioritypolite/assertive)->void;dispose()->void;max32pending,coalescessamekey,neverdropsassertivefinalerrors;reactoutputescapestext |

Allnativecommandsensure_main/length/type/sensitive/sourceauthorization;errorsaccessibility.invalid,read_aloud.invalid,read_aloud.no_voice,read_aloud.failed,read_aloud.too_large,read_aloud.expired. NativeWinRTcodeinread_aloud.rs/read_aloud_stream.rs;Media_SpeechSynthesis andStorage_Streamsfeaturegatesrecordedwithdependencies. NoaudioJSONorcloudrequests.

## Texts, commands and UI

| Key | English | Spanish |
|---|---|---|
| accessibility.title / accessibility.vision / accessibility.hearing / accessibility.motor / accessibility.cognitive / accessibility.motion | Accessibility / Vision / Hearing / Motor and dexterity / Cognitive and learning / Motion and comfort | Accesibilidad / Visión / Audición / Motricidad y destreza / Comprensión y aprendizaje / Movimiento y comodidad |
| accessibility.largeTargets / accessibility.focus / accessibility.cursor / accessibility.color / accessibility.font / accessibility.letters / accessibility.words / accessibility.lines | Larger targets / Focus outline / Cursor size / Color palette / Dyslexia-friendly font / Letter spacing / Word spacing / Line spacing | Controles más grandes / Contorno de enfoque / Tamaño del cursor / Paleta de colores / Fuente para lectura con dislexia / Espacio entre letras / Espacio entre palabras / Espacio entre líneas |
| accessibility.read / accessibility.stop / accessibility.pause / accessibility.resume / accessibility.voice / accessibility.rate / accessibility.volume | Read aloud / Stop reading / Pause reading / Resume reading / Installed voice / Reading speed / Volume | Leer en voz alta / Detener lectura / Pausar lectura / Reanudar lectura / Voz instalada / Velocidad de lectura / Volumen |
| accessibility.subtitles / accessibility.visual / accessibility.sound / accessibility.pick / accessibility.drop / accessibility.cancelPick | Subtitle appearance / Always show visual feedback / Completion sound / Pick up selection / Drop selection / Cancel picked selection | Apariencia de subtítulos / Mostrar siempre respuesta visual / Sonido al terminar / Recoger selección / Soltar selección / Cancelar selección recogida |
| accessibility.doubleClick / accessibility.hover / accessibility.drag / accessibility.simple / accessibility.explain / accessibility.persistent / accessibility.reduce / accessibility.noAutoplay / accessibility.focusLayout | Double-click delay / Hover delay / Drag distance / Simple mode / Explain this / Keep notifications until dismissed / Reduce motion / Disable autoplay / Focus layout | Demora de doble clic / Demora al mantener el cursor / Distancia de arrastre / Modo sencillo / Explicar esto / Mantener avisos hasta cerrarlos / Reducir movimiento / Desactivar reproducción automática / Distribución de concentración |
| accessibility.fileAnnouncement | {name}, {type}, {size}, modified {date} | {name}, {type}, {size}, modificado {date} |
| accessibility.installedOnly / accessibility.captionsUnavailable | Reading uses only installed Windows voices. / Automatic captions require the local speech pack. Open App storage to install it. | La lectura usa solo voces instaladas de Windows. / Los subtítulos automáticos necesitan el paquete local de voz. Abre Almacenamiento de la aplicación para instalarlo. |
| errors.accessibility.invalid / errors.read_aloud.invalid / errors.read_aloud.no_voice / errors.read_aloud.failed / errors.read_aloud.too_large / errors.read_aloud.expired | These accessibility options are not valid. / This reading request is not valid. / No matching installed voice is available. / Reading could not start. / The speech result exceeds the memory limit. / This reading session has ended. | Estas opciones no son válidas. / Esta solicitud de lectura no es válida. / No hay una voz instalada compatible. / No se pudo iniciar la lectura. / El audio supera el límite de memoria. / Esta sesión de lectura terminó. |

EnumerationsretainliteralpropernamesNarrator/NVDA/OpenDyslexic;newvaluesaccessibility.none/system/on/off/normal/large/xlarge/deuteranopia/protanopia/tritanopia/top/bottom =>“None/System/On/Off/Normal/Large/Extra large/Deuteranopia/Protanopia/Tritanopia/Top/Bottom” and“Ninguno/Sistema/Activado/Desactivado/Normal/Grande/Extragrande/Deuteranopía/Protanopía/Tritanopía/Arriba/Abajo”. Sectionformsmax960px,stackat600px,groupswithh3/help,allfocusableusingkeyboard;readaloudtoolbarbuttons44pxminimum. Commandsapp.accessibility(Accessibility),app.readAloud(Volume2),app.pickSelection(Hand),app.cancelPick(X),app.focusLayout(Focus);labelkeysabove,no newdefaultshortcuts,riskreadonlyexceptpickfinaldropnormalrisk;helpbelow.

## Tasks

| Task; commit | Files/work/imports | Required tests/oracles |
|---|---|---|
| T1 `deps: add pinned OpenDyslexic assets [step-10f/T1]` | coordinatorassetdownloads/licensetable;workerswriteassetmanifesttestonly.U6 | accessibilityAssets.test.ts:fourbytes/hashessourcetablematch;OFLpreserved;nofontfromMicrosoftbundled |
| T2 `feat(accessibility): effective preferences and system state [step-10f/T2]` | accessibility.ts,accessibility_types.rs,accessibility_system.rs,AccessibilityContext.tsx;coordinator schema33/scales/root.U1/U2/U6 | accessibility.test.ts:systemforcedmotionwins;zoommax300notdouble;legacy200unchanged;invalidspacingsreject;forcedcolorsrestorepriorpreferences |
| T3 `feat(accessibility): keyboard focus and responsive main flows [step-10f/T3]` | AccessibleFileAnnouncement.tsx,announcements.ts,styles/accessibility.css;coordinatorsharedcontrols/Toast/Menu/FileList.U1/U3/U4/E5 | accessibilityUi.test.tsx:logicalposinsetwithvirtualrows;oneannounce/2sprogress;focusedtoastnoexpiry;dialog300%stack;alltargets24or44;noinactiveannouncements |
| T4 `feat(accessibility): installed voice read aloud [step-10f/T4]` | readAloud.ts,read_aloud.rs,read_aloud_stream.rs,ReadAloudToolbar.tsx.U5/E3 | readAloud.test.ts/native:1001scalarssplitbounded;SSMLtreatedplain;unknownvoicerefused;32MiB+1failbeforegrant;Stoprevokesall;secretsneversaved;sourceeditdoesnotchangequeuedcapture |
| T5 `feat(accessibility): alternate input and clear presentation [step-10f/T5]` | ClickPickDrop.ts,MotorSettings.tsx,HearingSettings.tsx,CognitiveSettings.tsx,VisionSettings.tsx,MotionSettings.tsx.U2-U4/E1-E4 | accessibleInput.test.ts:pickEsc0changes;dropreusesnegotiation;StickyKeymodifiersnotrequired;simplemodekeepsSettings/help;subtitlecontrast4.5;soundalwaysvisual;noautoplayGIFposter |
| T6 `docs(help): accessibility and milestone acceptance [step-10f/T6]` | sixhelppagesbelow;docs/accessibility/step10f-checklist.md;coordinatorkeys/pseudo/realATchecks/speed/shots.U1-U6 | keyparity/help;axe plusactualNarrator/NVDAflowsrecordedindependently;captionentrydisableduntil17bproviderready;allv0.2capabilitiestraceactualevidence |

## Full help

For each following page use namedtitle, Intro, How to use, Good to know and See also text exactly; no feature can link to an unwritten page.

`accessibility-overview.md`, English **Accessibility**: “Combine the options that make the app easier to use.” How to use: “Open Settings > Accessibility and choose Vision, Hearing, Motor and dexterity, Cognitive and learning or Motion and comfort. Windows high contrast and reduced motion are respected automatically.” Good to know: “All main actions have keyboard routes and visible names. Your files are not changed by display preferences.” See also: “Vision accessibility” and “Motor accessibility”. Spanish **Accesibilidad**: “Combina las opciones que faciliten el uso de la aplicación.” Cómo usar: “Abre Configuración > Accesibilidad y elige Visión, Audición, Motricidad y destreza, Comprensión y aprendizaje o Movimiento y comodidad. Se respetan automáticamente el contraste alto y el movimiento reducido de Windows.” Para tener en cuenta: “Las acciones principales tienen rutas de teclado y nombres visibles. Las preferencias visuales no modifican archivos.” Consulta también: «Accesibilidad visual» y «Accesibilidad motriz».

`accessibility-vision.md`, English **Vision accessibility**: “Adjust zoom, contrast, focus and reading.” How to use: “Choose app zoom, larger targets or focus outlines, a color palette, font and spacing. Read aloud uses an installed Windows voice and has Pause and Stop.” Good to know: “Information also uses labels and icons. A font is a personal preference, not a treatment. Reading stays local and does not install voices.” See also: “Accessibility”. Spanish **Accesibilidad visual**: “Ajusta zoom, contraste, enfoque y lectura.” Cómo usar: “Elige zoom, controles o contornos más grandes, paleta, fuente y espaciado. Leer en voz alta usa una voz instalada y tiene Pausar y Detener.” Para tener en cuenta: “La información también usa etiquetas e iconos. Una fuente es una preferencia personal, no un tratamiento. La lectura es local y no instala voces.” Consulta también: «Accesibilidad».

`accessibility-hearing.md`, English **Hearing accessibility**: “Use visual feedback and readable subtitles.” How to use: “Adjust subtitle size, colors, background and position. Completion sounds are optional and always have a visual notification.” Good to know: “Automatic speech captions are not included. No important information depends on sound alone.” See also: “Accessibility”. Spanish **Accesibilidad auditiva**: “Usa respuesta visual y subtítulos legibles.” Cómo usar: “Ajusta tamaño, colores, fondo y posición de subtítulos. Los sonidos de finalización son opcionales y siempre tienen aviso visual.” Para tener en cuenta: “No se incluyen subtítulos automáticos por voz. La información importante no depende solo del sonido.” Consulta también: «Accesibilidad».

`accessibility-motor.md`, English **Motor accessibility**: “Use the keyboard or pick and drop without holding a drag.” How to use: “Adjust click and hover delays and drag distance. Choose Pick up selection, choose a destination, then Drop selection; Esc cancels. Larger targets help pointer use.” Good to know: “Normal file confirmations still apply. No action requires a timed key hold. Windows Sticky Keys, Voice Access and on-screen keyboards can use named controls.” See also: “Keyboard shortcuts and styles”. Spanish **Accesibilidad motriz**: “Usa teclado o recoge y suelta sin mantener un arrastre.” Cómo usar: “Ajusta demoras de clic y cursor y distancia de arrastre. Elige Recoger selección, el destino y Soltar selección; Esc cancela. Los controles grandes facilitan el puntero.” Para tener en cuenta: “Se conservan las confirmaciones normales. Ninguna acción exige mantener una tecla a tiempo. Teclas especiales, Acceso por voz y teclados en pantalla usan controles con nombre.” Consulta también: «Atajos y estilos de teclado».

`accessibility-cognitive.md`, English **Cognitive accessibility**: “Reduce visual complexity and keep explanations close.” How to use: “Enable Simple mode, optional change confirmations and persistent notifications. Explain this opens the relevant help page.” Good to know: “Simple mode hides advanced controls without deleting features or files. Progress includes words and Cancel where supported.” See also: “Accessibility”. Spanish **Accesibilidad cognitiva**: “Reduce la complejidad visual y mantén cerca las explicaciones.” Cómo usar: “Activa Modo sencillo, confirmaciones opcionales y avisos persistentes. Explicar esto abre la ayuda correspondiente.” Para tener en cuenta: “El modo sencillo oculta controles avanzados sin eliminar funciones ni archivos. El progreso incluye palabras y Cancelar cuando corresponde.” Consulta también: «Accesibilidad».

`accessibility-motion.md`, English **Motion and comfort**: “Limit animation, autoplay and interruption.” How to use: “Choose Reduce motion, disable autoplay or enter Focus layout. Completion sounds remain optional.” Good to know: “Windows reduced motion takes priority. The app does not flash content or move focus for ordinary notifications. Leaving Focus layout restores your previous panels.” See also: “Accessibility”. Spanish **Movimiento y comodidad**: “Limita animación, reproducción automática e interrupciones.” Cómo usar: “Elige Reducir movimiento, desactiva reproducción automática o entra en Distribución de concentración. Los sonidos siguen siendo opcionales.” Para tener en cuenta: “El movimiento reducido de Windows tiene prioridad. La aplicación no hace parpadear contenido ni cambia el enfoque por avisos normales. Salir restaura los paneles anteriores.” Consulta también: «Accesibilidad».

## Reviewer acceptance, speed and screenshots

Retained syntheticfixturescoverfolder10000items,dirtytext,3pagePDF,subtitledmedia,allDialog/Menu/error/loadingstates. ReviewerexecutesmainflowswithNarratorandNVDA,keyboardonly,200/300%zoom,forcedcolors/reducedmotion;recordsactualfailuresandtoolversions. No ATresultinferredfromautomatedtests. Measurestep10f.focus/zoom/simplemodeInstant<100ms;readaloudfirstchunkWaiting1-10swithStop;foregroundbrowseunchanged. Screens128-accessibility-settings,129-high-contrast-300,130-pick-and-read inthreevariants. Done: allnonAIv0.2acceptanceevidencecomplete,noBlocker/Major,coordinatorgate/package/AT/speed/report;publicationstillowneronly.

## Pinned font and API evidence

OpenDyslexic officialrepositorycommit1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7, SILOFL1.1. Rawroot `https://raw.githubusercontent.com/antijingoist/opendyslexic/1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7/`. KeepOFL.txt SHA256caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b.

| Source file | Bytes | SHA-256 | Installed app asset |
|---|---|---|---|
| compiled/OpenDyslexic-Regular.woff2 | 103336 | 0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695 | src/assets/fonts/OpenDyslexic-Regular.woff2 |
| compiled/OpenDyslexic-Bold.woff2 | 108068 | b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf | src/assets/fonts/OpenDyslexic-Bold.woff2 |
| compiled/OpenDyslexic-Italic.woff2 | 107968 | b18685dcb99b4ba903549d215c0ae2ab39a5087097614fd4100ae6d387332b47 | src/assets/fonts/OpenDyslexic-Italic.woff2 |
| compiled/OpenDyslexic-Bold-Italic.woff2 | 118048 | 1aadc8fa9656c92c09c8194790d0671bcd2b4bd961ba41fb8f7e605e5c493be0 | src/assets/fonts/OpenDyslexic-Bold-Italic.woff2 |

OfficialAPI: https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer . Pinnedwindows0.61.3sourceverifiesAllVoices/SetVoice/SynthesizeTextToStreamAsync andStorage_StreamsDataReader.CreateDataReader/LoadAsync/ReadBytes. WCAG2.2target/focusguidance https://www.w3.org/TR/WCAG22/ . Fontbyteswerereadandhashedforplanningonly,notinstalledorcommittedbyworker.

17b speech integration: AccessibilitySettings adds auto_captions boolfalse atschema33, reserved and inactive before17b. A user action invokes17b startTranscription(TranscriptionRequest), pages verified cues with transcriptPage, then applies through applyTranscriptToMedia(documentId,expectedContentId,transcriptId,mode select). Import exact17b TranscriptionRequest/TranscriptInfo/TranscriptPage types; never start dictation/microphone for captions, never use API fallback. E4 there owns cue-to15MediaSubtitleCue conversion and one transaction; failed/cancelled/stale source leaves captions unchanged. T4 testsmissingpack/readyprovider/explicitrequest/cancel/speechwithoutassistant/local0network. Add accessibility.autoCaptions = “Automatic captions” / “Subtítulos automáticos”.

Exact17b captions call: getAutomaticCaptions(input:AiInputRef,language:auto/en/es)->Promise<JobHandle<TranscriptInfo>> in speech.ts E4; transcriptPage(id,first) returns TranscriptPage with TimeUs already integer microseconds. Caption control only explicituseraction; AccessibilitySettings.auto_captions is the canonicalfield, no automatic_captions alias. Before17bprovider, show pack/setupreason.
