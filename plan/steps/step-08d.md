# Step 08d: First-release preparation (v0.1)

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 2/5 |
| Branch | step-08d-release |
| Tag | v0.1.0 (reserved, not created by planning) |
| Depends on | all00-08c feature/acceptance requirements, no openBlocker/Major |
| Written before | 07a was built |
| Interface revision | release-1 |

Guide only. Workers may write release/update/installer code and tests from this guide; they run no build/install/CI/publishing commands. Coordinator verifies locally. Standing owner instructions prohibit remote operations/main changes/releases without renewed authorization; publication always needs the owner's explicit yes.

## Goal and exclusions

Prepare a reproducible unsigned per-user installer, portableZIP,checksums,license/source notices,release notes andinstall/upgrade/uninstall evidence. Include allnon-AIv0.1roadmapcapabilities. No signingcertificate,purchasedservice,automaticupdateinstallation,winget/backlogdistributionorclaimthatunfinishedchecksarepassed.

## Read first

v1 08c releasetext,roadmapv0.1scope; git/testing/security/license rules; current .github/workflows/ci.yml,scripts/package-app.ps1/package-setup.ps1 source only,tauri.conf.json,setup/coremanifestverification,data-rootselection,KNOWN_ISSUES,reports andbenchmarks. Never readprivate .adperastra keys. Default package-app invokes setup packaging: coordinator must use a verified unsigned/reuse-public-manifest path, not blindly launch a private-key signing path.

## Decisions

- D1. Publicartifacts `Adperastra-0.1.0-windows-x64-setup.exe`, `Adperastra-0.1.0-windows-x64-portable.zip`, `SHA256SUMS.txt`, `THIRD_PARTY_LICENSES.txt`, `SOURCE-NOTICES.txt`,release-notes-en.md/release-notes-es.md. Debugbuilds/developerCLI/testfixtures/measurementports/privatekeys/modelweights neverincluded. Sourceversionmustmatchtag/manifest/package metadata,notcurrent0.1.0hardcodedcoincidence.
- D2. InstallerNSISper-userunder `%LOCALAPPDATA%/Programs/Adperastra`,noadminbydefault. Data remains `%LOCALAPPDATA%/Adperastra`,separatefrombinaries. Startmenushortcut/uninstallregistrationownedbyapp. Upgradepreservesdata/settings/versions/packs andcanrollbackbinaryfailures. UninstallerdefaultKeepdata; explicitRemovedataconfirmationlistsversions/settings/caches/packs, sendsrecoverableuserdatafoldertoRecycleBinsafelywithoutfollowingjunctionsorforeignpaths. No blanketrecursiveRemove-Itemoncomputedpaths.
- D3. PortableZIP includesportable-mode.marker (schema1plainappowneddata) anduses `<app>/AdperastraData`; writablepreflightbeforeanydatawrite; ifnotwritableofferChoose datafolder/Cancel,never silentlylose/copysettings. Markeronlycontainsenabledtrue/version1,notpersonalpaths. Fullprofile/portablemanagement10c extends thisbasicselectionwithoutchangingmeaning.
- D4. BuildwithlockedCargo/npm dependencies; exactNode22.19.0/Rust1.99.0 toolchainsforreproduciblebaseline(documentlatersupportedupgradesseparately). ExistingCIchecksretained,releaseworkflowonlymain/tagcommitafterchecks. Builditselfmayneednetworkfordependencies, appat runtimeofflineexceptexplicitopt-infeatures. Noalteredsafetygateorusingdebugbinarywithportasrelease.
- D5. Workflow `.github/workflows/release.yml`: manualbuild/ref/taginputwithstrictformat,checkoutverifiedcommit,installpinnedtoolchains/deps,fullgate/packageunsignedbuild,artifactcontentcheck,checksums,optionalprovenance,uploadartifacts. It contains **no automatic publish job**. A latersignedpublicpackmanifestisowner-suppliedoutsideprivatefolder; agentneverreadsprivatekey. Noauthsecretscommitted.
- D6. VerifiedGitHubactioncommits2026-11-01: checkoutv4 `11d5960a326750d5838078e36cf38b85af677262`;setup-nodev4 `49933ea5288caeca8642d1e84afbd3f7d6820020`;upload-artifactv4 `ea165f8d65b6e75b540449e92b4886f43607fa02`;attest-build-provenancev2 `e8998f949152b193b063cb0ec769d69d929409be`. PintheseSHAswithversioncomments; useminimalcontentsread/artifactpermissions,attestationid-token/attestationswriteonlyinitsjob. Ifrepositoryplanlacksfreeattestation,recordunavailableandkeepchecksums;neverpurchaseplan.
- D7. Updatecheckoffbydefault,schema19 `updates.enabled` false, `updates.last_seen_version` empty, `updates.last_check_unix`0. Explicitmanualcheckoronopt-in atmostonce24h queriesonly `https://api.github.com/repos/stefanods29/Adperastra/releases/latest`, TLSverified,10stimeout,256KiBresponsecap,UserAgentAdperastra/version. AcceptreleaseHTMLURLonlyhostgithub.com/pathstefanods29/Adperastra/releases; ignoreprereleasedrafts;compareparsedSemVer,nolexicalsort. Neverdownloadorinstallanupdate; Openreleasepageisexplicituseraction.
- D8. What'snew localhelpperappversion,showonceafterupdateonlywhenversionchangesandappready; usercandismiss/reopenfromHelp. Do notinterruptunsavedworkorrepeatedlydisplayonfailedsettingswrite. Localizationusesactuales/enreleasecontent; pseudoisgenerated,notamanualrelease.
- D9. v0.1acceptanceincludespending04a-06fowner/runtime/speedevidenceandallknownMajorissues. KI-068/KI-079 alreadyfixed; recheckremainingKI-069/KI-075/KI-087/KI-033/KI-037andcoldstart. Ifreleasefixrequires09f,makeanexplicitreviewedearlierFtaskorleave08dunaccepted; do nottag/releasewithopenMajororclaimfuturestepfixedit. Nomilestonepermissionbypass.

## Uses from other steps

| Ref | Producer; canonical dependency | Exact use |
|---|---|---|
| U1 | 01a setup-core anddependencies.jsonpublicmanifest | Existingverify/checksum/sourceformat; no signingkeyaccess; no unsignedpayloadsubstitution |
| U2 | 01b/05d/06c settings/data-root/help | Existingsettingsmigrate/atomicwrite,language/theme,helpregistry; schema18->19; preserveeverypriorsection |
| U3 | 07a/07d/07f/07g helperassetmanifests | Packagealltrustedhelperentries/workers/fonts/codecsresources actuallyregistered; excludeunregisteredtestpages |
| U4 | 08a/b/c registries andreports | Verifyadvertisedcapabilitiesandlimitations; releasenotesfromobservedbehavior/CHANGELOG,notunbuiltguides |
| U5 | currentgate/CI/package scripts | Sameverificationbar;unsignedpackagingpathandno-debug-portassertions; neverweakenchecks |

## Data shapes and exports for later steps

Canonicalnative `src-tauri/src/updates.rs`,TS `src/services/updates.ts`; releaseartifactmanifest `docs/releases/0.1.0/artifacts.md` (Markdowntable,nopastedconfigcode).

| Ref; name | Exact shape/signature; consumers |
|---|---|
| E1 ReleaseVersion | major/minor/patch u32; optional prereleaseASCIIstring<=64; optionalbuildASCIIstring<=64; parserrejectsleadingzeronumericcomponents/overflow; compareSemVerprecedence,buildnotprecedence |
| E2 UpdateInfo | current_version string<=128; latest_version optionalstring<=128; available bool; release_url optionalvalidatedURLstring; checked_unixu64safeinteger; noinstallerURL/action |
| E3 checkForUpdates | TS(manual boolean)->Promise<UpdateInfo>; native update_check(manual:bool)->Result<UpdateInfo,String>; ensure_main,automaticrefusesifsettingoff/ratecap; manualrequestexplicitconsentbutdoesnotpersistenabled |
| E4 openUpdatePage | TS()->Promise<void>;nativeupdate_open_page() usesonlylastvalidatedreleaseURLfromnativestate,notUIarbitraryURL; unavailableifnone |
| E5 PortableLocation | app_dirabsolutePathBuf; data_dirabsolutePathBuf; portablebool; writablebool; selectorinnewportable.rs;09h/10c/12a/16importratherthanpicknewdatarootsemantics |
| E6 ArtifactRecord | namefixedartifactfilename; sha256lower64hex; byte_lenu64; source_commit40hex; versionSemVerstring; targetwindows-x86_64; unsignedbooltrue; generatedbymetadataafterbuild,nosecret |

Errors updates.disabled/rate_limited/network/invalid_response/unavailable; displayedthroughkeysbelow. NoIPCrequestsacceptrepoURLs/paths/commandtext. No responseincludespersonaldata; diagnosticsdonotlogfullHTTPheaders.

## UI and exact texts

SettingsGeneralsectionaddsUpdatecheckswitchandChecknowbutton;statusinline,normalButton,8pxgap;What'snewHelpbutton; noinstallerprogressor“Installnow”. Errorstatekeepsnormalappusable. Noautomaticnetworkbeforeoptin/manualrequest.

| Key | English | Spanish |
|---|---|---|
| updates.enable | Check for updates | Buscar actualizaciones |
| updates.checkNow / updates.checking | Check now / Checking for updates… | Buscar ahora / Buscando actualizaciones… |
| updates.available | Version {version} is available. | La versión {version} está disponible. |
| updates.current | You have the latest checked version. | Tienes la última versión revisada. |
| updates.openPage | Open release page | Abrir página de la versión |
| updates.whatsNew | What's new | Novedades |
| portable.chooseData / portable.notWritable | Choose data folder… / This portable folder cannot store app data. | Elegir carpeta de datos… / Esta carpeta portátil no puede guardar datos de la aplicación. |
| uninstall.keep / uninstall.remove | Keep my settings and data / Remove my settings and data | Conservar mi configuración y mis datos / Quitar mi configuración y mis datos |
| uninstall.confirm | This removes settings, cached data, packs and version history. Keep a backup before continuing. | Esto quita la configuración, la caché, los paquetes y el historial de versiones. Guarda una copia antes de continuar. |
| errors.updates.disabled / errors.updates.rate_limited | Automatic update checks are off. / An update check was already completed recently. | La búsqueda automática de actualizaciones está desactivada. / Ya se realizó una búsqueda de actualizaciones recientemente. |
| errors.updates.network / errors.updates.invalid_response / errors.updates.unavailable | Updates could not be checked. Try again later. / The update response could not be verified. / No checked release page is available. | No se pudieron buscar actualizaciones. Inténtalo más tarde. / No se pudo verificar la respuesta de actualización. / No hay una página de versión revisada disponible. |

Fullindependentkeysforeachslashentry. Installedartifact/releaseREADMEexplanatorycopyisgivenbelowandtranslatedratherthanEnglish-only installerstrings. Alluninstallerbuttonsandwarningsneedbothlanguages;standardWindowsNSISlocalizedstockstringscanbereusedwithlicensenotices.

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

## Full help and release copy

`installing-and-updating.md`, English **Installing and updating**. Intro: “Install Adperastra for your Windows account or use the portable version.” How to use: “Download the installer or portable ZIP from the project's release page. Verify its checksum first. Run the installer, or unpack the portable ZIP into a writable folder. Updates are optional; a check opens the release page and never installs anything automatically.” Good to know: “This release is unsigned. Windows may show ‘Windows protected your PC’. Verify the download before choosing ‘More info’ and ‘Run anyway’. Upgrades keep settings and files. During uninstall, Keep my settings and data is the default.” Last: `See also: "Verifying a download" and "Portable mode".`

Spanish **Instalar y actualizar**. Intro: “Instala Adperastra para tu cuenta de Windows o usa la versión portátil.” Cómo usar: “Descarga el instalador o el ZIP portátil desde la página de versiones del proyecto. Verifica primero la suma de comprobación. Ejecuta el instalador o extrae el ZIP portátil en una carpeta donde puedas escribir. Las actualizaciones son opcionales; la búsqueda abre la página de la versión y nunca instala nada automáticamente.” Para tener en cuenta: “Esta versión no tiene firma de código. Windows puede mostrar «Windows protegió su PC». Verifica la descarga antes de elegir «Más información» y «Ejecutar de todas formas». Las actualizaciones conservan la configuración y los archivos. Al desinstalar, se elige de forma predeterminada Conservar mi configuración y mis datos.” Last: `Consulta también: «Verificar una descarga» y «Modo portátil».`

`verifying-a-download.md`, English **Verifying a download**. Intro: “Check that a downloaded file matches the project's checksum.” How to use: “Download SHA256SUMS.txt from the same release. In PowerShell, use Get-FileHash with the downloaded file and SHA256. Compare all checksum characters with its matching filename in SHA256SUMS.txt. Do not run a file when the checksums differ.” Good to know: “A checksum detects changed bytes. Check that the release page belongs to stefanods29/Adperastra on GitHub. A build attestation, when supplied, provides additional origin evidence.” Last: `See also: "Installing and updating".`

Spanish **Verificar una descarga**. Intro: “Comprueba que el archivo descargado coincide con la suma publicada por el proyecto.” Cómo usar: “Descarga SHA256SUMS.txt de la misma versión. En PowerShell, usa Get-FileHash con el archivo descargado y SHA256. Compara todos los caracteres con el nombre de archivo correspondiente en SHA256SUMS.txt. No ejecutes un archivo si las sumas son distintas.” Para tener en cuenta: “La suma detecta cambios en los bytes. Comprueba que la página pertenece a stefanods29/Adperastra en GitHub. Una atestación de compilación, si está disponible, añade pruebas del origen.” Last: `Consulta también: «Instalar y actualizar».`

`portable-mode.md`, English **Portable mode**. Intro: “Keep the portable app's data beside the app.” How to use: “Unpack the portable ZIP into a writable folder and start Adperastra. Its data is stored in AdperastraData. Copy the entire portable folder when moving it to another drive, after closing the app.” Good to know: “A read-only folder needs another data location. Moving only the executable does not move settings, history or packs. Keep a backup of important files and version history.” Last: `See also: "Installing and updating".` Spanish **Modo portátil**: “Conserva los datos de la aplicación portátil junto a la aplicación.” Cómo usar: “Extrae el ZIP portátil en una carpeta donde puedas escribir e inicia Adperastra. Los datos se guardan en AdperastraData. Cierra la aplicación antes de copiar toda la carpeta portátil a otra unidad.” Para tener en cuenta: “Una carpeta de solo lectura necesita otra ubicación para los datos. Mover solo el ejecutable no mueve la configuración, el historial ni los paquetes. Conserva una copia de los archivos importantes y del historial de versiones.” Last: `Consulta también: «Instalar y actualizar».`

`whats-new-0-1.md`, title **What's new in 0.1** / **Novedades de la versión 0.1**. English intro/body: “This version brings Explorer tabs, safe file operations with Undo, built-in viewers, text editing, version history, archives, PDF reading, local text recognition, conversion and optional privacy cleaning. Check the release notes for tested formats and current limits. No AI pack is required.” Spanish: “Esta versión incorpora pestañas del Explorador, operaciones de archivos con Deshacer, visores integrados, edición de texto, historial de versiones, archivos comprimidos, lectura de PDF, reconocimiento de texto local, conversión y limpieza opcional de información privada. Revisa las notas de la versión para conocer los formatos probados y los límites actuales. No se necesita un paquete de IA.” Publishthiscopyonlyafterallclaimsareverified; pendingclaimsremovedbycoordinatorwithrecordedscopedecision,neverbyworkerinventedcopy.

## Check by hand / speed / screenshots / checkpoint

CoordinatorusescleanWindows11Sandboxwithsyntheticdata,recordsOS/WebView2version/networkavailabilityandallinstall/upgrade/uninstall/portablematrixrows. Nevertestuninstallonowner'sactualappdata. Measurestartup5runs,commoninteractions7runs,100kfolderandallfiletypes;recordcold/warmandpreviousJSONcomparison. Reserve88-release-install,89-release-update-settings,90-release-whats-new inen/light/esdark/pseudo(lightwhereUIapplies);installerEnglish/Spanishcapturesseparateownedfilenames.

**OWNER CHECKPOINT at publication only:** afterverifiedartifacts/releasenotes/checksumsandreadinessreportexist, askplainlybeforepublishing. Ifsignedpublicpackmanifest/accountpermissionisneeded, requestthepublicartifact/owneractionwithoutreadingprivatekeys; finishallindependentwork. Continueauthoringlaterguideswhilewaiting; do not publish, push or change main undercurrentlocal-onlyauthorization.

## Done when

- [ ] Testedunsignedartifacts/allowlistedcontents/checksums/license/source noticesandbilingualguidanceexistwithrecordedprovenance.
- [ ] Defaultdata-preservinginstall/upgrade/uninstall/portable/updatechoicesandallrequiredmilestoneevidencepass; noopenBlocker/Major.
- [ ] ExactE1-E6contractsusedbylaterprofiles/packs/recovery/Windowsintegrationguides; currentguidemerelydefineswork,notreleaseacceptance.
- [ ] Ownerexplicitlyauthorizespublicationbeforeanypublicrelease;untilthenpreparedlocalartifactsareclearlylabelledunpublished.
