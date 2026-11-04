# Step 10a: Theme editor, day/night switching and wallpaper accents

| Field | Value |
|---|---|
| State | guide; documentation reviewed; implementation not started |
| Difficulty | 3/5 |
| Branch | step-10a-theme-editor |
| Tag | v0.1.12-step10a |
| Depends on | 05d appearance;07a cache/background;09d palette |
| Written before | 07a was built |
| Interface revision | custom-theme-1 |

Guide only. Workers write owned code, tests, styles and help without executing commands, builds, tests or installations. The coordinator owns shared wiring, dependency changes, generators, all executed verification and accepted commits.

## Goal and exclusions

Edit, preview, save and exchange custom themes; select independent day/night appearances; switch with Windows or a clock schedule; choose readable accents from the local wallpaper. Toolbar/shortcut customization belongs to10b, tab/format/profile options to10c, folder backgrounds to10d. No remote theme store, executable CSS, font redistribution or AI.

The v1 assertion that sunrise/sunset is determined from time zone without location is incorrect. This step supports Windows and fixed local-time schedules. Astronomical switching is explicitly unavailable; it needs a separately approved location input and specification. Do not fabricate sunrise from clock times or silently request location.

## Read first

Read v1 step10a theme/automatic/accent scope,05d guide, themes/*.tokens.json and their token generator, `src/appearance/themes.ts`, `applyAppearance.ts`, `src/services/settings.ts`, native appearance.rs, current accent functions/main settings validation,07a cache and decode contracts,09d palette provider interface, add-settings/dependency/help recipes. Existing shared files are coordinator-owned.

## Decisions and algorithms

1. Built-in ThemeId/LightThemeId/DarkThemeId and existing THEMES remain unchanged. Introduce ThemeRef: builtin with id ThemeId, or custom with UUID. Existing ThemeSettings continues to describe legacy choices; schema28 adds theme_custom below. Migrate schema27 by mapping the actual legacy light/dark choices, preserving mode/accent. Built-in theme files are never overwritten by editing.
2. A custom theme is a bounded data file `.adptheme` schema1, not arbitrary CSS. Start by copying a built-in token snapshot. Token paths must exist in the current `themes/light.tokens.json` schema; underscore-prefixed notes are not tokens. Colors are normalized #RRGGBB or #RRGGBBAA; lengths use finite pixel values in the explicit bounds below. Unknown token paths are refused. Save catalog under `<data>/themes`, at most100themes/16MiB total excluding images, atomic app-state writes.
3. ThemeEditor Dialog width960px/maxviewport minus32, heightmaxviewport minus32; left controls320px, gap16, live preview remainder min280px, editor tab focus never lost on each update. Preview applies only to its subtree through CSSOM custom properties and the same appearance renderer; Cancel restores prior live root state, Save validates before persistence. Editing starts a separate draft; no disk write until Save.
4. Material solid/mica/acrylic uses existing Tauri2.12.5 `WebviewWindow::set_effects` and EffectsBuilder, not a new library. Unsupported Windows builds or high contrast fall back to solid and expose requested/applied values. Never make text/panes transparent to simulate native blur. Background image is explicit local input, helper-decoded/downscaled max4096edge/16MP, cached owned PNG; source max64MiB. Opacity0-0.5 default0.15, blur0-32px default0, fit fill/fit/tile. Replacing/closing draft releases leases; no raw file-path URL.
5. UI font choices are builtin Inter, system-ui or installed font family from native bounded enumeration. Do not copy installed font files into themes. Font size10-24px default12, tab shape square/rounded/pill defaultrounded, icon mode lucide/system defaultlucide. System icons use existing Windows image/shell helper and fallback to Lucide; theme import cannot add an executable icon provider. Editor palette is a second allowlisted token map scoped to editor surfaces, not global CSS.
6. Optional “Custom style” is a data editor with one declaration per row: selector is exactly .adp-window, .adp-tab, .adp-command-bar or .adp-filelist-scroll; property only border-radius,padding-inline,padding-block,letter-spacing,line-height; numeric value/unit only, bounds radius0-16px,padding0-24px,spacing0-2px,lineheight1-2. No selectors, strings, URLs, at-rules, functions, custom properties or raw CSS text. Store ThemeStyleRule[], generate trusted CSSOM rules from validated rows. Label this limitation clearly.
7. ThemeSchedule mode manual/windows/clock defaultwindows; day_start_minute420(07:00),night_start_minute1140(19:00), each0-1439 distinct. Clock day interval includes start and excludes night start, wraps midnight. Use current Windows local time; recompute on system time/timezone change and resume, plus minute timer. DST follows resulting local minute, no duplicate toggles for repeated minute. Temporary title-bar override light/dark expires at the next actual schedule transition; it is runtime only, not persisted across restart.
8. Palette from wallpaper: read local path through SPI_GETDESKWALLPAPER with fixed32768UTF16buffer; failure returns unavailable. Never scan unrelated pictures. Use07a helper to sample at most256x256pixels, skip fully transparent, quantize RGB to5bits/channel, count histogram, sort count descending then packedRGBascending. Pick at most6 bins separated EuclideanRGB distance>=40; representative is per-bin mean rounded to nearest integer. Follow-wallpaper opts in to Windows wallpaper-change notifications/debounced1s; do not repeatedly read when disabled or ineligible background policy.
9. Contrast: convert sRGB components to linear using threshold0.04045, exponent2.4; luminance0.2126R+0.7152G+0.0722B; ratio(Lmax+0.05)/(Lmin+0.05). Choose black or white on-accent with higher ratio; require4.5 for normal text and3 for large text/focus/nontext. An invalid accent is adjusted by testing linear interpolation toward black and white in1/255steps and selecting the smallest RGB-distance candidate satisfying all declared adjacent surfaces; ties choose darker. If none, retain built-in accent and show warning. Never silently export an unreadable theme as verified.
10. Override file-type accents only canonical IDs explorer/excel/word/pdf/image/powerpoint/group, no vendor logo/artwork. Import validates fully before showing preview; Apply is explicit. Export includes data and optional owned background image, never original absolute paths/installed font bytes/history. User-file export uses owned no-replace publication.

## Uses from other steps

| ID | Producer/task; canonical symbol | Exact dependency |
|---|---|---|
| U1 | 05d `src/appearance/themes.ts`: THEMES,themeScheme(id ThemeId)->light/dark,resolveThemeId(theme,systemDark)->ThemeId | Preserve these built-in functions; custom resolution is E2, not a broadened lie about old ThemeId |
| U2 | 05d `src/appearance/applyAppearance.ts`: applyThemeAttributes(root,theme,systemDark),applyAppearanceAttributes(root,appearance) | Coordinator delegates new custom layer after legacy attributes; existing density/radius/motion semantics retained |
| U3 | 07a T2/T3/E1/E3/E5/E8 cache SourceStamp/CacheLease/decode_pixels | Cache owned theme-background decode only; source chosen explicitly; release leases on draft/root disposal |
| U4 | 09d T4/E3 PaletteRegistry.registerProvider | Theme actions register static provider, no imported executable callback |
| U5 | 05d settings defaultSettings/normalizeSettings/loadSettings/saveSettings and native validate/migrate | Bump27->28 in both languages/fixtures, default additive new fields, unknown/newer imports fail without mutation |
| U6 | 06e owned_io::OwnedOutput/ClosedOutput and fs-service::atomic_write | User export no-replace; app-owned catalog atomic. Never cleanup arbitrary path |

## Data shapes and exports

Canonical DTO `src/services/customThemes.ts`, native `src-tauri/src/custom_theme_types.rs`; pure colors/schedule in `src/appearance/themeMath.ts`, Rust validation mirror `crates/fs-service/src/theme_data.rs`.

| Type | Exact fields/defaults/limits |
|---|---|
| ThemeRef | kind builtin {id ThemeId} or custom {id UUID}; no arbitraryfilename |
| ThemeColor | normalized #RRGGBB or #RRGGBBAA, alpha allowed only background/style colors; contrast text colors opaque |
| ThemeStyleRule | selector oneofD6;property oneofD6;value finitef64;unit px forradius/padding/spacing,ratio forline-height |
| ThemeBackground | asset_id optionalUUID;fit fill/fit/tile;opacity finite0-0.5;blur_px integer0-32; no externalpath |
| CustomTheme | schema_version1;id UUID;name1-60Unicode;scheme light/dark;tokens Record<knownTokenPath,string|number>max512;editor_tokens same max64;material solid/mica/acrylic;ui_font string<=128 allowlisted installedfamily/builtin;ui_font_size_px10-24;tab_shape square/rounded/pill;icon_mode lucide/system;styles ThemeStyleRule[]max32;background optionalThemeBackground;modified_unixsafeu64 |
| CustomThemeSummary | id UUID;name string1-60;scheme light/dark;modified_unix safeu64;has_background bool. No token maps or asset bytes; list at most100 summaries |
| ThemeCustomSettings | day ThemeRef;night ThemeRef;mode manual/windows/clock;manual_scheme light/dark defaultlight;day_start_minute420;night_start_minute1140;follow_wallpaper boolfalse;type_accents partialRecord<canonicalID,ThemeColor>defaultempty |
| ThemeRuntime | requested ThemeRef;applied ThemeRef;scheme light/dark;material_requested/applied enum;temporary_override bool;warning_codes string[]max16 |
| WallpaperPalette | colors ThemeColor[]max6;source_stamp optionalSourceStamp;available bool;reason optionaltheme.wallpaper_unavailable |

| ID | Canonical export | Exact signature; consumers |
|---|---|---|
| E1 | services/customThemes.ts listCustomThemes/readCustomTheme/saveCustomTheme/removeCustomTheme | list()->Promise<CustomThemeSummary[]>;read(id string)->Promise<CustomTheme>;save(theme CustomTheme)->Promise<CustomTheme>;remove(id string)->Promise<void>. Native theme_list/theme_read(id)/theme_save(theme)/theme_remove(id), main-only.10e setup |
| E2 | appearance/themeResolver.ts resolveTheme | (settings ThemeCustomSettings,builtins readonlyThemeEntry[],custom readonlyCustomTheme[],systemDark bool,localMinute number,override light/dark|null)->ThemeRuntime; missingcustom fallsback light/dark correspondingbuiltin withwarning |
| E3 | services/customThemes.ts importTheme/exportTheme/wallpaperPalette | importTheme(path string)->Promise<CustomTheme> validateddraft, noapply;exportTheme(id string,destPath string,includeImage bool)->Promise<{path:string,bytes:number}>;wallpaperPalette()->Promise<WallpaperPalette>. Native theme_import/theme_export/theme_wallpaper_palette |
| E4 | appearance/themeMath.ts contrastRatio/resolveReadableAccent/scheduleScheme | contrastRatio(a ThemeColor,b ThemeColor)->number;resolveReadableAccent(candidate,backgrounds readonlyThemeColor[])->{accent,on_accent,adjusted:boolean};scheduleScheme(minute number,dayStart number,nightStart number)->light/dark.10d/10f/11b share contrast |
| E5 | appearance/ThemeEditor.tsx ThemeEditor | props draft CustomTheme,onSave(theme)->Promise<void>,onCancel()->void,onOpenHelp(slug)->void; runtimevalues bounded; no invoke incomponent |
| E6 | services/customThemes.ts listSystemFontFamilies | ()->Promise<string[]>max1000, each<=128; native theme_system_fonts; Win32 EnumFontFamiliesExW familycallback copies boundedUTF16, unique NFCnames sortordinal; no fontbytes returned |

All new commands use ensure_main, strict path/ID/type/length validation and spawn_blocking for disk work. Errors theme.invalid,theme.limit,theme.io,theme.unavailable,theme.wallpaper_unavailable,theme.contrast. Each theme is at most128KiB serialized; summary list at most128KiB, so every result is below768KiB. Reject oversized data before persistence; return shapes never depend on timing or size.

## Texts, styles and commands

| Key | English | Spanish |
|---|---|---|
| themeEditor.title / themeEditor.new / themeEditor.save / themeEditor.import / themeEditor.export | Theme editor / New theme / Save theme / Import theme… / Export theme… | Editor de temas / Nuevo tema / Guardar tema / Importar tema… / Exportar tema… |
| themeEditor.name / themeEditor.preview / themeEditor.material / themeEditor.solid / themeEditor.mica / themeEditor.acrylic | Theme name / Live preview / Window material / Solid / Mica / Acrylic | Nombre del tema / Vista previa en vivo / Material de ventana / Sólido / Mica / Acrílico |
| themeEditor.background / themeEditor.opacity / themeEditor.blur / themeEditor.font / themeEditor.fontSize / themeEditor.tabShape / themeEditor.icons / themeEditor.editorColors | Background image / Opacity / Blur / Interface font / Font size / Tab shape / Icons / Editor colors | Imagen de fondo / Opacidad / Desenfoque / Fuente de interfaz / Tamaño de fuente / Forma de pestaña / Iconos / Colores del editor |
| themeEditor.style / themeEditor.styleLimit | Custom style / Only the listed spacing and corner properties are allowed. | Estilo personalizado / Solo se permiten las propiedades indicadas de espaciado y esquinas. |
| themeSchedule.title / themeSchedule.day / themeSchedule.night / themeSchedule.windows / themeSchedule.clock / themeSchedule.manual / themeSchedule.dayStart / themeSchedule.nightStart | Day and night / Day theme / Night theme / Follow Windows / Scheduled times / Manual / Day starts / Night starts | Día y noche / Tema diurno / Tema nocturno / Seguir Windows / Horarios programados / Manual / Comienza el día / Comienza la noche |
| themeSchedule.override / themeSchedule.sunUnavailable | Override until the next switch / Sunrise and sunset switching is not available without location information. | Cambiar hasta el próximo horario / El cambio al amanecer y anochecer no está disponible sin información de ubicación. |
| themeAccent.title / themeAccent.wallpaper / themeAccent.follow / themeAccent.adjusted / themeAccent.fallback | Accent colors / Wallpaper colors / Always follow wallpaper / The accent was adjusted for readable contrast. / A safe built-in accent was kept. | Colores de énfasis / Colores del fondo de pantalla / Seguir siempre el fondo de pantalla / Se ajustó el color para mantener un contraste legible. / Se conservó un color predeterminado seguro. |
| errors.theme.invalid / errors.theme.limit / errors.theme.io / errors.theme.unavailable / errors.theme.wallpaper_unavailable / errors.theme.contrast | This theme is not valid. / The theme storage limit has been reached. / The theme could not be saved or opened. / This theme option is not available on this PC. / Wallpaper colors are not available. / These colors do not meet the contrast requirements. | Este tema no es válido. / Se alcanzó el límite de almacenamiento de temas. / No se pudo guardar o abrir el tema. / Esta opción de tema no está disponible en esta PC. / No están disponibles los colores del fondo de pantalla. / Estos colores no cumplen los requisitos de contraste. |

Enumlabels notalreadyexisting use themeEditor.fit/fill/tile/square/rounded/pill/lucide/system with English “Fit/Fill/Tile/Square/Rounded/Pill/Lucide/System” and Spanish “Ajustar/Rellenar/Mosaico/Cuadrada/Redondeada/Cápsula/Lucide/Sistema”; typeaccentlabels reuseexistingtranslatedtypekeys. Commands appearance.editTheme Palette icon labelthemeEditor.title,appearance.toggleDayNight SunMoon labelthemeSchedule.override, no defaultshortcut, riskchange, helpbelow. CSS selectors adp-theme-editor/adp-theme-preview/adp-theme-token-row use32pxrows/8pxgaps/currenttokens; focusoutline2pxaccent, no sourceprovidedCSS.

## Tasks

| Task; commit | Files, order and dependencies | Named tests/oracles |
|---|---|---|
| T1 `feat(theme): custom theme data and schema [step-10a/T1]` | customThemes.ts,custom_theme_types.rs,theme_data.rs; define DTO, whitelist, legacy migration28; coordinator settings/fixtures. U1/U5 | themeData.test.ts/native: `legacy_day_night_refs_preserved`; `unknown_token_rejected`; `url_style_rejected`; `one_hundred_first_theme_refused` |
| T2 `feat(theme): bounded theme storage and transfer [step-10a/T2]` | custom_theme_store.rs,theme_transfer.rs,theme_assets.rs; E1/E3, ownedimagecopy, atomiccatalog. U3/U6 | `failed_import_does_not_apply`; `export_never_contains_source_paths`; `collision_does_not_replace`; `image_decode_cap_precedes_allocation`; `remove_active_theme_falls_back` |
| T3 `feat(theme): live safe theme rendering [step-10a/T3]` | ThemeEditor.tsx,ThemeTokenEditor.tsx,themeResolver.ts,styles/themeEditor.css; coordinator rootapply andmaterialadapter. U1-U3/E2/E5 | themeEditor.test.tsx: draftpreviewdoesnotchangeglobalroot;cancelrestores;invalidcontrastblocksSave;materialfallbackvisible;installedfontnosourcebytes |
| T4 `feat(theme): scheduled day and night appearances [step-10a/T4]` | themeSchedule.ts,useThemeSchedule.ts,DayNightSettings.tsx; U2/E2 | themeSchedule.test.ts:419night/420day/1139day/1140night;wrapday1200night360 =>0day;equalstartsreject;overrideresetsatnexttransition;timezonechangeresolvesonce |
| T5 `feat(theme): wallpaper palette and readable accents [step-10a/T5]` | theme_wallpaper.rs,theme_fonts.rs,themeMath.ts,WallpaperAccentPicker.tsx; U3/E4/E6 | themeMath.test.ts: black/whitecontrast21;samergb1;binfrequencytiespackedRGB;transparentignored;noautomaticreadwhenoff;allchosenaccenttext>=4.5 |
| T6 `docs(help): custom themes and scheduled appearances [step-10a/T6]` | fullhelppagesbelow; docs/theme-authoring.md; coordinator keys/pseudo/registries/screenshots/measures. U1-U6 | allthemefilefieldsdocumented;English/esargumentparity;CSSwhitelisttests;oldbuiltinthemebuttoncountsupdatedonlyforseparatecustomsection |

## Full help

`theme-editor.md`, English **Theme editor**. Intro: “Create a local appearance and preview it before applying.” How to use: “Open Settings > Theme editor. Start from a built-in theme, change the listed colors and appearance options, then choose Save theme. Import theme opens a preview; it does not apply immediately.” Good to know: “Only safe data is imported. Installed fonts are referenced by name and are not included in exported themes. Unsupported materials use a solid fallback.” See also: “Day and night themes” and “Accent colors”. Spanish **Editor de temas**: “Crea una apariencia local y revísala antes de aplicarla.” Cómo usar: “Abre Configuración > Editor de temas. Parte de un tema predeterminado, cambia los colores y opciones indicados y elige Guardar tema. Importar tema abre una vista previa; no lo aplica de inmediato.” Para tener en cuenta: “Solo se importan datos seguros. Las fuentes instaladas se indican por nombre y no se incluyen al exportar temas. Los materiales no compatibles usan un fondo sólido.” Consulta también: «Temas diurnos y nocturnos» y «Colores de énfasis».

`day-and-night-themes.md`, English **Day and night themes**: “Choose separate appearances for day and night.” How to use: “Select both themes and choose Follow Windows, Scheduled times or Manual. For a schedule, enter different day and night start times. The title-bar toggle overrides until the next switch.” Good to know: “Schedules follow this PC’s local clock. Sunrise and sunset require location information and are not offered in this version. High contrast overrides decorative materials.” See also: “Theme editor”. Spanish **Temas diurnos y nocturnos**: “Elige apariencias distintas para el día y la noche.” Cómo usar: “Selecciona ambos temas y elige Seguir Windows, Horarios programados o Manual. Indica horarios de inicio distintos. El botón de la barra de título cambia el tema hasta el próximo horario.” Para tener en cuenta: “Los horarios siguen el reloj local de esta PC. El amanecer y anochecer necesitan información de ubicación y no se ofrecen en esta versión. El contraste alto sustituye los materiales decorativos.” Consulta también: «Editor de temas».

`accent-colors.md`, English **Accent colors**: “Choose readable colors for actions and file types.” How to use: “Open Accent colors, select a wallpaper color or enter a color. Enable Always follow wallpaper only if you want automatic local updates. Override individual file-type accents when needed.” Good to know: “The app adjusts unsafe contrast or keeps a built-in color. Wallpaper colors stay on this PC and are not uploaded.” See also: “Theme editor”. Spanish **Colores de énfasis**: “Elige colores legibles para acciones y tipos de archivo.” Cómo usar: “Abre Colores de énfasis, selecciona un color del fondo de pantalla o indica uno. Activa Seguir siempre el fondo de pantalla solo si quieres actualizaciones locales automáticas. Cambia colores de tipos de archivo cuando lo necesites.” Para tener en cuenta: “La aplicación ajusta el contraste insuficiente o conserva un color predeterminado. Los colores permanecen en esta PC y no se envían.” Consulta también: «Editor de temas».

`docs/theme-authoring.md` must reproduce CustomTheme/ThemeStyleRule tables, bounds, safe import/export and font-license exclusions in plain language; no generated source examples or claims all CSS is supported.

## Check by hand, speed, screenshots and done

Retained fixtures:6x1PNG pixels red/red/blue/blue/green/transparent;validtheme clonedfromlight withname“Example”;invalidunknownproperty;imageoverlimit;missingcustomreference. Coordinator verifieshistogramtie/colors,Cancel/Save/import/export/nooverwrite,restart/schedule/timezone/suspend/materialfallback/highcontrast,Spanishdark,pseudo,keyboard/200%zoom. No userwallpaperchange required: injectedfixedimage andclock used.

Measures step10a.theme.preview/apply/toggle Instant<100ms;wallpaperpalette Fast<1s withskeletonandbackgroundpolicy;startup noextraimageparseonmainthread. Reserve114-theme-editor,115-day-night,116-wallpaper-accent inthreevariants. Done: exactcontracts/keys/helperbounds,alloldbuiltinswork,contrastchecksindependent,coordinatorgate/package/runtime/speedreportrecorded. No invented astronomical mode.

## Verified API evidence

Tauri2.12.5 local source `src/webview/webview_window.rs` has set_effects; `src/window/mod.rs` EffectsBuilder.effect/effects/build. windows0.61.3 Win32_UI_WindowsAndMessaging has SystemParametersInfoW and SPI_GETDESKWALLPAPER. Win32_Graphics_Gdi has EnumFontFamiliesExW(hdc HDC,logfont pointer,callback FONTENUMPROCW,lparam LPARAM,flags u32)->i32. Callback lifetime is the synchronous enumeration call; copy family names before returning. No new external library is selected.
