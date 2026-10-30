# Recipe: add translation keys

Recipes list new keys in a table: key, English, Spanish. Add them exactly.

1. Open `src/i18n/locales/en.json` and `src/i18n/locales/es.json`. Each dotted key is a path of nested objects: `viewer.zoomIn` goes in the object `"viewer"` as `"zoomIn"`. Create the object if it does not exist, at the end of the file. Keep the order of existing keys.
2. Add the English text to `en.json` and the Spanish text to `es.json`, both with the same key.
3. Run `npm run i18n:pseudo` (rewrites `pseudo.json`; never edit it by hand).
4. Run `npm run lint:i18n`. It fails on missing keys, broken ICU, or different `{arguments}` between languages; the message names the key.

## Writing new text (only when a recipe gives a key without text)

- English: short, plain, sentence case ("Open in a new tab"). Errors say what happened and, if possible, what to do ("This file is too large to show here. Open it in another app.").
- Spanish: follow `plan/glossary.md`. Same meaning, natural Latin American Spanish, `tú` form.
- Counts use ICU plurals in both languages: `"{count, plural, one {# page} other {# pages}}"` / `"{count, plural, one {# página} other {# páginas}}"`.
- Arguments: `{name}`, `{count}`, `{size}`; the same names in both languages.
- No HTML in strings. No text built by joining two keys.

## Error keys

Every area that returns error codes has `errors.<area>.other` (generic message) and one key per reason, for example:

```json
"errors": {
  "viewer": {
    "too_large": "This file is too large to show here. Open it in another app.",
    "other": "This file couldn't be shown."
  }
}
```
