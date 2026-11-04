# Translating Adperastra

Adperastra shows every word through translation files. This page explains
where those files live and what a translator must keep true.

## Where the text lives

The interface text is in `src/i18n/locales/en.json` and
`src/i18n/locales/es.json`. The file `src/i18n/locales/pseudo.json` is
generated from the English file and is never edited by hand. Help pages are
in `help/en/` and `help/es/`; both folders must contain a page with the same
file name.

## Rules for every language

Every user-visible word comes from the translation files: labels, tooltips,
menus, messages, errors, toasts, default file names and help pages. Code does
not contain finished sentences.

Plurals and values use ICU messages. For example, `{count, plural, one {# file}
other {# files}}` is correct, while joining a number and a word in code is
not. If a message takes an argument, every language must use the same
argument names. A translation may move an argument, but it may not rename it
or drop it. `npm run lint:i18n` checks the files for missing keys, extra keys,
mismatched arguments and help-page pairs.

## Spanish

Spanish is Latin American Spanish (es-419). Use the words in
`plan/glossary.md` so the same action keeps the same name everywhere. Do not
translate a menu label differently from the button that does the same thing.

## Shortcuts and keys

Shortcut text is produced by `formatShortcut()` and comes from the command
registry. A translation never writes "Ctrl+W" by hand, because the same action
may use another key for another user.

## Fonts and keyboard labels

The interface uses the bundled Inter family and a system fallback; a
translation does not ship its own font files. Keyboard labels are physical key
names, not translated words, and the accessible font settings introduced for
accessibility use the same translation keys as the rest of the interface.
Theme authoring reuses the `CustomTheme` schema from the theme editor; a
translator never edits a theme file to change a label.

## Right-to-left checks

The pseudo-locale is a layout test, not a public language. It keeps the English
words but expands them and marks them so cut-off or hard-coded text becomes
visible. Right-to-left reading order is tested with that fixture. Layout uses
logical CSS properties such as `margin-inline-start`, `padding-inline` and
`border-inline-start`; never a physical `left` or `right` for a control that
must follow the reading direction. A source path or a file name is not
reversed: it is data, not a sentence. Navigation arrows follow the reading
direction, but the path text keeps its real order and is shown with
`displayPath()`.

## Preview and responsibility

After editing the English file, run `npm run i18n:pseudo` to regenerate the
pseudo-locale. The coordinator runs the translation checks and previews the
English light, Spanish dark and pseudo-locale layouts at normal and 200% zoom.
A language is not advertised as complete until its whole catalog exists.

## Private data

Examples in translations and help pages use invented names and paths. Never
put a real user name, a real folder path, a serial number, a password or a
recovery key in a translation file or a help page.
