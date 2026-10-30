# Recipe: add a help page

Every user-visible feature has a help page in English and Spanish with the same file name.

1. Create `help/en/<slug>.md` and `help/es/<slug>.md`. The slug is lower-case words joined with `-` (for example `opening-files`). The recipe gives the slug and the sections.
2. Format (copy `plan/templates/help-page.md`):
   - Line 1: `# <Title>` (the title shown in the help center list).
   - One short intro paragraph: what the feature is for.
   - Sections with `##` headings: how to use it, step by step, naming buttons and shortcuts exactly as the UI shows them in that language (bold), with shortcuts as text ("Ctrl+W").
   - A "Good to know" section for limits and safety notes (what is never changed, what needs another app).
   - Last line: `See also: "<Other page title>" and "<Other page title>".` (titles, not slugs).
3. The Spanish page is a natural translation using `plan/glossary.md`, not word for word.
4. Plain language, short sentences, no technical words (no "token", "protocol", "IPC", "handler").
5. Link from the app: the command's `helpSlug`, the panel's "?" button (`HelpButton` with `onOpenHelp(slug)`), or the tab's F1 slug (`HELP_SLUGS` in `src/App.tsx` for tab kinds; file tabs use their handler's `helpSlug`).
6. `npm run lint:i18n` checks that every page exists in both languages. `src/__tests__/commands.test.ts` checks that every command's `helpSlug` exists.
