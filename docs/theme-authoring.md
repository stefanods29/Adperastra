# Authoring an Adperastra theme

Adperastra themes are local data files, not stylesheets. A `.adptheme` file can change the listed colours and a small set of appearance values. It cannot run code, load remote content, or contain arbitrary CSS.

This page describes the file format that the app reads and writes. It is also a compatibility promise: an unknown token path or style value is refused on import, and an unknown top-level field is ignored rather than executed.

## File types

- **Theme file** (`.adptheme`): a JSON package containing one `CustomTheme` and, optionally, one owned PNG background image.
- **Theme catalog**: app-owned files under the Adperastra data folder. The app manages these; users normally export and import theme files instead of editing the catalog.
- **Background image**: stored as an owned PNG. Original image paths, installed font files and history are never stored in a theme.

## CustomTheme

| Field | Type | Required | Limit |
|---|---|---|---|
| `schema_version` | number | yes | exactly `1` |
| `id` | string | yes | a UUID; the app assigns a new one for a new draft |
| `name` | string | yes | 1–60 Unicode characters, trimmed, no control characters |
| `scheme` | string | yes | `light` or `dark` |
| `tokens` | object | no | at most 512 entries; each key must be a listed token path |
| `editor_tokens` | object | no | at most 64 entries; only the listed syntax-colour paths |
| `material` | string | yes | `solid`, `mica` or `acrylic` |
| `ui_font` | string | yes | `Inter`, `system-ui`, or an installed family name of at most 128 characters |
| `ui_font_size_px` | number | yes | integer from 10 to 24 |
| `tab_shape` | string | yes | `square`, `rounded` or `pill` |
| `icon_mode` | string | yes | `lucide` or `system` |
| `styles` | array | no | at most 32 rules (see below) |
| `background` | object | no | see below |
| `modified_unix` | number | no | non-negative whole seconds since 1970 |

Each theme may be at most 128 KiB when serialized. The catalog holds at most 100 themes and at most 16 MiB of theme data, not counting images. A theme that exceeds a limit is refused before anything is saved.

## Theme tokens

A token value is either a colour or a finite pixel number. A colour is written as `#RRGGBB` or, where the token allows transparency, `#RRGGBBAA`. Text colours must be opaque so contrast checks are meaningful. Alpha is accepted only for surface, `accentLight`, and syntax match colours.

The editable colour paths are:

- `color.surface.*`: `window`, `chrome`, `pane`, `sidebar`, `selected`, `tabInactive`, `header`, `segmentTrack`, `canvasDoc`, `canvasMedia`, `selectedRow`
- `color.text.*`: `primary`, `secondary`, `tertiary`, `bodyMuted`, `onAccent`
- `color.border.*`: `default`, `subtle`, `panel`, `input`, `chip`
- `color.accent.*`: `explorer`, `excel`, `word`, `pdf`, `image`, `powerpoint`, `group`
- `color.accentDark.*`: `excel`, `word`
- `color.accentLight.*`: `explorer`, `excel`, `word`, `image`, `group`
- `color.status.*`: `caution`, `cautionBackground`
- `syntax.*`: `keyword`, `string`, `number`, `comment`, `function`, `type`, `tag`, `attribute`, `property`, `invalid`, `match`, `matchSelected`

The editable numeric paths and bounds are:

| Paths | Meaning | Bounds |
|---|---|---|
| `font.size.tiny` … `font.size.gallerySample` | text sizes in pixels | 8–48 |
| `radius.xs` … `radius.round` | corner radii in pixels | 0–32 |
| `space.0` … `space.10` | spacing in pixels | 0–64 |

`font.family` and `shadow.*` are not theme tokens. Fonts are chosen through `ui_font`, and shadow strings would be raw CSS. Notes whose names begin with `_` are comments in the built-in files and are never tokens.

`editor_tokens` uses only `syntax.*`, so the code editor can have its own palette without changing every surface.

## ThemeStyleRule

| Field | Type | Allowed values |
|---|---|---|
| `selector` | string | `.adp-window`, `.adp-tab`, `.adp-command-bar`, `.adp-filelist-scroll` |
| `property` | string | `border-radius`, `padding-inline`, `padding-block`, `letter-spacing`, `line-height` |
| `value` | number | finite; see bounds below |
| `unit` | string | `px` for the first four properties, `ratio` for `line-height` |

| Property | Bounds |
|---|---|
| `border-radius` | 0–16 px |
| `padding-inline` | 0–24 px |
| `padding-block` | 0–24 px |
| `letter-spacing` | 0–2 px |
| `line-height` | 1–2 |

The app turns these rows into trusted style rules itself. It does not accept a CSS text field, a selector expression, a URL, an at-rule, a function, a custom property or a raw declaration. The **Custom style** section in the editor says this too. A file with any other selector or property is refused as a whole.

## ThemeBackground

| Field | Type | Limit |
|---|---|---|
| `asset_id` | string or absent | UUID of an owned PNG; never a path |
| `fit` | string | `fill`, `fit` or `tile` |
| `opacity` | number | 0–0.5; the editor starts at 0.15 |
| `blur_px` | number | integer 0–32 |
| image source | local picture | at most 64 MiB; decoded at most 4096 px per edge and 16 MP |
| owned image | PNG | at most 8 MiB |

Choosing a background is an explicit local action. The app reads the chosen picture once through its bounded image helper, writes an owned PNG, and never scans a pictures folder. The preview shows the owned image; the theme data contains only its asset identifier.

## Safe import and export

- Import validates the entire file before showing a preview. A failed import does not change the active appearance, the catalog or settings.
- Import never applies automatically. **Save theme** is a separate action.
- A package may carry the owned background PNG. On import, the app validates the PNG signature and dimensions and stores a fresh owned copy. It ignores an `asset_id` that does not belong to this installation.
- Export writes a new file and never replaces an existing file. If the destination exists, the export reports that it could not be written and leaves the existing file untouched.
- Export contains the theme data and, optionally, the owned PNG. It never contains the original picture path, a font file, font bytes, installed-font folders or history.
- The source picture is never modified or deleted.

## Fonts and licenses

A theme stores a font family name only. It may name `Inter`, `system-ui`, or a family that Windows reports as installed on this PC. The app does not copy an installed font into a theme, into an export, or into the app's data folder. A theme cannot add a font file, an executable icon provider, a script or a remote resource.

This is also why exported themes can look different on another PC: if the named font is not installed there, Adperastra falls back to its interface stack. Adperastra does not redistribute fonts that it has no license to ship.

## Materials and readability

`mica` and `acrylic` are requests, not promises. The app applies them only when the Windows build and the current display support native materials. High contrast, unsupported builds and remote sessions fall back to a solid surface, and the editor shows that the option is unavailable. Text and panes are never made transparent to imitate blur.

When saving, the app checks contrast: normal text must reach 4.5:1, and non-text or large elements must reach 3:1. Unsafe accents are adjusted toward black or white in small steps, choosing the nearest readable colour. If no candidate satisfies every declared surface, the app keeps a built-in safe accent and says so instead of exporting an unreadable theme.

## Schedule (not part of the file)

Day/night choices, the schedule mode, the two local start times, the wallpaper-follow option and file-type accents are settings, not part of a `.adptheme` file. They are stored with the rest of the app settings. Sunrise/sunset switching is not available: it would require a separately approved location input and specification.
