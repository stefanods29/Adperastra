# Step 04b: Ribbon framework, text and code viewer, Markdown viewer

| | |
|---|---|
| State | ready |
| Difficulty | ★★ |
| Branch | `step-04b-ribbon-text-markdown` |
| Tag | `v0.0.8-step04b` |
| Depends on | 04a |

## Goal

Text files, logs, settings files and source code open in a tab: code colors for about 30 languages, search, word wrap, line numbers, zoom, and a choice of encoding. Files over 10 MB open at once, read-only, in parts of 1 MB. Markdown files open as a formatted page (or as their source) and their web links ask before opening in the browser. Every viewer gets a ribbon: one row of grouped buttons with Alt key tips. The picture viewer moves its controls to the ribbon and can rotate the view. Files without a known extension that contain text (README, LICENSE) open as text.

## Do not do in this step

- No editing or saving text (Step 06a). No "Open as text" or "Open as hex" commands (04c). No audio or video (04c). No Settings > Default apps (04c).
- No ribbon in the Explorer tab: the Explorer keeps its command bar.
- No web page preview: `.html` files open in the browser (Windows app), as the table in D8 says.
- No pictures from the Markdown file's folder in the reading view (later step).
- Do not change image detection, the Explorer, or file operations.

## Read first

- `plan/conventions.md`, `plan/pitfalls.md` (P-01, P-02, P-03, P-06, P-23, P-26, P-28), `plan/rules.md` R-SEC-4, `plan/recipes/add-dependency.md`, `plan/recipes/add-translation-keys.md`, `plan/recipes/add-tauri-command.md`, `plan/recipes/add-help-page.md`.
- Code: `src/views/FileTabView.tsx`, `src/handlers/types.ts`, `src/handlers/image/ImageView.tsx`, `src/commands/registry.ts`, `src/App.tsx` (search for `showKeyTips`), `src-tauri/src/files.rs` (function `detect`).

## Decisions (already made)

- D1. The text viewer is CodeMirror 6, read-only: the caret, selection, Ctrl+A and Ctrl+C work; typing, Delete and paste do nothing. Code colors come from new `--adp-syntax-*` theme tokens (GitHub light and dark palettes). Each language loads only when a file of that type opens.
- D2. Encoding: a byte-order mark wins; otherwise valid UTF-8; otherwise Windows-1252. The ribbon's Encoding list offers 12 encodings; the choice is not saved. The status bar shows the line-ending kind (CRLF, LF, mixed).
- D3. Files over 10 MB open read-only in parts of 1 MB, read with HTTP `Range` requests from the `adpfile` protocol. Previous part / Next part: Alt+Page Up / Alt+Page Down. There is no size limit.
- D4. Markdown: `markdown-it` with `html: false` and `linkify`, then DOMPurify, shown in `<iframe sandbox="allow-same-origin" srcdoc=...>`: no scripts can run; same origin only so the app can search the page and catch link clicks (the one exception in R-SEC-4). The CSP blocks anything from the internet. Links: `http`, `https` and `mailto` ask first, then open in the default app (Rust checks the link again); all other links do nothing. Markdown files over 5 MB open in the text viewer.
- D5. Search: the file tab's search box (top right) drives the viewer. Typing selects the first match from the caret; Enter or F3 goes to the next match; Shift+Enter or Shift+F3 to the previous; Esc clears. Case-insensitive, plain text. The Markdown reading view highlights with the CSS Custom Highlight API, so the page itself is never changed.
- D6. Ribbon (contract 16): a ribbon is data (`RibbonDef`: tabs, groups, controls bound to command ids). One row of 48 px; the row of ribbon tabs appears only when a ribbon has more than one tab. Holding Alt shows key tips; Alt+letter runs that control. Viewers use `Command<Ctx>` with their own context type; `useCommandShortcuts` runs their shortcuts only while the tab is active, and never takes plain keys while you type in a text field.
- D7. Picture viewer: the 04a features, with the controls on the ribbon, plus Rotate left, Rotate right (view only; saved in the tab) and Actual size.
- D8. Programs, shortcuts and web pages always open in Windows (`ALWAYS_WINDOWS` in `openPipeline.ts`: exe, msi, msix, msixbundle, appx, appxbundle, appinstaller, com, scr, cpl, msc, lnk, url, website, appref-ms, library-ms, search-ms, html, htm, xhtml, mht, mhtml). Scripts (.bat, .cmd, .ps1, .vbs, .js) open as text, so they never run by accident; Right-click > Open in Windows app runs them.
- D9. A file whose type is unknown from both its content and its extension, but whose first 8 KB look like text (a UTF-16 byte-order mark, or no zero bytes and at most 1 % control characters), is detected as `text/plain`.
- D10. Saved in each tab's view state: text: word wrap, line numbers, zoom; Markdown: reading view or source, zoom; picture: fit or zoom, rotation. Scroll positions are not saved yet (Step 09a).

## Tasks

### T1 - Add CodeMirror 6

Follow `plan/recipes/add-dependency.md` (npm part). Run this one line exactly:

```powershell
npm install --save-exact @codemirror/state@6.7.6 @codemirror/view@6.43.15 @codemirror/language@6.13.1 @codemirror/commands@6.11.1 @codemirror/search@6.7.2 @lezer/highlight@1.2.5 @codemirror/lang-javascript@6.2.5 @codemirror/lang-json@6.0.2 @codemirror/lang-html@6.4.12 @codemirror/lang-css@6.3.1 @codemirror/lang-xml@6.1.0 @codemirror/lang-markdown@6.5.2 @codemirror/lang-python@6.2.1 @codemirror/lang-rust@6.0.2 @codemirror/lang-sql@6.10.0 @codemirror/lang-java@6.0.2 @codemirror/lang-cpp@6.0.3 @codemirror/lang-yaml@6.1.3 @codemirror/legacy-modes@6.5.5
```

Then:

1. `npm audit --omit=dev` must not report high or critical problems (if it does, stop with `BLOCKED.md`).
2. Run `npm ls @codemirror/state @codemirror/view @codemirror/language`. Every line must show `@codemirror/state@6.7.6`, `@codemirror/view@6.43.15` or `@codemirror/language@6.13.1` (often with `deduped`). If any other version of these three appears, run `npm dedupe` once and check again; if it still appears, stop with `BLOCKED.md` (two copies of CodeMirror break the viewer).

Records (same commit):

In `THIRD_PARTY_LICENSES.md`, find exactly:

```markdown
- **minisign** (MIT) - manifest signatures.
```

Replace with:

```markdown
- **minisign** (MIT) - manifest signatures.
- **CodeMirror 6** (MIT) - the text and code viewer: code colors, search, line numbers (Step 04b). Packages: @codemirror/state 6.7.6, view 6.43.15, language 6.13.1, commands 6.11.1, search 6.7.2, lang-javascript 6.2.5, lang-json 6.0.2, lang-html 6.4.12, lang-css 6.3.1, lang-xml 6.1.0, lang-markdown 6.5.2, lang-python 6.2.1, lang-rust 6.0.2, lang-sql 6.10.0, lang-java 6.0.2, lang-cpp 6.0.3, lang-yaml 6.1.3, legacy-modes 6.5.5, and @lezer/highlight 1.2.5, with the @lezer parsers they use (all MIT).
```

In `docs/dependency-and-license-table.md`, find exactly:

```markdown
| Text editor (04b/06a) | CodeMirror 6 (MIT) | Monaco (MIT) | Streamed large-file mode is ours |
```

Replace with:

```markdown
| Text editor (04b/06a) | CodeMirror 6 (MIT), adopted in Step 04b (@codemirror/state 6.7.6, view 6.43.15, language 6.13.1, commands 6.11.1, search 6.7.2, 13 language packages, legacy-modes 6.5.5, @lezer/highlight 1.2.5) | Monaco (MIT) | Large files open in 1 MB parts (ours) |
```

**Commit:** `deps: add CodeMirror 6 (MIT) for the text viewer [step-04b/T1]`

### T2 - Commands with their own context type

**Files:** modify `src/commands/registry.ts`.

Viewers have their own state (zoom, word wrap) instead of the Explorer's `CommandContext`. `Command` gets a type parameter whose default keeps every existing use unchanged.

In `src/commands/registry.ts`, find exactly:

```ts
export interface Command {
  id: string;
  /** i18n key, never display text. */
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string;
  risk: CommandRisk;
  /** Help page slug opened with F1 / "?" for this command. */
  helpSlug: string;
  enabledWhen: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext, arg?: string) => void;
  /** Toggle and radio entries in menus show a check mark when true. */
  checkedWhen?: (ctx: CommandContext) => boolean;
  checkKind?: "toggle" | "radio";
  /** Hidden commands are left out of menus and bars. */
  visibleWhen?: (ctx: CommandContext) => boolean;
  /** A label that depends on the context (for example add/remove favorite). */
  labelKeyFor?: (ctx: CommandContext) => string;
```

Replace with:

```ts
/** A command. `C` is the context its rules read: the Explorer's
 * `CommandContext` by default, or a viewer's own context (Step 04b). */
export interface Command<C = CommandContext> {
  id: string;
  /** i18n key, never display text. */
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string;
  risk: CommandRisk;
  /** Help page slug opened with F1 / "?" for this command. */
  helpSlug: string;
  enabledWhen: (ctx: C) => boolean;
  run: (ctx: C, arg?: string) => void;
  /** Toggle and radio entries in menus show a check mark when true. */
  checkedWhen?: (ctx: C) => boolean;
  checkKind?: "toggle" | "radio";
  /** Hidden commands are left out of menus and bars. */
  visibleWhen?: (ctx: C) => boolean;
  /** A label that depends on the context (for example add/remove favorite). */
  labelKeyFor?: (ctx: C) => string;
```

In `src/commands/registry.ts`, find exactly:

```ts
export function isCommandEnabled(command: Command, ctx: CommandContext): boolean {
  return !command.pending && command.enabledWhen(ctx);
}

export function isCommandVisible(command: Command, ctx: CommandContext): boolean {
  return command.visibleWhen ? command.visibleWhen(ctx) : true;
}

export function commandLabelKey(command: Command, ctx: CommandContext): string {
  return command.labelKeyFor ? command.labelKeyFor(ctx) : command.labelKey;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`duplicate command id: ${command.id}`);
    }
    this.commands.set(command.id, command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }
}
```

Replace with:

```ts
export function isCommandEnabled<C>(command: Command<C>, ctx: C): boolean {
  return !command.pending && command.enabledWhen(ctx);
}

export function isCommandVisible<C>(command: Command<C>, ctx: C): boolean {
  return command.visibleWhen ? command.visibleWhen(ctx) : true;
}

export function commandLabelKey<C>(command: Command<C>, ctx: C): string {
  return command.labelKeyFor ? command.labelKeyFor(ctx) : command.labelKey;
}

export class CommandRegistry<C = CommandContext> {
  private commands = new Map<string, Command<C>>();

  register(command: Command<C>): void {
    if (this.commands.has(command.id)) {
      throw new Error(`duplicate command id: ${command.id}`);
    }
    this.commands.set(command.id, command);
  }

  get(id: string): Command<C> | undefined {
    return this.commands.get(id);
  }

  list(): Command<C>[] {
    return [...this.commands.values()];
  }
}
```

**Tests:** no new tests; the existing ones (`commands.test.ts`) must pass unchanged.

**Commit:** `refactor(commands): commands can use a context type of their own [step-04b/T2]`

### T3 - Search box on file tabs

**Files:** modify `src/handlers/types.ts`, `src/handlers/image/index.ts`, `src/styles/filetabs.css`; replace `src/views/FileTabView.tsx`; add a translation key.

In `src/handlers/types.ts`, find exactly:

```ts
export interface HandlerViewProps {
  info: FileTypeInfo;
```

Replace with:

```ts
/** The file tab's search box (Step 04b): the text to find, and a counter
 * that grows each time the user asks for the next (or previous) match. */
export interface FindRequest {
  text: string;
  request: number;
  backwards: boolean;
}

export interface HandlerViewProps {
  info: FileTypeInfo;
```

In `src/handlers/types.ts`, find exactly:

```ts
  /** Open this file in its Windows default app (used by error states). */
  onOpenInWindowsApp: () => void;
}
```

Replace with:

```ts
  /** Open this file in its Windows default app (used by error states). */
  onOpenInWindowsApp: () => void;
  /** What the search box asks for; views with `supportsFind` follow it. */
  find: FindRequest;
}
```

In `src/handlers/types.ts`, find exactly:

```ts
  helpSlug: string;
  speedTier: "fast" | "waiting";
```

Replace with:

```ts
  helpSlug: string;
  speedTier: "fast" | "waiting";
  /** True when the view can search its content: the file tab shows its
   * search box and Ctrl+F focuses it. */
  supportsFind: boolean;
```

In `src/handlers/image/index.ts`, find exactly:

```ts
  speedTier: "fast",
```

Replace with:

```ts
  speedTier: "fast",
  supportsFind: false,
```

In `src/styles/filetabs.css`, find exactly:

```css
.adp-image-skeleton { width: 320px; height: 220px; }
```

Replace with:

```css
.adp-image-skeleton { width: 320px; height: 220px; }
.adp-filetab-search { width: 270px; flex: none; }
.adp-filetab-search .adp-search { width: 100%; height: 34px; border: none; background: var(--adp-color-surface-chrome); }
.adp-filetab-search .adp-search-input { flex: 1; min-width: 0; border: none; background: transparent; }
```

Guard first (`plan/pitfalls.md` P-29). Run:

```powershell
git log --format=%s -- src/views/FileTabView.tsx
```

It must print exactly one line, and that line must end with `[step-04a/T7]` (the commit that created the file in Step 04a). If it prints more than one line, `src/views/FileTabView.tsx` was changed after Step 04a created it (for example by a fix): stop with `BLOCKED.md` and do not merge by hand. If the guard passes, replace the whole file with:

```tsx
import { ArrowUp, FileQuestion, RotateCw } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Breadcrumb from "../components/Breadcrumb";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import Slider from "../components/Slider";
import { handlers } from "../handlers";
import type { FileTabStatus, FindRequest } from "../handlers/types";
import { errorCode, errorText } from "../services/errors";
import { displayPath, openItem, parentPathOf, pathSegments } from "../services/explorer";
import { fileDetect, fileGrant, fileRevoke, fileUrl, type FileTypeInfo } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import type { TabState } from "../services/tabs";

export interface FileTabViewProps {
  tab: TabState;
  active: boolean;
  /** Show the file in the Explorer tab (folder opened, file selected). */
  onShowInFolder: (path: string) => void;
  /** Open a folder in the Explorer tab (breadcrumb segments). */
  onOpenFolder: (folder: string) => void;
  onClose: () => void;
  onViewState: (state: unknown) => void;
  onOpenHelp: (slug: string) => void;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; info: FileTypeInfo; token: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** One file tab (Step 04a): navigation row, the handler's view, and the
 * file tab's own status bar. Gets a file token when it mounts and gives it
 * back when it unmounts (plan/pitfalls.md P-28). */
export default function FileTabView({ tab, active, onShowInFolder, onOpenFolder, onClose, onViewState, onOpenHelp }: FileTabViewProps) {
  const { t } = useTranslation();
  const path = tab.path ?? "";
  const handler = tab.handler ? handlers.get(tab.handler) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [status, setStatus] = useState<FileTabStatus>({ items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [find, setFind] = useState<FindRequest>({ text: "", request: 0, backwards: false });
  const searchRef = useRef<HTMLDivElement | null>(null);
  const canFind = handler?.supportsFind === true;
  const findAgain = useCallback((backwards: boolean) => {
    setFind((current) => ({ ...current, request: current.request + 1, backwards }));
  }, []);

  // Ctrl+F focuses the search box; F3 / Shift+F3 find the next / previous match.
  useEffect(() => {
    if (!active || !canFind) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        input?.select();
      } else if (event.key === "F3") {
        event.preventDefault();
        findAgain(event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, canFind, findAgain]);

  useEffect(() => {
    if (!isTauriRuntime() || !path) return;
    let cancelled = false;
    let token: string | null = null;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const info = await fileDetect(path);
        const granted = await fileGrant(path);
        if (cancelled) {
          void fileRevoke(granted).catch(() => undefined);
          return;
        }
        token = granted;
        setPhase({ kind: "ready", info, token: granted });
      } catch (error) {
        if (cancelled) return;
        if (errorCode(error) === "files.not_found") setPhase({ kind: "missing" });
        else setPhase({ kind: "error", message: errorText(t, error, "files") });
      }
    })();
    return () => {
      cancelled = true;
      if (token) void fileRevoke(token).catch(() => undefined);
    };
  }, [path, reloadKey, t]);

  const openInWindowsApp = useCallback(() => {
    if (isTauriRuntime()) void openItem(path).catch(() => undefined);
  }, [path]);

  const folder = parentPathOf(path);
  const segments = pathSegments(path).map((segment, index, all) => ({
    id: index === all.length - 1 ? "" : segment.path,
    label: segment.label,
  }));
  return (
    <div className="adp-filetab" hidden={!active}>
      <div className="adp-filetab-nav">
        <IconButton icon={ArrowUp} labelKey="fileTab.showInFolder" shortcut="Alt+Up" onClick={() => onShowInFolder(path)} />
        <IconButton icon={RotateCw} labelKey="fileTab.reload" shortcut="F5" onClick={() => setReloadKey((value) => value + 1)} />
        <div className="adp-filetab-address">
          <Breadcrumb segments={segments} onNavigate={(id) => (id ? onOpenFolder(id) : undefined)} />
        </div>
        {canFind ? (
          <div
            ref={searchRef}
            className="adp-filetab-search"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findAgain(event.shiftKey);
              } else if (event.key === "Escape") {
                setFind((current) => ({ ...current, text: "" }));
              }
            }}
          >
            <SearchBox
              value={find.text}
              onChange={(text) => setFind((current) => ({ ...current, text }))}
              placeholder={t("fileTab.searchIn", { name: tab.title ?? "" })}
            />
          </div>
        ) : null}
        <HelpButton onOpenHelp={() => onOpenHelp(handler?.helpSlug ?? "opening-files")} />
      </div>
      <div className="adp-filetab-body">
        {phase.kind === "loading" ? <Skeleton variant="tiles" count={1} /> : null}
        {phase.kind === "missing" ? (
          <div className="adp-viewer-message" role="alert">
            <FileQuestion size={32} aria-hidden="true" />
            <p>{t("fileTab.notFoundTitle")}</p>
            {folder ? <p className="adp-viewer-detail">{t("fileTab.notFoundBody", { folder: displayPath(folder) })}</p> : null}
            <div className="adp-dialog-actions">
              {folder ? <Button onClick={() => onOpenFolder(folder)}>{t("fileTab.openFolder")}</Button> : null}
              <Button onClick={onClose}>{t("tabs.close")}</Button>
            </div>
          </div>
        ) : null}
        {phase.kind === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{phase.message}</p>
            <Button variant="primary" onClick={openInWindowsApp}>
              {t("fileTab.openInWindowsApp")}
            </Button>
          </div>
        ) : null}
        {phase.kind === "ready" && handler ? (
          <Suspense fallback={<Skeleton variant="tiles" count={1} />}>
            <handler.view
              key={phase.token}
              info={phase.info}
              url={fileUrl(phase.token, phase.info.name)}
              active={active}
              savedState={tab.view ?? null}
              onStateChange={onViewState}
              onStatus={setStatus}
              onOpenInWindowsApp={openInWindowsApp}
              find={find}
            />
          </Suspense>
        ) : null}
      </div>
      <footer className="adp-statusbar adp-filetab-status">
        {status.items.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {status.zoom ? (
          <span className="adp-filetab-zoom">
            <Button variant="subtle" onClick={status.zoom.fit}>
              {t("viewer.fit")}
            </Button>
            <Slider
              value={status.zoom.percent}
              min={status.zoom.min}
              max={status.zoom.max}
              label={t("viewer.zoom")}
              onChange={status.zoom.set}
            />
          </span>
        ) : null}
      </footer>
    </div>
  );
}
```

What changed in `FileTabView.tsx` compared to Step 04a (for review, not extra work): a `find` state passed to the view as the `find` prop; a search box in the navigation row when the handler has `supportsFind`; Ctrl+F focuses it; F3 and Shift+F3 find the next and previous match; Enter, Shift+Enter and Esc inside the box.

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `fileTab.searchIn` | Search in {name} | Buscar en {name} |

**Tests:** no new tests (the image viewer has no search; the text viewer's search is tested in T8).

**Commit:** `feat(tabs): search box on file tabs for viewers that can search [step-04b/T3]`

### T4 - The ribbon framework

**Files:** create everything under `src/ribbon/`, `src/styles/ribbon.css`, `src/__tests__/ribbon.test.tsx`, `help/en/the-ribbon.md`, `help/es/the-ribbon.md`; modify `src/main.tsx` and `src/App.tsx`; add translation keys.

Create `src/ribbon/types.ts`:

```ts
import type { ReactNode } from "react";

/** Ribbon framework (contract 16, Step 04b). A ribbon is data: tabs of
 * groups of controls, each control bound to a command id. The `Ribbon`
 * component draws it; layouts can place it on any side (Step 05c). */

export type RibbonControl =
  /** Runs a command. `showLabel` false shows only the icon. */
  | { type: "button"; command: string; showLabel?: boolean; keyTip?: string }
  /** Like a button, drawn pressed while the command's `checkedWhen` is true. */
  | { type: "toggle"; command: string; showLabel?: boolean; keyTip?: string }
  /** Anything else (a zoom box, an encoding list). */
  | { type: "custom"; id: string; render: () => ReactNode };

export interface RibbonGroup {
  id: string;
  /** Translation key of the group name (tooltip and screen readers). */
  labelKey: string;
  controls: RibbonControl[];
}

export interface RibbonTab {
  id: string;
  labelKey: string;
  /** Letter shown while Alt is held; Alt+letter selects the tab. */
  keyTip: string;
  groups: RibbonGroup[];
}

export interface RibbonDef {
  tabs: RibbonTab[];
}
```

Create `src/ribbon/keyTips.ts`:

```ts
import { createContext } from "react";

/** True while the Alt key is held (App.tsx provides it): ribbons show
 * their key-tip letters. */
export const KeyTipsContext = createContext(false);
```

Create `src/ribbon/shortcuts.ts`:

```ts
import { useEffect, useRef } from "react";
import { isCommandEnabled, type Command } from "../commands/registry";

/** Does a key press match a shortcut text like "Ctrl+Shift+N", "F3",
 * "Ctrl+=" or "Shift+Enter"? Ctrl also matches the Mac Command key. "="
 * also matches "+" so Ctrl+= works with and without Shift and on the
 * number pad. Letters ignore case. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  let key = parts.pop() ?? "";
  if (key === "" && shortcut.endsWith("+")) key = "+";
  const wantCtrl = parts.includes("Ctrl");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl !== wantCtrl || event.altKey !== wantAlt) return false;
  const pressed = event.key;
  if (key === "=") return pressed === "=" || pressed === "+";
  if (event.shiftKey !== wantShift) return false;
  if (key === "Space") return pressed === " ";
  return pressed.toLowerCase() === key.toLowerCase();
}

/** Run commands from their `shortcut` while `active` is true. Keys without
 * Ctrl or Alt are ignored while typing in a text field or an editable area,
 * so typing is never taken over. */
export function useCommandShortcuts<C>(commands: readonly Command<C>[], ctx: C, active: boolean): void {
  const live = useRef({ commands, ctx });
  live.current = { commands, ctx };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      for (const command of live.current.commands) {
        if (!command.shortcut || !matchesShortcut(event, command.shortcut)) continue;
        const withModifier = event.ctrlKey || event.metaKey || event.altKey;
        if (typing && (!withModifier || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA")) return;
        event.preventDefault();
        if (isCommandEnabled(command, live.current.ctx)) command.run(live.current.ctx);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
```

Create `src/ribbon/Ribbon.tsx`:

```tsx
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import KeyTip from "../components/KeyTip";
import { commandLabelKey, isCommandEnabled, isCommandVisible, type Command } from "../commands/registry";
import type { HandlerAccent } from "../handlers/types";
import { formatShortcut } from "../services/shortcuts";
import { KeyTipsContext } from "./keyTips";
import type { RibbonControl, RibbonDef } from "./types";

export interface RibbonProps<C> {
  def: RibbonDef;
  ctx: C;
  commands: readonly Command<C>[];
  accent: HandlerAccent;
  /** Only the visible tab's ribbon answers Alt+letter key tips. */
  active: boolean;
}

/** One ribbon (Step 04b): a tab row (only when there is more than one tab)
 * and one row of grouped controls, built from commands. Alt shows key
 * tips; Alt+letter picks a tab or runs a control. */
export default function Ribbon<C>({ def, ctx, commands, accent, active }: RibbonProps<C>) {
  const { t } = useTranslation();
  const showKeyTips = useContext(KeyTipsContext);
  const [tabId, setTabId] = useState(def.tabs[0]?.id ?? "");
  const tab = def.tabs.find((entry) => entry.id === tabId) ?? def.tabs[0];
  const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const live = useRef({ ctx, tab, byId, def });
  live.current = { ctx, tab, byId, def };

  // Alt+letter: a tab's key tip selects it; a control's key tip runs it.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
      const letter = event.key.toUpperCase();
      const current = live.current;
      const targetTab = current.def.tabs.find((entry) => entry.keyTip === letter);
      if (targetTab && current.def.tabs.length > 1) {
        event.preventDefault();
        setTabId(targetTab.id);
        return;
      }
      for (const group of current.tab?.groups ?? []) {
        for (const control of group.controls) {
          if (control.type === "custom" || control.keyTip !== letter) continue;
          const command = current.byId.get(control.command);
          if (!command) continue;
          event.preventDefault();
          if (isCommandEnabled(command, current.ctx)) command.run(current.ctx);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!tab) return null;

  const renderControl = (control: RibbonControl) => {
    if (control.type === "custom") {
      return (
        <span key={control.id} className="adp-ribbon-custom">
          {control.render()}
        </span>
      );
    }
    const command = byId.get(control.command);
    if (!command || !isCommandVisible(command, ctx)) return null;
    const Icon = command.icon;
    const label = t(commandLabelKey(command, ctx));
    const pressed = control.type === "toggle" ? Boolean(command.checkedWhen?.(ctx)) : undefined;
    const tooltip = command.shortcut ? `${label} (${formatShortcut(command.shortcut, t)})` : label;
    return (
      <button
        key={control.command}
        type="button"
        className={pressed ? "adp-ribbon-btn adp-ribbon-btn--pressed" : "adp-ribbon-btn"}
        aria-label={label}
        aria-pressed={pressed}
        title={tooltip}
        disabled={!isCommandEnabled(command, ctx)}
        onClick={() => {
          if (isCommandEnabled(command, ctx)) command.run(ctx);
        }}
      >
        <Icon size={16} aria-hidden="true" />
        {control.showLabel === false ? null : <span>{label}</span>}
        {control.keyTip ? <KeyTip letter={control.keyTip} visible={showKeyTips && active} /> : null}
      </button>
    );
  };

  return (
    <div className="adp-ribbon" style={{ ["--adp-ribbon-accent" as string]: `var(--adp-accent-${accent})` }}>
      {def.tabs.length > 1 ? (
        <div className="adp-ribbon-tabs" role="tablist">
          {def.tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab.id}
              className={entry.id === tab.id ? "adp-ribbon-tab adp-ribbon-tab--active" : "adp-ribbon-tab"}
              onClick={() => setTabId(entry.id)}
            >
              {t(entry.labelKey)}
              <KeyTip letter={entry.keyTip} visible={showKeyTips && active} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="adp-ribbon-body" role="toolbar" aria-label={t(tab.labelKey)}>
        {tab.groups.map((group, index) => (
          <div key={group.id} className="adp-ribbon-group" role="group" aria-label={t(group.labelKey)}>
            {index > 0 ? <span className="adp-ribbon-sep" aria-hidden="true" /> : null}
            {group.controls.map(renderControl)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `src/ribbon/ViewerFrame.tsx`:

```tsx
import type { ReactNode } from "react";

/** A viewer's ribbon and content (Step 04b). The ribbon is on top; Step
 * 05c lets the layout put it on any side, by changing only this file. */
export default function ViewerFrame({ ribbon, children }: { ribbon: ReactNode; children: ReactNode }) {
  return (
    <div className="adp-viewer">
      {ribbon}
      <div className="adp-viewer-content">{children}</div>
    </div>
  );
}
```

Create `src/styles/ribbon.css`:

```css
/* Ribbon framework and viewer frame (Step 04b). Colors only through tokens. */
.adp-viewer { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.adp-viewer-content { flex: 1; min-height: 0; position: relative; display: flex; }

.adp-ribbon { flex: none; background: var(--adp-color-surface-window); border-bottom: 1px solid var(--adp-color-border-panel); }
.adp-ribbon-tabs { display: flex; align-items: flex-end; gap: var(--adp-space-1); height: 34px; padding: 0 var(--adp-space-5); }
.adp-ribbon-tab { position: relative; height: 30px; padding: 0 var(--adp-space-4); border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--adp-color-text-secondary); font: inherit; font-size: var(--adp-font-command); cursor: pointer; }
.adp-ribbon-tab--active { color: var(--adp-color-text-primary); border-bottom-color: var(--adp-ribbon-accent); font-weight: 600; }
.adp-ribbon-body { display: flex; align-items: center; height: 48px; padding: 0 var(--adp-space-5); gap: var(--adp-space-1); overflow-x: auto; }
.adp-ribbon-group { display: flex; align-items: center; gap: var(--adp-space-1); flex: none; }
.adp-ribbon-sep { width: 1px; height: 24px; margin: 0 var(--adp-space-3); background: var(--adp-color-border-subtle); }
.adp-ribbon-btn { position: relative; display: inline-flex; align-items: center; gap: var(--adp-space-2); height: 32px; padding: 0 var(--adp-space-3); border: 1px solid transparent; border-radius: var(--adp-radius-sm); background: transparent; color: var(--adp-color-text-primary); font: inherit; font-size: var(--adp-font-body); white-space: nowrap; cursor: pointer; }
.adp-ribbon-btn:hover:not(:disabled) { background: var(--adp-color-surface-selected); }
.adp-ribbon-btn:disabled { opacity: 0.45; cursor: default; }
.adp-ribbon-btn--pressed { background: color-mix(in srgb, var(--adp-ribbon-accent) 14%, transparent); border-color: color-mix(in srgb, var(--adp-ribbon-accent) 40%, transparent); }
.adp-ribbon-btn:focus-visible, .adp-ribbon-tab:focus-visible { outline: 2px solid var(--adp-ribbon-accent); outline-offset: 1px; }
.adp-ribbon-custom { display: inline-flex; align-items: center; gap: var(--adp-space-2); font-size: var(--adp-font-body); color: var(--adp-color-text-secondary); }
.adp-ribbon-custom select { height: 28px; border: 1px solid var(--adp-color-border-input); border-radius: var(--adp-radius-sm); background: var(--adp-color-surface-window); color: var(--adp-color-text-primary); font: inherit; font-size: var(--adp-font-body); }
```

Create `src/__tests__/ribbon.test.tsx`:

```tsx
import { Bold, Italic } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { Command } from "../commands/registry";
import Ribbon from "../ribbon/Ribbon";
import { matchesShortcut } from "../ribbon/shortcuts";
import type { RibbonDef } from "../ribbon/types";

interface Ctx {
  bold: boolean;
  canItalic: boolean;
}

const def: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "g",
          labelKey: "ribbon.show",
          controls: [
            { type: "toggle", command: "t.bold", keyTip: "B" },
            { type: "button", command: "t.italic", keyTip: "I" },
          ],
        },
      ],
    },
  ],
};

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe("ribbon", () => {
  it("draws toggles, disables unavailable commands and runs on click and Alt+letter", async () => {
    const bold = vi.fn();
    const italic = vi.fn();
    const commands: Command<Ctx>[] = [
      { id: "t.bold", labelKey: "viewer.fitToWindow", icon: Bold, risk: "read-only", helpSlug: "viewing-images", checkedWhen: (c) => c.bold, enabledWhen: () => true, run: bold },
      { id: "t.italic", labelKey: "viewer.actualSize", icon: Italic, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.canItalic, run: italic },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Ribbon def={def} ctx={{ bold: true, canItalic: false }} commands={commands} accent="explorer" active={true} />));
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].disabled).toBe(true);
    await act(async () => buttons[0].click());
    expect(bold).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(bold).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(italic).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

describe("shortcut matching", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("matches modifiers exactly", () => {
    expect(matchesShortcut(key({ key: "n", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+N")).toBe(true);
    expect(matchesShortcut(key({ key: "n", ctrlKey: true }), "Ctrl+Shift+N")).toBe(false);
    expect(matchesShortcut(key({ key: "F3", shiftKey: true }), "Shift+F3")).toBe(true);
    expect(matchesShortcut(key({ key: "F3" }), "Shift+F3")).toBe(false);
  });

  it("treats Ctrl+= and Ctrl++ alike", () => {
    expect(matchesShortcut(key({ key: "=", ctrlKey: true }), "Ctrl+=")).toBe(true);
    expect(matchesShortcut(key({ key: "+", ctrlKey: true, shiftKey: true }), "Ctrl+=")).toBe(true);
    expect(matchesShortcut(key({ key: "-", ctrlKey: true }), "Ctrl+=")).toBe(false);
  });
});
```

Create `help/en/the-ribbon.md`:

```markdown
# The ribbon

Each file tab has a ribbon at the top with the commands for that kind of file, grouped by what they do (for example **Zoom** or **Show**).

## Using it with the mouse

- Point at a button to see its name and its keyboard shortcut.
- Buttons that stay highlighted (like **Word wrap**) are on; click again to turn them off.
- Gray buttons can't be used right now (for example **Zoom in** at the largest size).

## Using it with the keyboard

- Hold **Alt**: small letters (key tips) appear on the ribbon.
- While holding **Alt**, press a letter to use that button. For example, in a picture tab **Alt+R** turns the picture to the right.
- When a ribbon has several tabs, their letters switch between them.

See also: "Viewing text and code", "Viewing images" and "Viewing Markdown".
```

Create `help/es/the-ribbon.md`:

```markdown
# La cinta de opciones

Cada pestaña de archivo tiene arriba una cinta de opciones con los comandos para ese tipo de archivo, agrupados según lo que hacen (por ejemplo **Zoom** o **Mostrar**).

## Usarla con el mouse

- Señala un botón para ver su nombre y su atajo de teclado.
- Los botones que quedan resaltados (como **Ajuste de línea**) están activados; haz clic otra vez para desactivarlos.
- Los botones en gris no se pueden usar en ese momento (por ejemplo, **Acercar** en el tamaño máximo).

## Usarla con el teclado

- Mantén pulsada **Alt**: aparecen letras pequeñas (teclas de acceso) en la cinta.
- Mientras mantienes **Alt**, pulsa una letra para usar ese botón. Por ejemplo, en una pestaña de imagen, **Alt+R** gira la imagen a la derecha.
- Cuando una cinta tiene varias pestañas, sus letras cambian entre ellas.

Consulta también: «Ver texto y código», «Ver imágenes» y «Ver Markdown».
```

Then make these changes. In `App.tsx`, the provider goes around `<main className="adp-main">` ... `</main>`, so ribbons know when Alt is held (the existing `showKeyTips` state):

In `src/main.tsx`, find exactly:

```tsx
import "./styles/filetabs.css";
```

Replace with:

```tsx
import "./styles/filetabs.css";
import "./styles/ribbon.css";
```

In `src/App.tsx`, find exactly:

```tsx
import DropdownMenu from "./components/DropdownMenu";
```

Replace with:

```tsx
import DropdownMenu from "./components/DropdownMenu";
import { KeyTipsContext } from "./ribbon/keyTips";
```

In `src/App.tsx`, find exactly:

```tsx
      <main className="adp-main">
```

Replace with:

```tsx
      <KeyTipsContext.Provider value={showKeyTips}>
      <main className="adp-main">
```

In `src/App.tsx`, find exactly:

```tsx
      </main>
```

Replace with:

```tsx
      </main>
      </KeyTipsContext.Provider>
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `ribbon.view` | View | Vista |
| `ribbon.zoom` | Zoom | Zoom |
| `ribbon.show` | Show | Mostrar |
| `ribbon.rotate` | Rotate | Girar |
| `viewer.zoomIn` | Zoom in | Acercar |
| `viewer.zoomOut` | Zoom out | Alejar |
| `viewer.zoomReset` | Reset zoom | Restablecer el zoom |
| `viewer.fitToWindow` | Fit to window | Ajustar a la ventana |
| `viewer.actualSize` | Actual size | Tamaño real |
| `viewer.rotateLeft` | Rotate left | Girar a la izquierda |
| `viewer.rotateRight` | Rotate right | Girar a la derecha |
| `viewer.matches` | {count, plural, =0 {No matches} one {# match} other {# matches}} | {count, plural, =0 {Sin coincidencias} one {# coincidencia} other {# coincidencias}} |

**Tests:** `ribbon.test.tsx`: `draws toggles, disables unavailable commands and runs on click and Alt+letter`, `matches modifiers exactly`, `treats Ctrl+= and Ctrl++ alike`.

**Commit:** `feat(ribbon): ribbon framework with key tips and command shortcuts [step-04b/T4]`

### T5 - Picture viewer on the ribbon, with rotate

**Files:** replace `src/handlers/image/ImageView.tsx`; modify `help/en/viewing-images.md`, `help/es/viewing-images.md`.

Guard first (`plan/pitfalls.md` P-29). Run:

```powershell
git log --format=%s -- src/handlers/image/ImageView.tsx
```

It must print exactly one line, and that line must end with `[step-04a/T4]` (the commit that created the file in Step 04a). If it prints more than one line, `src/handlers/image/ImageView.tsx` was changed after Step 04a created it (for example by a fix): stop with `BLOCKED.md` and do not merge by hand. If the guard passes, replace the whole file with:

```tsx
import { Expand, RotateCcw, RotateCw, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { clampZoom, fitPercent, MAX_ZOOM, MIN_ZOOM, nextZoom } from "./zoom";

interface SavedImageState {
  mode: "fit" | "manual";
  percent: number;
  /** Clockwise quarter turns for viewing (0-3); the file never changes. */
  turns: number;
}

interface ImageCtx {
  hasImage: boolean;
  mode: "fit" | "manual";
  percent: number;
}

function readSaved(state: unknown): SavedImageState {
  const value = (state ?? {}) as Partial<SavedImageState>;
  const turns = typeof value.turns === "number" ? ((Math.round(value.turns) % 4) + 4) % 4 : 0;
  if (value.mode === "manual" && typeof value.percent === "number") return { mode: "manual", percent: clampZoom(value.percent), turns };
  return { mode: "fit", percent: 100, turns };
}

const RIBBON: RibbonDef = {
  tabs: [
    {
      id: "view",
      labelKey: "ribbon.view",
      keyTip: "V",
      groups: [
        {
          id: "zoom",
          labelKey: "ribbon.zoom",
          controls: [
            { type: "button", command: "image.zoomIn", showLabel: false, keyTip: "I" },
            { type: "button", command: "image.zoomOut", showLabel: false, keyTip: "O" },
            { type: "toggle", command: "image.fit", keyTip: "F" },
            { type: "toggle", command: "image.actualSize", keyTip: "A" },
          ],
        },
        {
          id: "rotate",
          labelKey: "ribbon.rotate",
          controls: [
            { type: "button", command: "image.rotateLeft", keyTip: "L" },
            { type: "button", command: "image.rotateRight", keyTip: "R" },
          ],
        },
      ],
    },
  ],
};

/** Image viewer (Steps 04a, 04b): fit to window, zoom with Ctrl+wheel and
 * Ctrl+=/Ctrl+-/Ctrl+0, pan by dragging, rotate the view, checkerboard
 * behind transparency. The browser decodes the image (`decoding="async"`). */
export default function ImageView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<SavedImageState>(() => readSaved(savedState));
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // Track the visible area so "fit" follows window resizes.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // After 1 s without the image, say what is happening (plan/rules.md R-UI-2).
  useEffect(() => {
    if (natural || failed) return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [natural, failed]);

  // Quarter turns swap width and height.
  const sideways = view.turns % 2 === 1;
  const shown = natural ? (sideways ? { width: natural.height, height: natural.width } : natural) : null;
  const percent = shown ? (view.mode === "fit" ? fitPercent(shown.width, shown.height, box.width, box.height) : view.percent) : 100;

  const apply = useCallback(
    (patch: Partial<SavedImageState>) => {
      setView((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );
  const setPercent = useCallback((value: number) => apply({ mode: "manual", percent: clampZoom(value) }), [apply]);
  const fit = useCallback(() => apply({ mode: "fit", percent: 100 }), [apply]);

  // Status bar: dimensions, size, zoom control.
  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({ items, zoom: natural ? { percent, min: MIN_ZOOM, max: MAX_ZOOM, set: setPercent, fit } : undefined });
  }, [info.size, i18n.language, natural, percent, onStatus, setPercent, fit, t]);

  const ctx: ImageCtx = { hasImage: natural !== null, mode: view.mode, percent };
  const commands = useMemo<Command<ImageCtx>[]>(
    () => [
      { id: "image.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage && c.percent < MAX_ZOOM, run: (c) => setPercent(nextZoom(c.percent, 1)) },
      { id: "image.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage && c.percent > MIN_ZOOM, run: (c) => setPercent(nextZoom(c.percent, -1)) },
      { id: "image.fit", labelKey: "viewer.fitToWindow", icon: Expand, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-images", checkKind: "radio", checkedWhen: (c) => c.mode === "fit", enabledWhen: (c) => c.hasImage, run: () => fit() },
      { id: "image.actualSize", labelKey: "viewer.actualSize", icon: Scan, risk: "read-only", helpSlug: "viewing-images", checkKind: "radio", checkedWhen: (c) => c.mode === "manual" && c.percent === 100, enabledWhen: (c) => c.hasImage, run: () => setPercent(100) },
      { id: "image.rotateLeft", labelKey: "viewer.rotateLeft", icon: RotateCcw, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage, run: () => setView((current) => { const next = { ...current, turns: (current.turns + 3) % 4 }; onStateChange(next); return next; }) },
      { id: "image.rotateRight", labelKey: "viewer.rotateRight", icon: RotateCw, risk: "read-only", helpSlug: "viewing-images", enabledWhen: (c) => c.hasImage, run: () => setView((current) => { const next = { ...current, turns: (current.turns + 1) % 4 }; onStateChange(next); return next; }) },
    ],
    [setPercent, fit, onStateChange],
  );
  useCommandShortcuts(commands, ctx, active);

  // Ctrl+wheel zooms around the pointer; a plain wheel scrolls. A native
  // listener, because React's wheel listener cannot cancel the event.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  const hasImage = natural !== null;
  useEffect(() => {
    const element = boxRef.current;
    if (!element || !hasImage) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left + element.scrollLeft;
      const pointerY = event.clientY - rect.top + element.scrollTop;
      const current = percentRef.current;
      const next = nextZoom(current, event.deltaY < 0 ? 1 : -1);
      const ratio = next / current;
      setPercent(next);
      requestAnimationFrame(() => {
        element.scrollLeft = pointerX * ratio - (event.clientX - rect.left);
        element.scrollTop = pointerY * ratio - (event.clientY - rect.top);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [hasImage, setPercent]);

  // Drag to pan when the image is larger than the view.
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !boxRef.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: boxRef.current.scrollLeft, top: boxRef.current.scrollTop };
  };
  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!drag.current || !boxRef.current) return;
    boxRef.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    boxRef.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const ribbon = <Ribbon def={RIBBON} ctx={ctx} commands={commands} accent="image" active={active} />;

  if (failed) {
    return (
      <ViewerFrame ribbon={ribbon}>
        <div className="adp-viewer-message" role="alert">
          <p>{t("viewer.imageError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      </ViewerFrame>
    );
  }

  // The stage has the turned size; the image keeps its own size and is
  // turned around the stage's center.
  const imageWidth = natural ? Math.max(1, Math.round((natural.width * percent) / 100)) : 0;
  const imageHeight = natural ? Math.max(1, Math.round((natural.height * percent) / 100)) : 0;
  const stageWidth = sideways ? imageHeight : imageWidth;
  const stageHeight = sideways ? imageWidth : imageHeight;
  return (
    <ViewerFrame ribbon={ribbon}>
      <div ref={boxRef} className="adp-image-view" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endDrag} onMouseLeave={endDrag}>
        {!natural ? (
          <div className="adp-image-loading" role="status" aria-label={t("components.loading")}>
            <div className="adp-skeleton-tile adp-image-skeleton" />
            {slow ? <p>{t("viewer.loadingImage")}</p> : null}
          </div>
        ) : null}
        <div className="adp-image-stage" style={natural ? { width: stageWidth, height: stageHeight } : undefined}>
          <img
            className="adp-image-checker"
            src={url}
            alt={info.name}
            decoding="async"
            draggable={false}
            style={
              natural
                ? {
                    width: imageWidth,
                    height: imageHeight,
                    transform: `translate(${(stageWidth - imageWidth) / 2}px, ${(stageHeight - imageHeight) / 2}px) rotate(${view.turns * 90}deg)`,
                  }
                : { visibility: "hidden" }
            }
            onLoad={(event) =>
              // SVGs without a size report 0: show them at 800 x 600.
              setNatural({ width: event.currentTarget.naturalWidth || 800, height: event.currentTarget.naturalHeight || 600 })
            }
            onError={() => setFailed(true)}
          />
        </div>
      </div>
    </ViewerFrame>
  );
}
```

What changed compared to Step 04a (for review): the zoom controls are commands on a ribbon (Zoom in, Zoom out, Fit to window, Actual size, Rotate left, Rotate right, with Alt key tips I, O, F, A, L, R); keyboard shortcuts go through `useCommandShortcuts`; the saved view state has `turns` (0 to 3).

In `help/en/viewing-images.md`, find exactly:

```markdown
- When the picture is bigger than the window, drag it with the mouse to move around.
```

Replace with:

```markdown
- When the picture is bigger than the window, drag it with the mouse to move around.
- **View** > **Rotate left** and **Rotate right** turn the picture on screen (the file is not changed). **Actual size** shows it at 100%.
```

In `help/es/viewing-images.md`, find exactly:

```markdown
- Cuando la imagen es más grande que la ventana, arrástrala con el mouse para moverte.
```

Replace with:

```markdown
- Cuando la imagen es más grande que la ventana, arrástrala con el mouse para moverte.
- **Vista** > **Girar a la izquierda** y **Girar a la derecha** giran la imagen en la pantalla (el archivo no cambia). **Tamaño real** la muestra al 100 %.
```

In `help/en/viewing-images.md`, find exactly:

```markdown
See also: "Opening files in tabs".
```

Replace with:

```markdown
See also: "Opening files in tabs" and "The ribbon".
```

In `help/es/viewing-images.md`, find exactly:

```markdown
Consulta también: «Abrir archivos en pestañas».
```

Replace with:

```markdown
Consulta también: «Abrir archivos en pestañas» y «La cinta de opciones».
```

**Tests:** no new tests; `imageZoom.test.ts` and `handlers.test.ts` must pass unchanged.

**Commit:** `feat(viewer): picture viewer ribbon with rotate and actual size [step-04b/T5]`

### T6 - Recognize text files without a known extension

**Files:** modify `src-tauri/src/files.rs`.

In `src-tauri/src/files.rs`, find exactly:

```rust
    let mime = match infer::get(&head) {
        Some(kind) => kind.mime_type().to_string(),
        None => mime_from_ext(&ext)
            .split(';')
            .next()
            .unwrap_or("application/octet-stream")
            .to_string(),
    };
```

Replace with:

```rust
    let by_ext = mime_from_ext(&ext)
        .split(';')
        .next()
        .unwrap_or("application/octet-stream");
    let mime = match infer::get(&head) {
        Some(kind) => kind.mime_type().to_string(),
        // Unknown extension, but the content looks like text (README,
        // LICENSE, .log.1, ...): show it in the text viewer (Step 04b).
        None if by_ext == "application/octet-stream" && looks_like_text(&head) => {
            "text/plain".to_string()
        }
        None => by_ext.to_string(),
    };
```

In `src-tauri/src/files.rs`, find exactly:

```rust
fn read_error_code(error: &std::io::Error) -> String {
```

Replace with:

```rust
/// True when the first bytes look like text: a UTF-16 byte-order mark, or
/// no zero bytes and almost no control characters (Step 04b).
pub fn looks_like_text(head: &[u8]) -> bool {
    if head.starts_with(&[0xFF, 0xFE]) || head.starts_with(&[0xFE, 0xFF]) {
        return true;
    }
    if head.contains(&0) {
        return false;
    }
    let controls = head
        .iter()
        .filter(|&&byte| byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0C | 0x1B))
        .count();
    controls * 100 <= head.len()
}

fn read_error_code(error: &std::io::Error) -> String {
```

In `src-tauri/src/files.rs`, find exactly:

```rust
    #[test]
    fn extensions_and_types() {
```

Replace with:

```rust
    #[test]
    fn text_is_recognized_by_content() {
        assert!(looks_like_text(b"Hello\r\nWorld\tdone\n"));
        assert!(looks_like_text("año ñandú".as_bytes()));
        assert!(looks_like_text(&[0xFF, 0xFE, b'h', 0, b'i', 0]));
        assert!(!looks_like_text(&[b'M', b'Z', 0x90, 0, 3, 0]));
        assert!(!looks_like_text(&[1, 2, 3, 4, 5, 6, 7, 8]));
        let dir = temp_dir("text");
        let readme = dir.join("README");
        fs::write(&readme, "Read me first.\n").unwrap();
        assert_eq!(detect(&readme).unwrap().mime, "text/plain");
        let binary = dir.join("data.bin");
        fs::write(&binary, [0u8, 1, 2, 3, 0, 0, 7]).unwrap();
        assert_eq!(detect(&binary).unwrap().mime, "application/octet-stream");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extensions_and_types() {
```

**Tests:** `text_is_recognized_by_content` (in `files.rs`).

**Commit:** `feat(files): recognize text files that have no known extension [step-04b/T6]`

### T7 - Open web and mail links in the default app

**Files:** create `src-tauri/src/links.rs`, `src/services/links.ts`; modify `src-tauri/src/main.rs`, `src-tauri/isolation/index.html`; add translation keys. This follows `plan/recipes/add-tauri-command.md`; the code is given here.

Create `src-tauri/src/links.rs`:

```rust
//! Opening web and mail links from viewers in the user's default browser
//! or mail app (Step 04b). Only http, https and mailto links are allowed.

use tauri::WebviewWindow;

use crate::ensure_main;

/// Longest link the app will open.
pub const MAX_URL_CHARS: usize = 2048;

/// Accept only http(s) and mailto links without spaces or control
/// characters. Returns the link unchanged.
pub fn validate_external_url(url: &str) -> Result<&str, String> {
    let lower = url.to_ascii_lowercase();
    let allowed_scheme = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed_scheme
        || url.chars().count() > MAX_URL_CHARS
        || url.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("links.invalid".to_string());
    }
    Ok(url)
}

#[cfg(windows)]
fn shell_open(url: &str) -> Result<(), String> {
    use crate::explorer::{wide_null, ComGuard};
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let _com = ComGuard::new();
    let verb = wide_null("open");
    let file = wide_null(url);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: `verb` and `file` outlive the call; COM is initialized on
    // this thread by `_com`.
    unsafe { ShellExecuteExW(&mut info) }.map_err(|_| "links.failed".to_string())
}

#[cfg(not(windows))]
fn shell_open(_url: &str) -> Result<(), String> {
    Err("links.failed".to_string())
}

/// Open a link the user clicked (after the UI asked them to confirm).
#[tauri::command]
pub async fn open_external_url(window: WebviewWindow, url: String) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || shell_open(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_web_and_mail_links() {
        assert!(validate_external_url("https://example.com/a?b=c").is_ok());
        assert!(validate_external_url("HTTP://example.com").is_ok());
        assert!(validate_external_url("mailto:someone@example.com").is_ok());
        for bad in [
            "file:///C:/Windows/system32/calc.exe",
            "javascript:alert(1)",
            "C:\\Windows\\notepad.exe",
            "ms-settings:privacy",
            "https://example.com/a b",
            "https://example.com/\u{0007}",
        ] {
            assert_eq!(
                validate_external_url(bad),
                Err("links.invalid".to_string()),
                "{bad}"
            );
        }
        let long = format!("https://example.com/{}", "a".repeat(MAX_URL_CHARS));
        assert!(validate_external_url(&long).is_err());
    }
}
```

Create `src/services/links.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/** Open an http(s) or mailto link in the default browser or mail app
 * (Step 04b). Rust refuses anything else with `links.invalid`. */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

/** True for links the app may open outside (the same rule Rust checks). */
export function isExternalUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url) && url.length <= 2048 && !/[\s\u0000-\u001f]/.test(url);
}
```

In `src-tauri/src/main.rs`, find exactly:

```rust
mod files;
```

Replace with:

```rust
mod files;
mod links;
```

In `src-tauri/src/main.rs`, find exactly:

```rust
            files::file_revoke,
        ])
```

Replace with:

```rust
            files::file_revoke,
            links::open_external_url,
        ])
```

In `src-tauri/isolation/index.html`, find exactly:

```html
'file_detect', 'file_grant', 'file_revoke'
```

Replace with:

```html
'file_detect', 'file_grant', 'file_revoke', 'open_external_url'
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `errors.links.invalid` | This link can't be opened from here. | Este vínculo no se puede abrir desde aquí. |
| `errors.links.failed` | The link couldn't be opened. | No se pudo abrir el vínculo. |
| `errors.links.other` | The link couldn't be opened. | No se pudo abrir el vínculo. |

**Tests:** `allows_only_web_and_mail_links` (in `links.rs`). `npm run lint:ipc` (in the gate) checks the new command is registered, allowed and called with the right argument name.

**Commit:** `feat(links): open web and mail links in the default browser or mail app [step-04b/T7]`

### T8 - The text and code viewer

**Files:** modify `themes/light.tokens.json`, `themes/dark.tokens.json` (then run `npm run tokens`, which rewrites `src/styles/tokens.css`), `src/main.tsx`, `src/handlers/index.ts`, `src/handlers/openPipeline.ts`; create everything under `src/handlers/text/`, `src/styles/viewers.css`, the three tests and the two help pages below; add translation keys.

First the theme tokens. The `"space"` line is the last line before the final `}` in both files:

In `themes/light.tokens.json`, find exactly:

```json
  "space": [2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25]
}
```

Replace with:

```json
  "space": [2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25],
  "syntax": {
    "_note": "Code colors for viewers and editors (Step 04b), from the GitHub light palette; all reach 4.5:1 on white.",
    "keyword": "#CF222E",
    "string": "#0A3069",
    "number": "#0550AE",
    "comment": "#6E7781",
    "function": "#8250DF",
    "type": "#953800",
    "tag": "#116329",
    "attribute": "#0550AE",
    "property": "#0550AE",
    "invalid": "#82071E",
    "match": "rgba(255, 223, 93, 0.55)",
    "matchSelected": "rgba(255, 159, 67, 0.6)"
  }
}
```

In `themes/dark.tokens.json`, find exactly:

```json
  "space": [2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25]
}
```

Replace with:

```json
  "space": [2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25],
  "syntax": {
    "_note": "Code colors for viewers and editors (Step 04b), from the GitHub dark palette.",
    "keyword": "#FF7B72",
    "string": "#A5D6FF",
    "number": "#79C0FF",
    "comment": "#8B949E",
    "function": "#D2A8FF",
    "type": "#FFA657",
    "tag": "#7EE787",
    "attribute": "#79C0FF",
    "property": "#79C0FF",
    "invalid": "#FFA198",
    "match": "rgba(187, 128, 9, 0.45)",
    "matchSelected": "rgba(255, 166, 87, 0.55)"
  }
}
```

Run `npm run tokens`. Check: `src/styles/tokens.css` now contains `--adp-syntax-keyword` twice (light and dark).

Create `src/handlers/text/encoding.ts`:

```ts
/** Text encodings for the text viewer (Step 04b). Pure, unit-tested. The
 * browser's TextDecoder does the decoding; we only choose the encoding. */

/** Encodings the user can pick (WHATWG names TextDecoder understands). */
export const ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-15",
  "windows-1250",
  "windows-1251",
  "shift_jis",
  "gbk",
  "big5",
  "euc-kr",
] as const;
export type EncodingName = (typeof ENCODINGS)[number];

/** How each encoding is named in the status bar and the Encoding list
 * (technical names, the same in every language). */
export const ENCODING_LABELS: Record<EncodingName, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "windows-1252": "Windows-1252",
  "iso-8859-1": "ISO-8859-1",
  "iso-8859-15": "ISO-8859-15",
  "windows-1250": "Windows-1250",
  "windows-1251": "Windows-1251",
  shift_jis: "Shift-JIS",
  gbk: "GBK",
  big5: "Big5",
  "euc-kr": "EUC-KR",
};

export interface DetectedEncoding {
  encoding: EncodingName;
  /** Bytes to skip at the start (a byte-order mark). */
  bomLength: number;
}

/** Choose an encoding from the first bytes: a byte-order mark wins; else
 * valid UTF-8; else Windows-1252 (the usual Windows "ANSI" text). */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", bomLength: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", bomLength: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", bomLength: 2 };
  // `stream: true` lets a character cut at the end of the sample wait for
  // more bytes instead of counting as an error; any other bad byte throws.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return { encoding: "utf-8", bomLength: 0 };
  } catch {
    return { encoding: "windows-1252", bomLength: 0 };
  }
}

/** Decode bytes, skipping a byte-order mark of the chosen encoding. */
export function decodeText(bytes: Uint8Array, encoding: EncodingName): string {
  let start = 0;
  if (encoding === "utf-8" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  if (encoding === "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe) start = 2;
  if (encoding === "utf-16be" && bytes[0] === 0xfe && bytes[1] === 0xff) start = 2;
  return new TextDecoder(encoding).decode(bytes.subarray(start));
}

/** "Windows (CRLF)", "Unix (LF)", or "Mixed" line endings in a text. */
export function lineEndingOf(text: string): "crlf" | "lf" | "mixed" | "none" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return "none";
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "crlf" : "lf";
}
```

Create `src/handlers/text/languages.ts`:

```ts
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** Syntax highlighting per file type (Step 04b). Each language loads only
 * when a file of that type opens (its own code chunk), so opening a plain
 * text file never waits for it. */

export type LanguageId =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "html"
  | "css"
  | "xml"
  | "markdown"
  | "python"
  | "rust"
  | "sql"
  | "java"
  | "cpp"
  | "yaml"
  | "shell"
  | "powershell"
  | "toml"
  | "ini"
  | "go"
  | "ruby"
  | "lua"
  | "swift"
  | "csharp"
  | "kotlin"
  | "dockerfile"
  | "diff";

const BY_EXTENSION: Record<string, LanguageId> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx",
  json: "json", jsonc: "json", json5: "json", ipynb: "json", geojson: "json", webmanifest: "json",
  html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", less: "css",
  xml: "xml", xsd: "xml", xsl: "xml", xslt: "xml", plist: "xml", csproj: "xml", vcxproj: "xml", props: "xml", targets: "xml", resx: "xml", svg: "xml",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  py: "python", pyw: "python", pyi: "python",
  rs: "rust",
  sql: "sql",
  java: "java",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  toml: "toml",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini", editorconfig: "ini", gitconfig: "ini", inf: "ini", reg: "ini",
  go: "go",
  rb: "ruby",
  lua: "lua",
  swift: "swift",
  cs: "csharp",
  kt: "kotlin", kts: "kotlin",
  dockerfile: "dockerfile",
  diff: "diff", patch: "diff",
};

/** The language for a file name, or null for plain text. */
export function languageIdFor(name: string): LanguageId | null {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  return BY_EXTENSION[ext] ?? null;
}

/** Load the CodeMirror extension for a language. */
export async function loadLanguage(id: LanguageId): Promise<Extension> {
  // @codemirror/language is already loaded with the editor; only the
  // modes themselves load on demand.
  const legacy = async (load: () => Promise<Parameters<typeof StreamLanguage.define>[0]>) => StreamLanguage.define(await load());
  switch (id) {
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "cpp":
      return (await import("@codemirror/lang-cpp")).cpp();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "shell":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell);
    case "powershell":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell);
    case "toml":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml);
    case "ini":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties);
    case "go":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go);
    case "ruby":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby);
    case "lua":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/lua")).lua);
    case "swift":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift);
    case "csharp":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp);
    case "kotlin":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin);
    case "dockerfile":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile);
    case "diff":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/diff")).diff);
  }
}
```

Create `src/handlers/text/editorSetup.ts`:

```ts
import { defaultKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, search, searchPanelOpen, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** CodeMirror setup shared by the text and Markdown viewers (Step 04b) and
 * the text editor (Step 06a). Colors come from our tokens. */

export const adpTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--adp-color-text-primary)",
    backgroundColor: "var(--adp-color-surface-window)",
    fontSize: "calc(13px * var(--adp-text-zoom, 1))",
  },
  ".cm-scroller": { fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace', lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--adp-color-text-primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--adp-color-surface-pane)",
    color: "var(--adp-color-text-tertiary)",
    borderRight: "1px solid var(--adp-color-border-panel)",
  },
  ".cm-activeLine": { backgroundColor: "var(--adp-color-surface-pane)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--adp-color-surface-selected)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--adp-color-surface-selected-row)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--adp-syntax-match)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--adp-syntax-match-selected)" },
  // Our own search box drives the search; CodeMirror's panel stays hidden.
  ".cm-panels": { display: "none" },
});

export const adpHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--adp-syntax-keyword)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--adp-syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--adp-syntax-number)" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--adp-syntax-comment)", fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--adp-syntax-function)" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--adp-syntax-type)" },
    { tag: [tags.tagName, tags.angleBracket], color: "var(--adp-syntax-tag)" },
    { tag: tags.attributeName, color: "var(--adp-syntax-attribute)" },
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--adp-syntax-property)" },
    { tag: tags.heading, color: "var(--adp-syntax-keyword)", fontWeight: "600" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "600" },
    { tag: [tags.link, tags.url], color: "var(--adp-syntax-function)", textDecoration: "underline" },
    { tag: tags.invalid, color: "var(--adp-syntax-invalid)" },
  ]),
);

/** CodeMirror's search, with its panel replaced by an empty one: the file
 * tab's search box (and its translated texts) drives it. */
export const hiddenSearch = search({
  createPanel: () => {
    const dom = document.createElement("div");
    return { dom, top: true };
  },
});

/** Extensions for a read-only view of text. The text cannot change, but
 * the caret, selection, Ctrl+A and Ctrl+C work as usual. */
export function readOnlyExtensions(options: { phrases: Record<string, string> }): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorState.phrases.of(options.phrases),
    keymap.of(defaultKeymap),
    highlightActiveLine(),
    hiddenSearch,
    adpTheme,
    adpHighlight,
  ];
}

export { lineNumbers };

/** Highlight the matches of `text` and select one: "here" selects the first
 * match at or after the start of the selection (used while typing), "next"
 * and "previous" move from the current match. An empty text clears the
 * search. Case-insensitive, plain text. */
export function runFind(view: EditorView, text: string, move: "here" | "next" | "previous"): void {
  if (text === "") {
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    return;
  }
  if (!searchPanelOpen(view.state)) openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text, caseSensitive: false, literal: true })) });
  if (move === "here") {
    view.dispatch({ selection: { anchor: view.state.selection.main.from } });
    findNext(view);
  } else if (move === "next") {
    findNext(view);
  } else {
    findPrevious(view);
  }
}
```

Create `src/handlers/text/TextView.tsx`:

```tsx
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronLeft, ChevronRight, Hash, Scan, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { lineNumbers, readOnlyExtensions, runFind } from "./editorSetup";
import { decodeText, detectEncoding, ENCODING_LABELS, ENCODINGS, lineEndingOf, type EncodingName } from "./encoding";
import { languageIdFor, loadLanguage } from "./languages";

/** Files above this size open in parts ("large file mode", read-only). */
export const LARGE_TEXT_BYTES = 10 * 1024 * 1024;
/** Size of one part in large file mode. */
export const PART_BYTES = 1024 * 1024;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;

interface SavedTextState {
  wrap: boolean;
  numbers: boolean;
  zoom: number;
}

interface TextCtx {
  ready: boolean;
  wrap: boolean;
  numbers: boolean;
  zoom: number;
  paged: boolean;
  part: number;
  parts: number;
}

function readSaved(state: unknown): SavedTextState {
  const value = (state ?? {}) as Partial<SavedTextState>;
  return {
    wrap: typeof value.wrap === "boolean" ? value.wrap : false,
    numbers: typeof value.numbers === "boolean" ? value.numbers : true,
    zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1,
  };
}

async function fetchBytes(url: string, range?: { start: number; end: number }): Promise<Uint8Array> {
  const response = await fetch(url, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined);
  if (!response.ok) throw new Error(`files.read_failed`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Text and code viewer (Step 04b): CodeMirror, read-only, with syntax
 * colors loaded per type, word wrap, line numbers, zoom, encodings, find,
 * and a large-file mode that shows the file in 1 MB parts. */
export default function TextView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartments = useRef({ language: new Compartment(), wrap: new Compartment(), numbers: new Compartment() });
  const [settings, setSettings] = useState<SavedTextState>(() => readSaved(savedState));
  const [encoding, setEncoding] = useState<EncodingName | null>(null);
  const [lineEnding, setLineEnding] = useState<"crlf" | "lf" | "mixed" | "none">("none");
  const [cursor, setCursor] = useState({ line: 1, column: 1, lines: 1 });
  const [failed, setFailed] = useState(false);
  const [part, setPart] = useState(0);
  const [loaded, setLoaded] = useState<Uint8Array | null>(null);
  const paged = info.size > LARGE_TEXT_BYTES;
  const parts = paged ? Math.ceil(info.size / PART_BYTES) : 1;

  const update = useCallback(
    (patch: Partial<SavedTextState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Create the editor once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = compartments.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          readOnlyExtensions({
            phrases: {
              "current match": t("text.cm.currentMatch"),
              "on line": t("text.cm.onLine"),
              "Control character": t("text.cm.controlCharacter"),
            },
          }),
          c.language.of([]),
          c.wrap.of(settings.wrap ? EditorView.lineWrapping : []),
          c.numbers.of(settings.numbers ? lineNumbers() : []),
          EditorView.updateListener.of((change) => {
            if (!change.selectionSet && !change.docChanged) return;
            const head = change.state.selection.main.head;
            const line = change.state.doc.lineAt(head);
            setCursor({ line: line.number, column: head - line.from + 1, lines: change.state.doc.lines });
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; settings are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the bytes: the whole file, or the current part in large file mode.
  useEffect(() => {
    let cancelled = false;
    const start = part * PART_BYTES;
    const request = paged ? fetchBytes(url, { start, end: Math.min(info.size, start + PART_BYTES) - 1 }) : fetchBytes(url);
    request
      .then((bytes) => {
        if (cancelled) return;
        setEncoding((current) => current ?? detectEncoding(bytes.subarray(0, 65536)).encoding);
        setLoaded(bytes);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, paged, part, info.size]);

  // Show the loaded bytes in the chosen encoding.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !loaded || !encoding) return;
    const text = decodeText(loaded, encoding);
    setLineEnding(lineEndingOf(text.slice(0, 65536)));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    view.scrollDOM.scrollTop = 0;
  }, [loaded, encoding]);

  // Syntax colors, loaded once per file type.
  useEffect(() => {
    const id = languageIdFor(info.name);
    if (!id) return;
    let cancelled = false;
    void loadLanguage(id).then((language) => {
      const view = viewRef.current;
      if (!cancelled && view) view.dispatch({ effects: compartments.current.language.reconfigure(language) });
    });
    return () => {
      cancelled = true;
    };
  }, [info.name]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        compartments.current.wrap.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
        compartments.current.numbers.reconfigure(settings.numbers ? lineNumbers() : []),
      ],
    });
  }, [settings.wrap, settings.numbers]);

  // The file tab's search box.
  const lastRequest = useRef(find.request);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const moved = find.request !== lastRequest.current;
    lastRequest.current = find.request;
    runFind(view, find.text, moved ? (find.backwards ? "previous" : "next") : "here");
  }, [find.text, find.request, find.backwards]);

  // Status bar.
  useEffect(() => {
    const items = [t("text.position", { line: cursor.line, column: cursor.column }), t("text.lines", { count: cursor.lines })];
    if (encoding) items.push(ENCODING_LABELS[encoding]);
    if (lineEnding !== "none") items.push(t(`text.lineEnding.${lineEnding}`));
    if (paged) items.push(t("text.part", { part: part + 1, parts }));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [cursor, encoding, lineEnding, paged, part, parts, info.size, i18n.language, onStatus, t]);

  const ctx: TextCtx = { ready: encoding !== null, wrap: settings.wrap, numbers: settings.numbers, zoom: settings.zoom, paged, part, parts };
  const zoomBy = (factor: number) => update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(settings.zoom * factor * 10) / 10)) });

  const commands = useMemo<Command<TextCtx>[]>(
    () => [
      { id: "text.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom < ZOOM_MAX, run: () => zoomBy(1.1) },
      { id: "text.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom > ZOOM_MIN, run: () => zoomBy(1 / 1.1) },
      { id: "text.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
      { id: "text.wordWrap", labelKey: "text.wordWrap", icon: WrapText, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.wrap, enabledWhen: () => true, run: (c) => update({ wrap: !c.wrap }) },
      { id: "text.lineNumbers", labelKey: "text.lineNumbers", icon: Hash, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.numbers, enabledWhen: () => true, run: (c) => update({ numbers: !c.numbers }) },
      { id: "text.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "text.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part < c.parts - 1, run: () => setPart((value) => Math.min(parts - 1, value + 1)) },
    ],
    // zoomBy and update only read state through their arguments and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.zoom, parts, update],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "text.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "text.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "text.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
          {
            id: "show",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "text.wordWrap", keyTip: "W" },
              { type: "toggle", command: "text.lineNumbers", keyTip: "N" },
            ],
          },
          {
            id: "encoding",
            labelKey: "text.encoding",
            controls: [
              {
                type: "custom",
                id: "encoding",
                render: () => (
                  <label className="adp-ribbon-custom">
                    {t("text.encoding")}
                    <select value={encoding ?? "utf-8"} onChange={(event) => setEncoding(event.target.value as EncodingName)}>
                      {ENCODINGS.map((name) => (
                        <option key={name} value={name}>
                          {ENCODING_LABELS[name]}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              },
            ],
          },
          {
            id: "parts",
            labelKey: "text.parts",
            controls: [
              { type: "button", command: "text.previousPart", keyTip: "P" },
              { type: "button", command: "text.nextPart", keyTip: "X" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {paged ? (
        <div className="adp-text-notice" role="note">
          {t("text.largeFileNotice", { size: formatSize(PART_BYTES, i18n.language) })}
        </div>
      ) : null}
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("text.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="adp-text-host"
        hidden={failed}
        style={{ ["--adp-text-zoom" as string]: String(settings.zoom) }}
      />
    </ViewerFrame>
  );
}
```

Create `src/handlers/text/index.ts`:

```ts
import { FileText } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Plain text, logs, configuration and source code (Step 04b). Any size:
 * files over 10 MB open read-only in 1 MB parts. */
export const textHandler: Handler = {
  id: "text",
  version: 1,
  labelKey: "handlers.text",
  icon: FileText,
  accent: "explorer",
  extensions: [
    "txt", "text", "log", "out", "nfo", "diz", "me", "1st",
    "md", "markdown", "csv", "tsv", "srt", "vtt",
    "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx",
    "json", "jsonc", "json5", "ipynb", "geojson", "webmanifest",
    "css", "scss", "less", "vue", "svelte",
    "xml", "xsd", "xsl", "xslt", "plist", "csproj", "vcxproj", "props", "targets", "resx", "manifest",
    "py", "pyw", "pyi", "rs", "sql", "java", "c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx", "ino",
    "yml", "yaml", "sh", "bash", "zsh", "ps1", "psm1", "psd1", "bat", "cmd", "vbs",
    "toml", "ini", "cfg", "conf", "properties", "env", "editorconfig", "gitignore", "gitattributes", "gitconfig", "inf", "reg",
    "go", "rb", "lua", "swift", "cs", "kt", "kts", "dockerfile", "diff", "patch", "lock",
  ],
  mimeTypes: ["text/plain"],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "viewing-text",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./TextView")),
};
```

Create `src/styles/viewers.css`:

```css
/* Text and Markdown viewers (Step 04b). Colors only through tokens. */
.adp-text-host { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.adp-text-host[hidden] { display: none; }
.adp-text-host .cm-editor { flex: 1; min-height: 0; }
.adp-text-host .cm-editor.cm-focused { outline: none; }
.adp-text-notice { position: absolute; top: 0; left: 0; right: 0; z-index: 2; padding: var(--adp-space-2) var(--adp-space-5); background: var(--adp-color-surface-header); color: var(--adp-color-text-secondary); font-size: var(--adp-font-small); border-bottom: 1px solid var(--adp-color-border-panel); }
.adp-text-notice + .adp-text-host { margin-top: 28px; }
.adp-markdown-frame { flex: 1; min-width: 0; border: none; background: var(--adp-color-surface-window); }
.adp-link-preview { word-break: break-all; font-family: "Cascadia Mono", Consolas, monospace; color: var(--adp-color-text-primary); }
```

Create `src/__tests__/textEncoding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding, lineEndingOf } from "../handlers/text/encoding";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("text encodings", () => {
  it("recognizes byte-order marks", () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x41))).toEqual({ encoding: "utf-8", bomLength: 3 });
    expect(detectEncoding(bytes(0xff, 0xfe, 0x41, 0x00))).toEqual({ encoding: "utf-16le", bomLength: 2 });
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x41))).toEqual({ encoding: "utf-16be", bomLength: 2 });
  });

  it("accepts UTF-8 even when the sample ends inside a character", () => {
    const text = new TextEncoder().encode("año ñandú €");
    expect(detectEncoding(text).encoding).toBe("utf-8");
    expect(detectEncoding(text.subarray(0, text.length - 1)).encoding).toBe("utf-8");
  });

  it("falls back to Windows-1252 for other bytes", () => {
    expect(detectEncoding(bytes(0x61, 0xf1, 0x6f)).encoding).toBe("windows-1252");
    expect(decodeText(bytes(0x61, 0xf1, 0x6f), "windows-1252")).toBe("año");
  });

  it("skips the byte-order mark when decoding", () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69), "utf-8")).toBe("hi");
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00), "utf-16le")).toBe("hi");
  });

  it("names line endings", () => {
    expect(lineEndingOf("a\r\nb\r\n")).toBe("crlf");
    expect(lineEndingOf("a\nb\n")).toBe("lf");
    expect(lineEndingOf("a\r\nb\n")).toBe("mixed");
    expect(lineEndingOf("abc")).toBe("none");
  });
});
```

Create `src/__tests__/textLanguages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { languageIdFor, loadLanguage } from "../handlers/text/languages";

describe("text languages", () => {
  it("maps file names to languages", () => {
    expect(languageIdFor("main.rs")).toBe("rust");
    expect(languageIdFor("App.TSX")).toBe("tsx");
    expect(languageIdFor("settings.json")).toBe("json");
    expect(languageIdFor("Dockerfile")).toBe("dockerfile");
    expect(languageIdFor("script.ps1")).toBe("powershell");
    expect(languageIdFor("notes.txt")).toBeNull();
    expect(languageIdFor("README")).toBeNull();
  });

  it("loads a modern and a legacy language", async () => {
    expect(await loadLanguage("json")).toBeTruthy();
    expect(await loadLanguage("powershell")).toBeTruthy();
  });
});
```

Create `src/__tests__/textFind.test.ts`:

```ts
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { readOnlyExtensions, runFind } from "../handlers/text/editorSetup";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function makeView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: readOnlyExtensions({ phrases: {} }) }) });
  return view;
}

const selected = (v: EditorView) => [v.state.selection.main.from, v.state.selection.main.to];

describe("find in the text viewer", () => {
  it("selects the first match while typing and moves with next and previous", () => {
    const v = makeView("one two One three one");
    runFind(v, "one", "here");
    expect(selected(v)).toEqual([0, 3]);
    runFind(v, "one", "next");
    expect(selected(v)).toEqual([8, 11]);
    runFind(v, "one", "next");
    expect(selected(v)).toEqual([18, 21]);
    runFind(v, "one", "previous");
    expect(selected(v)).toEqual([8, 11]);
  });

  it("keeps the current match when the search text grows", () => {
    const v = makeView("tea team teams");
    runFind(v, "tea", "here");
    runFind(v, "tea", "next");
    expect(selected(v)).toEqual([4, 7]);
    runFind(v, "team", "here");
    expect(selected(v)).toEqual([4, 8]);
  });

  it("is read-only for the user", () => {
    const v = makeView("abc");
    expect(v.state.readOnly).toBe(true);
    expect(v.contentDOM.getAttribute("aria-readonly")).toBe("true");
  });
});
```

Create `help/en/viewing-text.md`:

```markdown
# Viewing text and code

Text files, logs, settings files and source code open in a tab, with colors for more than 30 programming and settings languages.

## Reading the file

- Select text with the mouse or **Shift+arrows**; **Ctrl+A** selects everything and **Ctrl+C** copies.
- **View** > **Word wrap** wraps long lines to the window. **Line numbers** shows or hides the numbers at the left.
- **Ctrl++** and **Ctrl+-** make the text bigger or smaller; **Ctrl+0** goes back to the normal size.
- The status bar shows the line and column of the cursor, the number of lines, the encoding, the kind of line endings, and the file size.

## Finding text

- Type in the search box at the top right (or press **Ctrl+F** to go there). Matches are highlighted as you type.
- **Enter** or **F3** goes to the next match; **Shift+Enter** or **Shift+F3** goes back. **Esc** clears the search.

## Encodings

The viewer recognizes UTF-8, UTF-16 and the usual Windows encoding automatically. If accents or symbols look wrong, choose another one in **View** > **Encoding**.

## Big files

Files bigger than 10 MB open in parts of 1 MB, read-only, so they show at once. Use **Next part** and **Previous part** (**Alt+Page Down** and **Alt+Page Up**) to move through the file; the status bar says which part you are reading.

## Good to know

- The viewer never changes the file. Editing arrives in a later update.
- Web pages (.html) open in your browser; scripts (.bat, .ps1, .js...) open here as text, so they never run by accident. To run one, right-click it and choose **Open in Windows app**.

See also: "Viewing Markdown" and "The ribbon".
```

Create `help/es/viewing-text.md`:

```markdown
# Ver texto y código

Los archivos de texto, los registros, los archivos de configuración y el código fuente se abren en una pestaña, con colores para más de 30 lenguajes de programación y de configuración.

## Leer el archivo

- Selecciona texto con el mouse o con **Mayús+flechas**; **Ctrl+A** selecciona todo y **Ctrl+C** copia.
- **Vista** > **Ajuste de línea** ajusta las líneas largas a la ventana. **Números de línea** muestra u oculta los números de la izquierda.
- **Ctrl++** y **Ctrl+-** agrandan o achican el texto; **Ctrl+0** vuelve al tamaño normal.
- La barra de estado muestra la línea y la columna del cursor, el número de líneas, la codificación, el tipo de finales de línea y el tamaño del archivo.

## Buscar texto

- Escribe en el cuadro de búsqueda de arriba a la derecha (o pulsa **Ctrl+F** para ir allí). Las coincidencias se resaltan mientras escribes.
- **Entrar** o **F3** va a la siguiente coincidencia; **Mayús+Entrar** o **Mayús+F3** vuelve a la anterior. **Esc** borra la búsqueda.

## Codificaciones

El visor reconoce automáticamente UTF-8, UTF-16 y la codificación habitual de Windows. Si los acentos o los símbolos se ven mal, elige otra en **Vista** > **Codificación**.

## Archivos grandes

Los archivos de más de 10 MB se abren en partes de 1 MB, en modo de solo lectura, para que se muestren al instante. Usa **Parte siguiente** y **Parte anterior** (**Alt+Av Pág** y **Alt+Re Pág**) para recorrer el archivo; la barra de estado indica qué parte estás leyendo.

## Para tener en cuenta

- El visor nunca cambia el archivo. La edición llegará en una actualización posterior.
- Las páginas web (.html) se abren en tu navegador; los scripts (.bat, .ps1, .js...) se abren aquí como texto, así que nunca se ejecutan por accidente. Para ejecutar uno, haz clic con el botón derecho y elige **Abrir en la aplicación de Windows**.

Consulta también: «Ver Markdown» y «La cinta de opciones».
```

Then:

In `src/main.tsx`, find exactly:

```tsx
import "./styles/ribbon.css";
```

Replace with:

```tsx
import "./styles/ribbon.css";
import "./styles/viewers.css";
```

In `src/handlers/index.ts`, find exactly:

```ts
import { imageHandler } from "./image";
import { HandlerRegistry } from "./registry";
```

Replace with:

```ts
import { imageHandler } from "./image";
import { HandlerRegistry } from "./registry";
import { textHandler } from "./text";
```

In `src/handlers/index.ts`, find exactly:

```ts
  registry.register(imageHandler);
```

Replace with:

```ts
  registry.register(imageHandler);
  registry.register(textHandler);
```

In `src/handlers/openPipeline.ts`, find exactly:

```ts
/** Pure: what to do with a detected file. `preference` is the user's
 * choice for this extension (Settings > Default apps, Step 04c). */
export function decideOpen(
  info: FileTypeInfo,
  registry: HandlerRegistry,
  preference: "builtin" | "windows" | undefined = undefined,
): OpenDecision {
  if (preference === "windows") return { kind: "windows", info };
```

Replace with:

```ts
/** Types that always open in Windows: programs, shortcuts, links, and web
 * pages (shown with "Open as text" if the user wants their source). */
export const ALWAYS_WINDOWS: readonly string[] = [
  "exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "appinstaller", "com", "scr", "cpl", "msc",
  "lnk", "url", "website", "appref-ms", "library-ms", "search-ms",
  "html", "htm", "xhtml", "mht", "mhtml",
];

/** Pure: what to do with a detected file. `preference` is the user's
 * choice for this extension (Settings > Default apps, Step 04c). */
export function decideOpen(
  info: FileTypeInfo,
  registry: HandlerRegistry,
  preference: "builtin" | "windows" | undefined = undefined,
): OpenDecision {
  if (preference === "windows" || ALWAYS_WINDOWS.includes(info.ext)) return { kind: "windows", info };
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `handlers.text` | Text | Texto |
| `text.position` | Ln {line}, Col {column} | Lín. {line}, col. {column} |
| `text.lines` | {count, plural, one {# line} other {# lines}} | {count, plural, one {# línea} other {# líneas}} |
| `text.lineEnding.crlf` | Windows (CRLF) | Windows (CRLF) |
| `text.lineEnding.lf` | Unix (LF) | Unix (LF) |
| `text.lineEnding.mixed` | Mixed line endings | Finales de línea mixtos |
| `text.part` | Part {part} of {parts} | Parte {part} de {parts} |
| `text.parts` | Parts | Partes |
| `text.previousPart` | Previous part | Parte anterior |
| `text.nextPart` | Next part | Parte siguiente |
| `text.wordWrap` | Word wrap | Ajuste de línea |
| `text.lineNumbers` | Line numbers | Números de línea |
| `text.encoding` | Encoding | Codificación |
| `text.largeFileNotice` | This file is large, so it opens read-only in parts of {size}. Use Next part to keep reading. | Este archivo es grande, así que se abre en modo de solo lectura, en partes de {size}. Usa Parte siguiente para seguir leyendo. |
| `text.loadError` | This file couldn't be shown. | No se pudo mostrar este archivo. |
| `text.cm.currentMatch` | current match | coincidencia actual |
| `text.cm.onLine` | on line | en la línea |
| `text.cm.controlCharacter` | Control character | Carácter de control |

**Tests:** `textEncoding.test.ts`, `textLanguages.test.ts`, `textFind.test.ts` (selects the first match while typing and moves with next and previous; keeps the current match when the search text grows; is read-only for the user).

**Commit:** `feat(viewer): text and code viewer with colors, search, encodings and large-file parts [step-04b/T8]`

### T9 - The Markdown viewer

**Files:** create everything under `src/handlers/markdown/`, the two tests and the two help pages below; modify `src/handlers/index.ts`; add translation keys.

Create `src/handlers/markdown/render.ts`:

```ts
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/** Markdown to a complete, safe HTML page for the Markdown viewer's frame
 * (Step 04b). Raw HTML inside the Markdown is shown as text (`html: false`)
 * and the result is cleaned with DOMPurify. The page has no scripts. */

export interface DocColors {
  text: string;
  muted: string;
  background: string;
  border: string;
  link: string;
  codeBackground: string;
  mark: string;
  markCurrent: string;
}

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** Only characters that appear in CSS colors ("#fff", "rgb(1, 2, 3)"). */
function safeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^[#a-zA-Z0-9(),.%\s-]+$/.test(trimmed) && trimmed !== "" ? trimmed : fallback;
}

export function renderMarkdownPage(source: string, colors: DocColors, zoom: number, lang: string): string {
  const body = DOMPurify.sanitize(markdown.render(source), { USE_PROFILES: { html: true } });
  const c = {
    text: safeColor(colors.text, "#202020"),
    muted: safeColor(colors.muted, "#616161"),
    background: safeColor(colors.background, "#ffffff"),
    border: safeColor(colors.border, "#e0e0e0"),
    link: safeColor(colors.link, "#0067c0"),
    code: safeColor(colors.codeBackground, "#fafafa"),
    mark: safeColor(colors.mark, "rgba(255, 223, 93, 0.5)"),
    markCurrent: safeColor(colors.markCurrent, "rgba(255, 159, 67, 0.6)"),
  };
  const size = Math.round(15 * Math.min(3, Math.max(0.5, zoom)));
  const css = `
html { background: ${c.background}; }
body { margin: 0; color: ${c.text}; background: ${c.background}; font: ${size}px/1.6 Inter, "Segoe UI", system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 32px 40px 64px; }
h1, h2 { border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.6em; }
a { color: ${c.link}; }
code, pre { font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.9em; background: ${c.code}; border-radius: 4px; }
code { padding: 0.15em 0.35em; }
pre { padding: 12px 16px; overflow: auto; border: 1px solid ${c.border}; }
pre code { padding: 0; background: transparent; }
blockquote { margin: 1em 0; padding: 0 1em; color: ${c.muted}; border-left: 4px solid ${c.border}; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid ${c.border}; padding: 6px 12px; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid ${c.border}; }
::highlight(adp-find) { background-color: ${c.mark}; }
::highlight(adp-find-current) { background-color: ${c.markCurrent}; }
`;
  const language = /^[a-z-]{2,10}$/i.test(lang) ? lang : "en";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>${css}</style></head><body><main>${body}</main></body></html>`;
}

/** Highlight every case-insensitive match of `text` in a page and scroll to
 * match number `current` (wrapping around). Uses the CSS Custom Highlight
 * API, so the page itself is never changed. Returns the number of matches
 * and the index shown. */
export function findInPage(doc: Document, text: string, current: number): { count: number; index: number } {
  const win = doc.defaultView;
  const highlights = win && "highlights" in win.CSS ? win.CSS.highlights : null;
  if (!win || !highlights) return { count: 0, index: -1 };
  highlights.delete("adp-find");
  highlights.delete("adp-find-current");
  if (text === "") return { count: 0, index: -1 };
  const needle = text.toLowerCase();
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const original = node.nodeValue ?? "";
    const value = original.toLowerCase();
    if (value.length !== original.length) continue;
    let at = value.indexOf(needle);
    while (at !== -1) {
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      at = value.indexOf(needle, at + needle.length);
    }
  }
  if (ranges.length === 0) return { count: 0, index: -1 };
  const index = ((current % ranges.length) + ranges.length) % ranges.length;
  highlights.set("adp-find", new win.Highlight(...ranges));
  highlights.set("adp-find-current", new win.Highlight(ranges[index]));
  ranges[index].startContainer.parentElement?.scrollIntoView({ block: "center" });
  return { count: ranges.length, index };
}
```

Create `src/handlers/markdown/MarkdownView.tsx`:

```tsx
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BookOpen, Code, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import { isExternalUrl, openExternalUrl } from "../../services/links";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { lineNumbers, readOnlyExtensions, runFind } from "../text/editorSetup";
import { decodeText, detectEncoding } from "../text/encoding";
import { loadLanguage } from "../text/languages";
import type { HandlerViewProps } from "../types";
import { findInPage, renderMarkdownPage, type DocColors } from "./render";

interface SavedMarkdownState {
  mode: "rendered" | "source";
  zoom: number;
}

interface MarkdownCtx {
  mode: "rendered" | "source";
  zoom: number;
}

function readSaved(state: unknown): SavedMarkdownState {
  const value = (state ?? {}) as Partial<SavedMarkdownState>;
  return {
    mode: value.mode === "source" ? "source" : "rendered",
    zoom: typeof value.zoom === "number" ? Math.min(3, Math.max(0.5, value.zoom)) : 1,
  };
}

/** The page colors come from the app's current theme. */
function themeColors(): DocColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name);
  return {
    text: read("--adp-color-text-primary"),
    muted: read("--adp-color-text-secondary"),
    background: read("--adp-color-surface-window"),
    border: read("--adp-color-border-subtle"),
    link: read("--adp-accent-explorer"),
    codeBackground: read("--adp-color-surface-pane"),
    mark: read("--adp-syntax-match"),
    markCurrent: read("--adp-syntax-match-selected"),
  };
}

/** Markdown viewer (Step 04b): the rendered page in a frame that cannot
 * run scripts, or the source in CodeMirror. Links ask before opening in
 * the browser. */
export default function MarkdownView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<SavedMarkdownState>(() => readSaved(savedState));
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [colors, setColors] = useState<DocColors>(() => themeColors());
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [matches, setMatches] = useState(0);
  const [frameLoads, setFrameLoads] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceHost = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const matchIndex = useRef(0);
  /** Reading position (0 to 1), kept when the page is rebuilt (zoom, theme). */
  const scrollRatio = useRef(0);

  const update = useCallback(
    (patch: Partial<SavedMarkdownState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("files.read_failed"))))
      .then((buffer) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        setSource(decodeText(bytes, detectEncoding(bytes.subarray(0, 65536)).encoding));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Follow theme changes (the page's colors are fixed when it is built).
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(themeColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  const page = useMemo(
    () => (source === null ? "" : renderMarkdownPage(source, colors, settings.zoom, i18n.language)),
    [source, colors, settings.zoom, i18n.language],
  );

  // The page frame shares our origin but cannot run scripts. We pass its
  // shortcut keys to the app and turn its link clicks into a question.
  const attachFrame = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const scroller = doc.scrollingElement;
    if (scroller) scroller.scrollTop = scrollRatio.current * scroller.scrollHeight;
    doc.addEventListener("scroll", () => {
      const element = doc.scrollingElement;
      if (element) scrollRatio.current = element.scrollTop / Math.max(1, element.scrollHeight);
    });
    doc.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.altKey || event.metaKey || /^F\d+$/.test(event.key))) return;
      const forwarded = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
    });
    doc.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (isExternalUrl(href)) setPendingLink(href);
    });
    // A new page is ready: run the search again on it.
    setFrameLoads((count) => count + 1);
  }, []);

  // Source mode: a read-only CodeMirror with Markdown colors.
  useEffect(() => {
    if (settings.mode !== "source" || source === null || !sourceHost.current) return;
    const view = new EditorView({
      parent: sourceHost.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          readOnlyExtensions({ phrases: { "current match": t("text.cm.currentMatch"), "on line": t("text.cm.onLine") } }),
          lineNumbers(),
          EditorView.lineWrapping,
        ],
      }),
    });
    editorRef.current = view;
    void loadLanguage("markdown").then((language) => {
      if (editorRef.current === view) view.dispatch({ effects: StateEffect.appendConfig.of(language) });
    });
    return () => {
      view.destroy();
      if (editorRef.current === view) editorRef.current = null;
    };
    // The editor is rebuilt when the mode or the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, source]);

  // The file tab's search box, in both modes. A new search text starts at
  // the first match; Enter and F3 move; a rebuilt page keeps the match.
  const lastFind = useRef({ request: find.request, text: find.text });
  useEffect(() => {
    const moved = find.request !== lastFind.current.request;
    const retyped = find.text !== lastFind.current.text;
    lastFind.current = { request: find.request, text: find.text };
    if (settings.mode === "source") {
      if (editorRef.current) runFind(editorRef.current, find.text, moved ? (find.backwards ? "previous" : "next") : "here");
      return;
    }
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    if (moved) matchIndex.current += find.backwards ? -1 : 1;
    else if (retyped) matchIndex.current = 0;
    setMatches(findInPage(doc, find.text, matchIndex.current).count);
  }, [find.text, find.request, find.backwards, settings.mode, frameLoads]);

  useEffect(() => {
    const items = [t(settings.mode === "rendered" ? "markdown.renderedMode" : "markdown.sourceMode"), formatSize(info.size, i18n.language)];
    if (find.text !== "" && settings.mode === "rendered") items.unshift(t("viewer.matches", { count: matches }));
    onStatus({ items });
  }, [settings.mode, info.size, i18n.language, find.text, matches, onStatus, t]);

  const ctx: MarkdownCtx = { mode: settings.mode, zoom: settings.zoom };
  const commands = useMemo<Command<MarkdownCtx>[]>(
    () => [
      { id: "markdown.rendered", labelKey: "markdown.renderedMode", icon: BookOpen, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "rendered", enabledWhen: () => true, run: () => update({ mode: "rendered" }) },
      { id: "markdown.source", labelKey: "markdown.sourceMode", icon: Code, risk: "read-only", helpSlug: "viewing-markdown", checkKind: "radio", checkedWhen: (c) => c.mode === "source", enabledWhen: () => true, run: () => update({ mode: "source" }) },
      { id: "markdown.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom < 3, run: (c) => update({ zoom: Math.min(3, Math.round(c.zoom * 11) / 10) }) },
      { id: "markdown.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom > 0.5, run: (c) => update({ zoom: Math.max(0.5, Math.round((c.zoom / 1.1) * 10) / 10) }) },
      { id: "markdown.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-markdown", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
    ],
    [update],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "mode",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "markdown.rendered", keyTip: "D" },
              { type: "toggle", command: "markdown.source", keyTip: "C" },
            ],
          },
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "markdown.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "markdown.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "markdown.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("text.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : null}
      {!failed && settings.mode === "rendered" ? (
        <iframe ref={frameRef} className="adp-markdown-frame" sandbox="allow-same-origin" srcDoc={page} title={info.name} onLoad={attachFrame} />
      ) : null}
      {!failed && settings.mode === "source" ? <div ref={sourceHost} className="adp-text-host" /> : null}
      {pendingLink ? (
        <Dialog title={t("links.openTitle")} onClose={() => setPendingLink(null)}>
          <p className="adp-dialog-text">{t("links.openBody")}</p>
          <p className="adp-dialog-text adp-link-preview">{pendingLink}</p>
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              onClick={() => {
                const link = pendingLink;
                setPendingLink(null);
                void openExternalUrl(link).catch(() => undefined);
              }}
            >
              {t("links.open")}
            </Button>
            <Button onClick={() => setPendingLink(null)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </ViewerFrame>
  );
}
```

Create `src/handlers/markdown/index.ts`:

```ts
import { BookOpen } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Markdown, shown rendered or as source (Step 04b). Bigger files open in
 * the text viewer instead. */
export const markdownHandler: Handler = {
  id: "markdown",
  version: 1,
  labelKey: "handlers.markdown",
  icon: BookOpen,
  accent: "explorer",
  extensions: ["md", "markdown", "mdown", "mkd"],
  mimeTypes: ["text/markdown"],
  maxBytes: 5 * 1024 * 1024,
  helpSlug: "viewing-markdown",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./MarkdownView")),
};
```

Create `src/__tests__/markdownRender.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdownPage, type DocColors } from "../handlers/markdown/render";

const colors: DocColors = {
  text: "#202020",
  muted: "#616161",
  background: "#ffffff",
  border: "#e0e0e0",
  link: "#0067c0",
  codeBackground: "#fafafa",
  mark: "rgba(255, 223, 93, 0.5)",
  markCurrent: "rgba(255, 159, 67, 0.6)",
};

describe("Markdown rendering", () => {
  it("renders headings, lists, code and tables", () => {
    const page = renderMarkdownPage("# Title\n\n- one\n- two\n\n`code`\n\n| a | b |\n|---|---|\n| 1 | 2 |", colors, 1, "en");
    expect(page).toContain("<h1>Title</h1>");
    expect(page).toContain("<li>one</li>");
    expect(page).toContain("<code>code</code>");
    expect(page).toContain("<table>");
  });

  it("never lets HTML or scripts from the file through", () => {
    const page = renderMarkdownPage('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))', colors, 1, "en");
    // The HTML is shown as text, never as tags.
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
    expect(page).not.toMatch(/<img[^>]*onerror/);
    expect(page).not.toContain('href="javascript:');
  });

  it("refuses colors that could break out of the style sheet", () => {
    const page = renderMarkdownPage("x", { ...colors, text: "red;}</style><script>bad()</script>" }, 1, "en");
    expect(page).not.toContain("<script>bad()");
    expect(page).toContain("color: #202020");
  });

  it("scales the font with the zoom", () => {
    expect(renderMarkdownPage("x", colors, 2, "es")).toContain("font: 30px/1.6");
  });
});
```

Create `src/__tests__/openPipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHandlerRegistry } from "../handlers";
import { decideOpen } from "../handlers/openPipeline";
import type { FileTypeInfo } from "../services/files";

const info = (name: string, mime: string, size = 1000): FileTypeInfo => ({
  path: `C:\\${name}`,
  name,
  ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
  mime,
  size,
  modified_unix: 0,
  online_only: false,
  read_only: false,
});

describe("open pipeline (Step 04b)", () => {
  const registry = createHandlerRegistry();

  it("opens text, code, logs and Markdown in the app", () => {
    expect(decideOpen(info("notes.txt", "text/plain"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("main.rs", "application/octet-stream"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("README", "text/plain"), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
    expect(decideOpen(info("guide.md", "text/markdown"), registry)).toMatchObject({ kind: "tab", handler: { id: "markdown" } });
  });

  it("sends big Markdown files to the text viewer", () => {
    expect(decideOpen(info("huge.md", "text/markdown", 6 * 1024 * 1024), registry)).toMatchObject({ kind: "tab", handler: { id: "text" } });
  });

  it("always opens programs, shortcuts and web pages in Windows", () => {
    for (const name of ["setup.exe", "link.url", "page.html", "install.msi", "app.lnk"]) {
      expect(decideOpen(info(name, "text/plain"), registry).kind).toBe("windows");
    }
  });
});
```

Create `help/en/viewing-markdown.md`:

```markdown
# Viewing Markdown

Markdown files (.md) open in a tab in **Reading view**: headings, lists, tables, links and code look like a formatted page.

## Reading view and source

- **View** > **Reading view** shows the formatted page. **View** > **Source** shows the text the page is made from, with colors.
- **Ctrl++**, **Ctrl+-** and **Ctrl+0** change the text size.
- Use the search box (or **Ctrl+F**) to find text in either view; **Enter** goes to the next match and **Shift+Enter** to the previous one.

## Links

Clicking a web or email link asks first, then opens it in your browser or mail app. Other links do nothing.

## Good to know

- For your safety, the page never runs code from the file and never loads pictures or anything else from the internet. HTML written inside the file is shown as text.
- Pictures stored next to the file are not shown in Reading view yet.
- Markdown files bigger than 5 MB open as text.

See also: "Viewing text and code".
```

Create `help/es/viewing-markdown.md`:

```markdown
# Ver Markdown

Los archivos Markdown (.md) se abren en una pestaña en **Vista de lectura**: los títulos, las listas, las tablas, los vínculos y el código se ven como una página con formato.

## Vista de lectura y código fuente

- **Vista** > **Vista de lectura** muestra la página con formato. **Vista** > **Código fuente** muestra el texto con el que está hecha la página, con colores.
- **Ctrl++**, **Ctrl+-** y **Ctrl+0** cambian el tamaño del texto.
- Usa el cuadro de búsqueda (o **Ctrl+F**) para buscar texto en cualquiera de las dos vistas; **Entrar** va a la siguiente coincidencia y **Mayús+Entrar** a la anterior.

## Vínculos

Al hacer clic en un vínculo web o de correo, primero se te pregunta y luego se abre en tu navegador o en tu aplicación de correo. Los demás vínculos no hacen nada.

## Para tener en cuenta

- Por tu seguridad, la página nunca ejecuta código del archivo ni carga imágenes u otro contenido de Internet. El HTML escrito dentro del archivo se muestra como texto.
- Las imágenes guardadas junto al archivo todavía no se muestran en la Vista de lectura.
- Los archivos Markdown de más de 5 MB se abren como texto.

Consulta también: «Ver texto y código».
```

In `src/handlers/index.ts`, find exactly:

```ts
import { imageHandler } from "./image";
import { HandlerRegistry } from "./registry";
```

Replace with:

```ts
import { imageHandler } from "./image";
import { markdownHandler } from "./markdown";
import { HandlerRegistry } from "./registry";
```

In `src/handlers/index.ts`, find exactly:

```ts
  registry.register(imageHandler);
  registry.register(textHandler);
```

Replace with:

```ts
  registry.register(imageHandler);
  // Markdown before text: ties on ".md" go to the Markdown viewer.
  registry.register(markdownHandler);
  registry.register(textHandler);
```

Add these keys to `src/i18n/locales/en.json` and `src/i18n/locales/es.json` (`plan/recipes/add-translation-keys.md`), then run `npm run i18n:pseudo`:

| Key | English | Spanish |
|---|---|---|
| `handlers.markdown` | Markdown | Markdown |
| `markdown.renderedMode` | Reading view | Vista de lectura |
| `markdown.sourceMode` | Source | Código fuente |
| `links.openTitle` | Open this link? | ¿Abrir este vínculo? |
| `links.openBody` | It opens in your web browser or mail app: | Se abrirá en tu navegador web o en tu aplicación de correo: |
| `links.open` | Open link | Abrir vínculo |

**Tests:** `markdownRender.test.ts`, `openPipeline.test.ts` (text, code, logs and Markdown open in the app; big Markdown files go to the text viewer; programs, shortcuts and web pages always open in Windows).

**Commit:** `feat(viewer): Markdown viewer with reading view, source view and safe links [step-04b/T9]`

### T10 - Speed measurements and screenshots

**Files:** modify `scripts/measure-ui.mjs`.

In `scripts/measure-ui.mjs`, find exactly:

```js
/** A real PNG (a color gradient), so "open image" measures a real decode. */
```

Replace with:

````js
/** Text samples for the 04b measurements: a 5 MB log and a Markdown page. */
function writeTextSamples(folder) {
  const lines = [];
  for (let index = 0; lines.join("\n").length < 5 * 1024 * 1024; index += 1000) {
    for (let line = index; line < index + 1000; line += 1) {
      lines.push(`2026-10-28 12:00:${String(line % 60).padStart(2, "0")} INFO  worker-${line % 8} processed item ${line} in ${line % 97} ms`);
    }
  }
  writeFileSync(join(folder, "server-5mb.log"), lines.join("\r\n"));
  writeFileSync(
    join(folder, "guide.md"),
    ["# Project guide", "", "Some **bold** text and a [link](https://example.com).", "", "## Steps", "", "1. One", "2. Two", "", "| Name | Size |", "|---|---|", "| a | 1 |", "", "```js", "const x = 1;", "```"].join("\n"),
  );
}

/** A real PNG (a color gradient), so "open image" measures a real decode. */
````

In `scripts/measure-ui.mjs`, find exactly:

```js
writeGradientPng(join(demo, "photo-1920.png"), 1920, 1080);
```

Replace with:

```js
writeGradientPng(join(demo, "photo-1920.png"), 1920, 1080);
writeTextSamples(demo);
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  // Classic menu: time until the helper's menu is on screen. The runner
```

Replace with:

```js
  // Step 04b: open a 5 MB log in the text viewer, and a Markdown page.
  try {
    await openFolder(demo);
    const firstView = async (name, fileName, done) => {
      const values = [];
      for (let run = 0; run < 5; run += 1) {
        values.push(
          await page(`window.__m.timeUntil(
            () => [...window.__m.rows()].find((r) => r.textContent.includes(${JSON.stringify(fileName)})).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
            () => (${done})())`),
        );
        await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
        await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
        await sleep(200);
      }
      const result = { name, median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
      console.log(`${name}: median ${result.median_ms} ms (max ${result.max_ms})`);
      results.push(result);
    };
    await firstView(
      "open a 5 MB log in the text viewer (first view)",
      "server-5mb.log",
      `() => (document.querySelector(".adp-filetab:not([hidden]) .cm-content")?.textContent ?? "").includes("processed item")`,
    );
    await firstView(
      "open a Markdown file (first view)",
      "guide.md",
      `() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null`,
    );
  } catch (error) {
    console.log(`step 04b measurements failed: ${error.message ?? error}`);
  }

  // Classic menu: time until the helper's menu is on screen. The runner
```

In `scripts/measure-ui.mjs`, find exactly:

```js
    step: "04a",
```

Replace with:

```js
    step: "04b",
```

In `scripts/measure-ui.mjs`, find exactly:

```js
  await shot("12-image-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
```

Replace with:

```js
  await shot("12-image-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  // Step 04b: the text viewer with its ribbon, and a Markdown page.
  await openFolder(demo);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("server-5mb.log"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => (document.querySelector(".adp-filetab:not([hidden]) .cm-content")?.textContent ?? "").includes("processed item"), 15000)`);
  await sleep(300);
  await shot("13-text-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("guide.md"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null, 15000)`);
  await sleep(300);
  await shot("14-markdown-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
```

Check: `node --check scripts/measure-ui.mjs` prints nothing.

**Commit:** `test(bench): measure opening a 5 MB log and a Markdown file [step-04b/T10]`

## Check by hand

The owner does these checks in the packaged app (`.\scripts\gate.ps1 -Package`, then `build\Adperastra\Adperastra.exe`). Before telling the owner the step is ready, create the test files with these PowerShell commands (they go to your Temp folder):

```powershell
$dir = Join-Path $env:TEMP "adperastra-04b"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path "$dir\notes.txt" -Value @("First line", "Second line with a word to find", "Third line, word again") -Encoding utf8
Set-Content -Path "$dir\README" -Value @("Read me first.", "This file has no extension.") -Encoding utf8
[IO.File]::WriteAllBytes("$dir\accents-1252.txt", [byte[]](0x43,0x61,0x6E,0x63,0x69,0xF3,0x6E,0x2C,0x20,0x61,0xF1,0x6F,0x2C,0x20,0x63,0x61,0x66,0xE9,0x0D,0x0A))
Set-Content -Path "$dir\safety-test.md" -Value @("# Safety test", "", "Some **bold** text.", "", "<script>alert(1)</script>", "", "![remote picture](https://example.com/x.png)", "", "[web link](https://example.com)", "", "[local file](file:///C:/Windows/notepad.exe)") -Encoding utf8
Set-Content -Path "$dir\hello.bat" -Value @("@echo Hello from a script", "@pause") -Encoding ascii
Set-Content -Path "$dir\page.html" -Value "<h1>Hello</h1>" -Encoding utf8
Copy-Item -Path "src\App.tsx" -Destination "$dir\App.tsx"
$line = "2026-10-29 12:00:00 INFO worker processed an item in 42 ms, line"
[IO.File]::WriteAllLines("$dir\big-50mb.log", [string[]](1..800000 | ForEach-Object { "$line $_" }))
```

Then open the folder `%TEMP%\adperastra-04b` in Adperastra and check:

1. Double-click `notes.txt`: it opens in a tab with line numbers. The status bar shows "Ln 1, Col 1", "4 lines" (the empty line after the last line break counts), "UTF-8", "Windows (CRLF)" and the size.
2. Double-click `App.tsx`: code colors. Switch to the dark theme: the colors are easy to read.
3. In `notes.txt` press Ctrl+F: the search box at the top right is focused. Type `word`: the first "word" is selected and all are highlighted. Enter and F3 go to the next one; Shift+F3 to the previous one; Esc clears the search.
4. View > Word wrap and Line numbers turn on and off. Ctrl+= and Ctrl+- change the text size; Ctrl+0 resets it. Close and start the app again: the tab comes back with the same settings.
5. Type letters, press Delete, and paste in the text: nothing changes. Ctrl+A then Ctrl+C copies the text.
6. `accents-1252.txt` shows "Canción, año, café" and the status bar says Windows-1252. Choose UTF-8 in View > Encoding: the accents break. Choose Windows-1252 again: they are back.
7. `big-50mb.log` (about 56 MB) opens at once with the note "This file is large...". Next part (or Alt+Page Down) moves on and the status bar says "Part 2 of 56". Previous part (or Alt+Page Up) goes back.
8. `README` opens as text.
9. `safety-test.md` opens as a formatted page: "<script>alert(1)</script>" shows as text, nothing pops up, and no picture loads. View > Source shows the colored source; View > Reading view goes back.
10. In the reading view click "web link": a dialog shows the address; Cancel does nothing; Open link opens the browser. The "local file" line is plain text, not a link.
11. Ctrl+F and type `text` in the Markdown tab: the match is highlighted and the status bar shows "1 match". Ctrl+= makes the page bigger without jumping back to the top.
12. Hold Alt in a text tab: letters appear on the ribbon; Alt+W turns word wrap on or off. In a picture tab, Alt+R turns the picture right.
13. Picture tab: Rotate left and Rotate right turn the picture; Actual size shows 100 %; Fit fits it again. Restart the app: the rotation is kept.
14. Double-click `page.html`: it opens in the browser. Double-click `hello.bat`: it opens as text (nothing runs). Right-click `hello.bat` > Open in Windows app: a console window says "Hello from a script".
15. Spanish and dark theme: repeat 1, 3, 9 and 12.

## Speed

| Interaction | Tier | How |
|---|---|---|
| Open a 5 MB log in the text viewer (first view) | Fast (1 s) | `scripts\measure-ui.ps1`, row "open a 5 MB log in the text viewer (first view)" |
| Open a Markdown file (first view) | Fast (1 s) | row "open a Markdown file (first view)" |
| Earlier rows (selection, menus, folder open, image tab) | as before | must not be more than 20 % slower than `docs/benchmarks/<date>-ui-step04a.json` |

## Screenshots

`13-text-tab` and `14-markdown-tab` (new) plus all earlier ones, in English light, Spanish dark and the pseudo-locale, into `docs/screenshots/step-04b/`.

## Done when

- [ ] `.\scripts\gate.ps1 -Package` prints `GATE PASSED`.
- [ ] The owner has done every "Check by hand" item, in English light and Spanish dark, and all pass.
- [ ] The speed table is met and saved as `docs/benchmarks/<date>-ui-step04b.json`.
- [ ] Screenshots are in `docs/screenshots/step-04b/`.
- [ ] `docs/step-reports/step-04b.md`, `CHANGELOG.md` (Unreleased: "Text, code and Markdown viewers; ribbons in file tabs"), `KNOWN_ISSUES.md` and `plan/STATUS.md` are updated.
