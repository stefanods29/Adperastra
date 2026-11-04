import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import { resolveShortcutText, useShortcutResolutionHost } from "../keyboard/shortcutDisplay";
import { formatShortcut } from "../services/shortcuts";
import { folderViewKey } from "../services/folderViews";
import { matchPalette, paletteLabel } from "./matchPalette";
import type { PaletteRegistry } from "./PaletteRegistry";
import type { PaletteHost } from "./types";
import type { PaletteMatch } from "./types";
import { usePaletteCatalog } from "./usePaletteCatalog";

export interface CommandPaletteProps {
  registry: PaletteRegistry;
  host: PaletteHost;
  locale: string;
  recentIds: readonly string[];
  onUsed: (id: string) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}
export function CommandPalette({ registry, host, locale, recentIds, onUsed, onClose, onOpenHelp }: CommandPaletteProps) {
  const { t } = useTranslation();
  const shortcutHost = useShortcutResolutionHost();
  const catalog = usePaletteCatalog(registry, locale);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [dispatchError, setDispatchError] = useState(false);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true), dispatching = useRef(false);
  const id = useId();
  const explicitPath = /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/iu.test(query) && !query.includes("\0") ? query : null;
  const matches = useMemo(() => {
    const found = matchPalette(query, catalog.entries, recentIds, locale);
    if (!explicitPath) return found;
    const pathId = `folder:${folderViewKey(explicitPath)}`;
    const pathMatch: PaletteMatch = { entry: { id: pathId, kind: "folder", label_key: "palette.openPath", english_label: "", description: explicitPath, keywords: [], enabled: true, target_id: explicitPath }, score: 0, matched_ranges: [] };
    return [...found.filter((match) => match.entry.id !== pathId).slice(0, 49), pathMatch];
  }, [query, catalog.entries, recentIds, locale, explicitPath]);
  const active = matches[Math.min(selected, Math.max(0, matches.length - 1))];
  const activeIndex = active ? matches.indexOf(active) : -1;
  const virtualizer = useVirtualizer({ count: matches.length, getScrollElement: () => scrollRef.current, estimateSize: () => 40, overscan: 3,
    rangeExtractor: (range) => {
      const start = Math.max(0, range.startIndex - range.overscan), end = Math.min(range.count - 1, range.endIndex + range.overscan);
      return [...new Set([...Array.from({ length: end - start + 1 }, (_, index) => start + index), ...(activeIndex >= 0 ? [activeIndex] : [])])].sort((a, b) => a - b);
    },
  });
  useEffect(() => { setSelected(0); setDispatchError(false); }, [query, catalog.entries]);
  useEffect(() => {
    const input = bodyRef.current?.querySelector<HTMLInputElement>("input");
    input?.setAttribute("role", "combobox");
    input?.setAttribute("aria-haspopup", "listbox");
    input?.setAttribute("aria-expanded", "true");
    input?.setAttribute("aria-autocomplete", "list");
    input?.setAttribute("aria-controls", `${id}-list`);
    if (active) input?.setAttribute("aria-activedescendant", `${id}-${activeIndex}`);
    else input?.removeAttribute("aria-activedescendant");
  }, [active, activeIndex, id]);
  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement as HTMLElement | null;
    const input = bodyRef.current?.querySelector<HTMLInputElement>("input");
    const dialog = bodyRef.current?.closest('[role="dialog"]');
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Node && !dialog?.contains(event.target)) input?.focus(); };
    const inert: { element: HTMLElement; value: boolean }[] = [];
    let branch: HTMLElement | null = bodyRef.current?.closest<HTMLElement>(".adp-dialog-overlay") ?? null;
    while (branch?.parentElement && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) { inert.push({ element: sibling, value: sibling.inert }); sibling.inert = true; }
      }
      branch = branch.parentElement;
    }
    input?.focus();
    document.addEventListener("focusin", onFocus);
    return () => {
      alive.current = false;
      document.removeEventListener("focusin", onFocus);
      for (const { element, value } of inert) element.inert = value;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const activate = async (match = active) => {
    if (!match || !match.entry.enabled || dispatching.current) return;
    dispatching.current = true; setBusy(true); setDispatchError(false);
    try {
      if (explicitPath && match.entry.target_id === explicitPath && match.entry.label_key === "palette.openPath") await host.openFolder(explicitPath);
      else await registry.dispatch(match.entry.id, host);
      // The host excludes sensitive/locked sources from the catalog.
      onUsed(match.entry.id);
      if (alive.current) onClose();
    } catch {
      if (alive.current) setDispatchError(true);
    } finally {
      dispatching.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "F1") { event.preventDefault(); onOpenHelp("command-palette"); return; }
    if (event.key === "Tab") {
      const dialog = bodyRef.current?.closest('[role="dialog"]');
      const nodes = Array.from(dialog?.querySelectorAll<HTMLElement>('input,button:not(:disabled),[tabindex="0"]') ?? []);
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === nodes.length - 1))) {
        event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0].focus();
      }
      return;
    }
    if (!(event.target instanceof HTMLInputElement) || event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); void activate(); return; }
    const moves: Record<string, number> = { ArrowDown: selected + 1, ArrowUp: selected - 1, PageDown: selected + 10, PageUp: selected - 10, Home: 0, End: matches.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(matches.length - 1, moves[event.key]));
    setSelected(next); virtualizer.scrollToIndex(next, { align: "auto" });
  };
  return <Dialog title={t("palette.title")} onClose={onClose} className="adp-command-palette">
    <div ref={bodyRef} onKeyDown={onKeyDown} aria-busy={busy || catalog.loading}>
      <SearchBox value={query} onChange={(value) => setQuery([...value].slice(0, 256).join(""))} placeholder={t("palette.search")} />
      {catalog.loading ? <Skeleton count={3} /> : null}
      {catalog.loading && catalog.slow ? <p role="status">{t("components.loading")}</p> : null}
      {catalog.error || dispatchError ? <p role="alert">{t(catalog.error ?? "errors.palette.unavailable")}</p> : null}
      {!catalog.loading && !catalog.error && !matches.length ? <p role="status">{t("palette.empty")}</p> : null}
      <div ref={scrollRef} id={`${id}-list`} role="listbox" aria-label={t("palette.title")} className="adp-palette-list">
        <div className="adp-palette-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const match = matches[row.index];
            if (!match) return null;
            const entry = match.entry;
            const reason = entry.enabled ? undefined : t(entry.disabled_reason_key ?? "palette.disabled", { label: paletteLabel(entry, locale) });
            const shortcutText = entry.kind === "command" ? resolveShortcutText(shortcutHost, entry.target_id, entry.shortcut) : entry.shortcut;
            return <div key={entry.id} id={`${id}-${row.index}`} role="option" aria-selected={row.index === activeIndex} aria-disabled={!entry.enabled}
              aria-describedby={reason ? `${id}-reason-${row.index}` : undefined} className="adp-palette-row"
              style={{ transform: `translateY(${row.start}px)` }} title={reason ?? entry.description}
              onPointerMove={() => setSelected(row.index)} onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setSelected(row.index); void activate(match); }}>
              <span className="adp-palette-label">{paletteLabel(entry, locale)}</span>
              {entry.description ? <span className="adp-palette-description">{entry.description}</span> : null}
              {shortcutText ? <kbd>{formatShortcut(shortcutText, t)}</kbd> : null}
              {reason ? <span id={`${id}-reason-${row.index}`} className="adp-palette-reason">{reason}</span> : null}
            </div>;
          })}
        </div>
      </div>
      <HelpButton onOpenHelp={() => onOpenHelp("command-palette")} />
    </div>
  </Dialog>;
}
export default CommandPalette;
