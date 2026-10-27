# Step 01b: App shell, design tokens, theme, languages, help system, and security base (★)

**Needs:** 01a. **Builds:** tokens and theme engine, settings, i18n, tab host, help system, security base, crash capture. **Figma frames:** all (shared window chrome).

## Tasks
- **Repository basics:** README (with a one-sentence reason to use the app at the top, build instructions, and how to verify a download's checksum), CONTRIBUTING (with DCO sign-off), THIRD_PARTY_LICENSES, DESIGN_DEVIATIONS.md, CHANGELOG.md, and CI that builds a portable zip.
- **Design tokens:** measure tokens from the Figma frames into the theme JSON and CSS variables. The Figma look is the default theme. Figma has only a light theme: derive a dark theme and show it to me. Per-file-type accent tokens (Explorer blue, Excel-style green, Word-style blue, PDF red, image teal). Accent color: from the design by default, or the Windows accent, or custom.
- **Component gallery** (developer-only), every base component in every state, compared with the Figma screenshots: buttons, icon buttons, split buttons, tabs, inputs, search box, breadcrumb, list rows, tree items, menus, dialogs, tooltips (with shortcut hints), key tips, toasts (with Undo), skeleton loaders, progress bars, switches, sliders, dropdowns.
- **Window:** custom title bar with the tab bar inside it (keep Windows 11 snap layouts working on the maximize button). The first tab is the permanent Explorer tab: no close button, Ctrl+W and middle-click do nothing on it, it can't be dragged out or reordered, and it is always restored at startup. Status bar placeholder.
- **Settings system:** one JSON file with a schema and migrations.
- **Languages:** English + Spanish (Latin America), runtime language switch without restart, English fallback, ICU messages, the hardcoded-text lint check, and a pseudo-locale for testing (see `rules.md`, section 2).
- **Help system v1:** an offline help center that opens in a tab; pages stored as Markdown per language (`help/<lang>/<feature>.md`), rendered safely (no scripts), searchable; F1 opens the page for the current context; a "?" button component for panels and dialogs; a "What's new" page template for releases. Write the first pages (getting started, tabs, settings basics).
- **Security base** (see `rules.md`, section 5): Tauri capabilities per window, strict Content Security Policy, the isolation pattern, typed and validated commands, developer tools disabled in release builds.
- **Crash capture from day one:** a panic hook and crash handler that write a local log and minidump (never uploaded), and a session file saved every few seconds, so Step 09c's crash recovery can restore tabs.

## Parts to consider
Headless UI primitives styled by our tokens (Radix UI (MIT) or React Aria (Apache-2.0)); icons from the Figma file if their license allows MIT redistribution, otherwise Lucide (ISC) or Phosphor (MIT); Style Dictionary (Apache-2.0) to turn tokens into CSS variables; Storybook (MIT) or a simple gallery page; Playwright (Apache-2.0) + pixelmatch (ISC) for screenshot comparisons; i18next or Lingui (MIT) or Project Fluent (Apache-2.0); a Markdown renderer with sanitizing (markdown-it (MIT) + DOMPurify (Apache-2.0/MPL-2.0)); Weblate or Crowdin (free for open-source projects) for community translations.

## Help pages
Getting started; tabs basics; changing language and theme; using help.

## Done when
The gallery matches the Figma screenshots; the Explorer tab can't be closed; theme and language changes apply instantly and persist; F1 opens the help center in the current language; a webview can't call commands outside its capabilities (tested); a forced crash writes a local crash log.
