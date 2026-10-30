# Step 10a: Customization, round 2: themes, toolbars, shortcuts, tabs, and formats (★★★)

**Needs:** 09b. **Builds:** theme editor, shortcut maps, keyboard styles, profiles.

## Tasks
- **Theme editor** with live preview; themes are files that can be imported and shared; window materials (solid, Mica/Acrylic on Windows 11, custom background image with blur and opacity); UI font and size; tab shape; icon packs (system icons or bundled open-licensed packs); a separate color scheme for editor surfaces; optional custom CSS (applied safely, no scripts).
- **Automatic theme switching:** a "Day theme" and a "Night theme" chosen independently from any built-in or custom theme (each with its own accent color, background image, and window material). Switch on a schedule (custom times), at sunrise and sunset (computed from the time zone, no location needed), or following Windows light/dark mode; a quick toggle in the title bar overrides until the next switch. Instant switch, or a short fade if motion is allowed.
- **Accent colors:** read the Windows wallpaper and offer its main colors (pick one, or "Always follow wallpaper"), checking contrast so text stays readable; override each file type's accent color (Explorer, Excel-style, Word-style, PDF, image) with my own.
- **Toolbar customization:** show, hide, and reorder individual commands in the command bar and ribbons; a Quick Access toolbar; classic menu-bar mode.
- **Keyboard:** fully remappable shortcuts with conflict detection, working on non-US keyboard layouts. **Keyboard styles:** presets for Windows (default), macOS Finder (for example Enter to rename), Total Commander (F5 copy, F6 move, F7 new folder, F8 delete), and Vim-style navigation (h/j/k/l, gg/G, / to filter); presets can be modified and saved as my own.
- **Tab options:** tab width (compact, fixed, or fit the name), close button always or on hover, where new tabs open (end, next to current), which tab activates after closing (previous or the one to the right), tab hover previews (on/off, delay), file-type icons, colored underline per type, maximum title length, scrolling or shrinking with many tabs, double-click on the empty tab bar opens a new tab.
- **Date and size formats:** dates as relative ("2 hours ago"), short, long, or a custom pattern; 12- or 24-hour time; first day of the week; sizes in KB/MB (1000) or KiB/MiB (1024) with chosen decimals; numbers following the system locale or my choice; long names truncated in the middle (keeping the extension visible) or at the end; show or hide extensions per file type.
- **Behavior:** default app per file type (built-in viewer or a system app); startup behavior (restore tabs, Home, or a chosen folder); single or double click to open; which confirmation prompts appear.
- **Profiles and portable mode:** multiple profiles; a complete portable mode (all settings and data next to the app); right-to-left layout check; short guides for theme authors and translators (in `docs/`).

## Parts to consider
`window-vibrancy` (MIT/Apache-2.0) for Mica/Acrylic; Windows UI settings APIs for wallpaper and accent; a color-quantization crate (for example `kmeans_colors`) for wallpaper colors; the `sunrise` crate (check license) for sunrise and sunset times.

## Help pages
Themes and the theme editor; day and night themes; accent colors; customizing toolbars; keyboard shortcuts and styles; tab options; date and size formats; profiles and portable mode.

## Done when
I can build and share a theme, set different day and night themes that switch automatically, follow my wallpaper's color, remap a shortcut, switch to the Total Commander keyboard style, change tab options and date formats, and run the app portably.
