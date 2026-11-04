import { useVirtualizer } from "@tanstack/react-virtual";
import { RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import IconButton from "../components/IconButton";
import Menu, { type MenuAnchor } from "../components/Menu";
import Skeleton from "../components/Skeleton";
import { errorCode, errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import {
  refreshShelf,
  type ShelfActionId,
  type ShelfCatalog,
  type ShelfItem,
  type ShelfPatch,
} from "../services/shelf";
import {
  createShelfCommands,
  SHELF_ACTION_BUTTONS,
  SHELF_MENU,
  startShelfDragOut,
  type ShelfCommandContext,
} from "./shelfActions";
import { useShelfWatcher } from "./shelfRefresh";
import ShelfRow, { SHELF_ROW_HEIGHT } from "./ShelfRow";
import { useShelfDrop } from "./useShelfDrop";

/** The dockable shelf (Step 09g E5). It lists references only; every
 * action opens its normal review UI through `onAction`, and removing or
 * clearing references never touches the referenced files. */
export interface ShelfPanelProps {
  catalog: ShelfCatalog;
  active: boolean;
  onPatch: (patch: ShelfPatch) => Promise<void>;
  onAction: (id: ShelfActionId, ids: readonly string[]) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

export default function ShelfPanel({
  catalog,
  active,
  onPatch,
  onAction,
  onOpen,
  onOpenHelp,
}: ShelfPanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ShelfItem[]>(catalog.items);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [menuAt, setMenuAt] = useState<MenuAnchor | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jobRef = useRef<JobHandle<ShelfCatalog> | null>(null);
  const generationRef = useRef(0);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    setItems(catalog.items);
    setSelected((current) => {
      const live = new Set(catalog.items.map((item) => item.id));
      return new Set([...current].filter((id) => live.has(id)));
    });
  }, [catalog]);

  const runRefresh = useCallback(async (ids: readonly string[]) => {
    generationRef.current += 1;
    const generation = generationRef.current;
    void jobRef.current?.cancel();
    setLoading(true);
    setShowSkeleton(false);
    const timer = window.setTimeout(() => {
      if (generationRef.current === generation) setShowSkeleton(true);
    }, 100);
    try {
      const job = await refreshShelf(ids);
      if (generationRef.current !== generation) {
        await job.cancel();
        return;
      }
      jobRef.current = job;
      const next = await job.completion;
      if (generationRef.current !== generation) return;
      setItems((current) => [
        ...next.items,
        ...current.filter((item) => item.runtime_sensitive),
      ]);
      setError(null);
    } catch (caught) {
      if (generationRef.current !== generation) return;
      if (errorCode(caught) !== "shelf.cancelled") setError(caught);
    } finally {
      window.clearTimeout(timer);
      if (generationRef.current === generation) {
        setLoading(false);
        setShowSkeleton(false);
        jobRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      generationRef.current += 1;
      void jobRef.current?.cancel();
      setLoading(false);
      setShowSkeleton(false);
      return;
    }
    void runRefresh(itemsRef.current.map((item) => item.id));
    return () => {
      generationRef.current += 1;
      void jobRef.current?.cancel();
    };
  }, [active, runRefresh]);

  const onExternalChange = useCallback(
    (ids: readonly string[]) => {
      if (ids.length > 0) void runRefresh(ids);
    },
    [runRefresh],
  );
  useShelfWatcher(items, active, onExternalChange);

  const handleDrop = useCallback(
    async (paths: readonly string[]) => {
      try {
        await onPatch({
          kind: "add",
          sources: paths.map((path) => ({ kind: "disk" as const, path })),
        });
        setError(null);
      } catch (caught) {
        setError(caught);
      }
    },
    [onPatch],
  );
  const { dropActive } = useShelfDrop(active, handleDrop);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SHELF_ROW_HEIGHT,
    overscan: 6,
    getItemKey: (index) => items[index]?.id ?? index,
  });

  const selectedIds = useMemo(
    () => items.filter((item) => selected.has(item.id)).map((item) => item.id),
    [items, selected],
  );
  const selectionCount = selectedIds.length;

  const hasAvailableDisk = useMemo(
    () =>
      items.some(
        (item) =>
          selected.has(item.id) &&
          item.source.kind === "disk" &&
          item.state === "available",
      ),
    [items, selected],
  );
  const hasAnySelected = selectionCount > 0;

  const toggle = useCallback(
    (id: string, additive: boolean, range: boolean) => {
      setSelected((current) => {
        if (range) {
          const anchor = Math.max(
            0,
            items.findIndex((item) => current.has(item.id)),
          );
          const target = items.findIndex((item) => item.id === id);
          if (target < 0) return current;
          const next = additive ? new Set(current) : new Set<string>();
          for (
            let index = Math.min(anchor, target);
            index <= Math.max(anchor, target);
            index += 1
          ) {
            next.add(items[index].id);
          }
          return next;
        }
        if (additive) {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return current.size === 1 && current.has(id) ? new Set() : new Set([id]);
      });
    },
    [items],
  );

  const focusRow = useCallback(
    (index: number) => {
      if (items.length === 0) return;
      const next = Math.max(0, Math.min(items.length - 1, index));
      setFocusIndex(next);
      virtualizer.scrollToIndex(next, { align: "auto" });
      window.requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-shelf-row="${next}"]`)
          ?.focus();
      });
    },
    [items.length, virtualizer],
  );

  const openMenuAt = useCallback((index: number, x: number, y: number) => {
    const item = items[index];
    if (!item) return;
    setFocusIndex(index);
    setSelected((current) =>
      current.has(item.id) ? current : new Set([item.id]),
    );
    setMenuAt({ kind: "point", x, y });
  }, [items]);

  const dragOut = useCallback(
    (id: string) => {
      const ids = selected.has(id) ? selectedIds : [id];
      void startShelfDragOut(items.filter((entry) => ids.includes(entry.id))).catch(
        setActionError,
      );
    },
    [items, selected, selectedIds],
  );

  const runFromMenu = useCallback(
    (id: ShelfActionId | "remove" | "clear") => {
      if (id === "clear") {
        setConfirmClear(true);
        return;
      }
      if (id === "remove") {
        if (selectedIds.length === 0) return;
        void onPatch({ kind: "remove", ids: selectedIds }).catch(setActionError);
        return;
      }
      void onAction(id, selectedIds).catch(setActionError);
    },
    [onAction, onPatch, selectedIds],
  );

  const commandContext: ShelfCommandContext = {
    selectionCount,
    run: runFromMenu,
  };
  const commands = useMemo(createShelfCommands, []);
  const lookup = useMemo(() => {
    const byId = new Map(commands.map((command) => [command.id, command]));
    return (id: string) => byId.get(id);
  }, [commands]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target as Element).closest?.("[data-shelf-row]")) {
      return;
    }
    if ((event.target as Element).closest?.(".adp-shelf-check")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(focusIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(focusIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(items.length - 1);
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      const item = items[focusIndex];
      if (item) toggle(item.id, event.ctrlKey, event.shiftKey);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[focusIndex];
      if (item) void onOpen(item.id).catch(setActionError);
    } else if (event.key === "F10" && event.shiftKey) {
      event.preventDefault();
      const row = scrollRef.current?.querySelector<HTMLElement>(
        `[data-shelf-row="${focusIndex}"]`,
      );
      const rect = row?.getBoundingClientRect();
      if (rect) openMenuAt(focusIndex, rect.left + 12, rect.bottom + 4);
    } else if (event.key === "a" && event.ctrlKey) {
      event.preventDefault();
      setSelected(new Set(items.map((item) => item.id)));
    }
  };

  return (
    <aside
      className="adp-shelf"
      data-shelf-drop=""
      aria-label={t("shelf.title")}
    >
      <header className="adp-shelf-header">
        <h2 className="adp-shelf-title">{t("shelf.title")}</h2>
        <HelpButton onOpenHelp={() => onOpenHelp("the-shelf")} />
        <IconButton
          icon={RefreshCw}
          labelKey="shelf.refresh"
          onClick={() => void runRefresh(itemsRef.current.map((item) => item.id))}
          disabled={loading}
        />
        <IconButton
          icon={Trash2}
          labelKey="shelf.clear"
          onClick={() => setConfirmClear(true)}
          disabled={items.length === 0}
        />
      </header>
      <div className="adp-shelf-actions" role="toolbar" aria-label={t("shelf.title")}>
        {SHELF_ACTION_BUTTONS.map((action) => (
          <IconButton
            key={action.id}
            icon={action.icon}
            labelKey={action.labelKey}
            onClick={() => void onAction(action.id, selectedIds).catch(setActionError)}
            disabled={
              !hasAnySelected ||
              (action.id === "open_group" ? false : !hasAvailableDisk)
            }
          />
        ))}
      </div>
      {error ? (
        <div className="adp-shelf-error" role="alert">
          <span>{errorText(t, error, "shelf")}</span>
          <Button onClick={() => void runRefresh(itemsRef.current.map((item) => item.id))}>
            {t("shelf.refresh")}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <div className="adp-shelf-error" role="alert">
          {errorText(t, actionError, "shelf")}
        </div>
      ) : null}
      {dropActive ? (
        <div className="adp-shelf-drop" role="status">
          {t("shelf.add")}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="adp-shelf-scroll"
        role="listbox"
        aria-multiselectable="true"
        aria-label={t("shelf.title")}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {showSkeleton && items.length === 0 ? <Skeleton variant="rows" count={4} /> : null}
        {!loading && items.length === 0 ? (
          <p className="adp-shelf-empty">{t("shelf.empty")}</p>
        ) : null}
        {items.length > 0 ? (
          <div className="adp-shelf-rows" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <ShelfRow
                  key={item.id}
                  item={item}
                  index={virtualRow.index}
                  start={virtualRow.start}
                  selected={selected.has(item.id)}
                  focused={focusIndex === virtualRow.index}
                  active={active}
                  onFocus={() => setFocusIndex(virtualRow.index)}
                  onToggle={toggle}
                  onOpen={(id) => void onOpen(id).catch(setActionError)}
                  onContext={openMenuAt}
                  onDragOut={dragOut}
                />
              );
            })}
          </div>
        ) : null}
      </div>
      {menuAt ? (
        <Menu
          entries={SHELF_MENU}
          ctx={commandContext}
          lookup={lookup}
          anchor={menuAt}
          ariaLabel={t("shelf.title")}
          onRun={(command) => command.run(commandContext)}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
      {confirmClear ? (
        <Dialog title={t("shelf.clear")} onClose={() => setConfirmClear(false)}>
          <p>{t("shelf.clearConfirm")}</p>
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={() => {
              setConfirmClear(false);
              void onPatch({ kind: "clear" }).catch(setActionError);
            }}>
              {t("shelf.clear")}
            </Button>
            <Button onClick={() => setConfirmClear(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
      {items.length > 0 && selectionCount > 0 ? (
        <span className="adp-shelf-selection" aria-live="polite">
          {t("explorer.statusSelected", { count: selectionCount })}
        </span>
      ) : null}
    </aside>
  );
}
