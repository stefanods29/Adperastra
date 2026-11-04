import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ClipboardPaste,
  FileText,
  Files,
  History,
  Image as ImageIcon,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import { releaseTransfer } from "../services/contentTransfer";
import {
  isUuid,
  listClipboardHistory,
  listenClipboardHistoryChanged,
  patchClipboardHistory,
  resolveClipboardHistory,
  type ClipboardHistoryItem,
  type ClipboardHistoryPage,
} from "../services/clipboardHistory";
import { errorCode, errorText } from "../services/errors";
import { formatDate } from "../services/format";
import type { TransferEnvelope } from "../transfer/types";

/** Clipboard-history panel (Step 09j E4). Selecting a row is only a
 * preview: nothing is resolved or pasted until the Paste button or Enter.
 * The target decides whether it accepts the transfer, so a read-only
 * target fails without changing this history. */
export interface ClipboardHistoryPanelProps {
  targetId: string | null;
  onPaste: (envelope: TransferEnvelope) => Promise<void>;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

export type PasteSpecialScope = "editor" | "history";

/** Ctrl+Shift+V follows focus: inside an editor it is the editor's Paste
 * Special, which exposes the history button; elsewhere it opens history. */
export function choosePasteSpecial(editorFocused: boolean): PasteSpecialScope {
  return editorFocused ? "editor" : "history";
}

type Confirmation =
  | { kind: "remove"; id: string }
  | { kind: "clear" }
  | null;

export default function ClipboardHistoryPanel({
  targetId,
  onPaste,
  onClose,
  onOpenHelp,
}: ClipboardHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<ClipboardHistoryPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [includePinned, setIncludePinned] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<Element | null>(null);

  const items = page?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  useEffect(() => {
    restoreFocus.current = document.activeElement;
    return () => {
      const previous = restoreFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // The first page arrives after the initial render; move focus into the
  // list only when the user is not already typing in the search box.
  useEffect(() => {
    if (items.length === 0) return;
    const active = document.activeElement;
    const insidePanel = active instanceof HTMLElement && active.closest(".adp-dialog") !== null;
    if (!insidePanel || active === document.body) listRef.current?.focus();
  }, [items]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void listenClipboardHistoryChanged(() => {
      if (!disposed) setRefreshToken((value) => value + 1);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listClipboardHistory(query)
      .then((next) => {
        if (cancelled) return;
        setPage(next);
        setError(null);
        setSelectedId((current) => {
          if (current && next.items.some((item) => item.id === current)) return current;
          return next.items[0]?.id ?? null;
        });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, refreshToken]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      if (!selectedId) {
        setSelectedId(items[delta >= 0 ? 0 : items.length - 1].id);
        return;
      }
      const index = items.findIndex((item) => item.id === selectedId);
      const next = Math.min(items.length - 1, Math.max(0, index + delta));
      setSelectedId(items[next].id);
    },
    [items, selectedId],
  );

  const pasteSelected = useCallback(async (item: ClipboardHistoryItem | null = selected) => {
    if (!item || !targetId || item.missing || busy) return;
    setBusy(true);
    setError(null);
    let envelope: TransferEnvelope | null = null;
    try {
      envelope = await resolveClipboardHistory(
        item.id,
        targetId && isUuid(targetId) ? targetId : undefined,
      );
      await onPaste(envelope);
    } catch (reason) {
      setError(reason);
    } finally {
      if (envelope) await releaseTransfer(envelope.transfer_id).catch(() => undefined);
      setBusy(false);
    }
  }, [busy, onPaste, selected, targetId]);

  const togglePin = useCallback(async (item: ClipboardHistoryItem | null = selected) => {
    if (!item || !page) return;
    try {
      const next = await patchClipboardHistory({
        kind: "pin",
        id: item.id,
        pinned: !item.pinned,
        expected_generation: page.generation,
      });
      // Keep the current search page; only the changed row and the
      // generation move so a filtered list never jumps to every item.
      setPage((current) =>
        current
          ? {
              ...current,
              generation: next.generation,
              total: next.total,
              used_bytes: next.used_bytes,
              items: current.items.map((row) =>
                row.id === item.id ? { ...row, pinned: !item.pinned } : row,
              ),
            }
          : next,
      );
      setError(null);
    } catch (reason) {
      setError(reason);
    }
  }, [page, selected]);

  const showMore = useCallback(async () => {
    if (!page?.next_cursor) return;
    try {
      const next = await listClipboardHistory(query, page.next_cursor);
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (reason) {
      setError(reason);
    }
  }, [page, query]);

  const confirm = useCallback(async () => {
    if (!page || !confirmation) return;
    try {
      const patch =
        confirmation.kind === "remove"
          ? {
              kind: "remove" as const,
              ids: [confirmation.id],
              expected_generation: page.generation,
            }
          : {
              kind: "clear" as const,
              include_pinned: includePinned,
              expected_generation: page.generation,
            };
      const next = await patchClipboardHistory(patch);
      setPage(next);
      setSelectedId(null);
      setConfirmation(null);
      setIncludePinned(false);
      setError(null);
      // Re-read with the active search so removed rows leave the filtered
      // page too, and keep its generation authoritative.
      setRefreshToken((value) => value + 1);
    } catch (reason) {
      setError(reason);
      setConfirmation(null);
    }
  }, [confirmation, includePinned, page]);

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (items[0]) setSelectedId(items[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      if (items.length > 0) setSelectedId(items[items.length - 1].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void pasteSelected();
    } else if (event.key === " " || event.key === "p" || event.key === "P") {
      event.preventDefault();
      void togglePin();
    } else if (event.key === "Delete") {
      event.preventDefault();
      if (selected) setConfirmation({ kind: "remove", id: selected.id });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchWrapRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }
  };

  const rows = virtualizer.getVirtualItems();
  const errorMessage = error
    ? errorText(t, error, errorCode(error).startsWith("clipboard_history") ? "clipboard_history" : "transfer")
    : null;

  return (
    <Dialog
      title={t("clipboardHistory.title")}
      onClose={onClose}
      className="adp-clipboard-panel"
    >
      <div className="adp-clipboard-toolbar">
        <div ref={searchWrapRef} className="adp-clipboard-search">
          <SearchBox
            value={query}
            onChange={(value) => {
              setQuery(value.slice(0, 256));
              setSelectedId(null);
            }}
            placeholder={t("clipboardHistory.search")}
          />
        </div>
        <HelpButton onOpenHelp={() => onOpenHelp("clipboard-history")} />
      </div>

      {errorMessage ? (
        <p className="adp-clipboard-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {loading && !page ? (
        <Skeleton variant="rows" count={5} />
      ) : items.length === 0 ? (
        <p className="adp-clipboard-empty">{t("clipboardHistory.empty")}</p>
      ) : (
        <div className="adp-clipboard-scroll" ref={scrollRef}>
          <div
            className="adp-clipboard-list"
            role="listbox"
            aria-label={t("clipboardHistory.title")}
            aria-activedescendant={selected ? `clipboard-row-${selected.id}` : undefined}
            tabIndex={0}
            ref={listRef}
            onKeyDown={onListKeyDown}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {rows.map((row) => {
              const item = items[row.index];
              return (
                <div
                  key={item.id}
                  id={`clipboard-row-${item.id}`}
                  role="option"
                  aria-selected={item.id === selectedId}
                  className={
                    item.id === selectedId
                      ? "adp-clipboard-row adp-clipboard-row--selected"
                      : "adp-clipboard-row"
                  }
                  style={{ transform: `translateY(${row.start}px)` }}
                  onClick={() => {
                    setSelectedId(item.id);
                    listRef.current?.focus();
                  }}
                  onDoubleClick={() => void pasteSelected(item)}
                >
                  <span className={`adp-clipboard-thumb adp-clipboard-thumb--${item.kind}`} aria-hidden="true">
                    {item.kind === "image" ? (
                      <ImageIcon size={24} />
                    ) : item.kind === "files" ? (
                      <Files size={24} />
                    ) : (
                      <FileText size={24} />
                    )}
                  </span>
                  <span className="adp-clipboard-body">
                    <span className="adp-clipboard-preview">
                      {item.kind === "image" && !item.preview
                        ? t("clipboardHistory.image")
                        : item.preview}
                    </span>
                    <span className="adp-clipboard-meta">
                      <span>{formatDate(item.created_unix, i18n.language)}</span>
                      <span>{item.source_label ?? t(`clipboardHistory.source.${item.source}`)}</span>
                    </span>
                    {item.missing ? (
                      <span className="adp-clipboard-missing" role="note">
                        {t("clipboardHistory.missing")}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="adp-icon-btn adp-clipboard-pin"
                    aria-label={t(item.pinned ? "clipboardHistory.unpin" : "clipboardHistory.pin")}
                    title={t(item.pinned ? "clipboardHistory.unpin" : "clipboardHistory.pin")}
                    aria-pressed={item.pinned}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(item.id);
                      void togglePin(item);
                    }}
                  >
                    {item.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {page && !page.complete ? (
        <div className="adp-clipboard-more">
          <Button variant="subtle" onClick={() => void showMore()}>
            {t("clipboardHistory.showMore")}
          </Button>
        </div>
      ) : null}

      <div className="adp-clipboard-footer">
        <Button
          variant="subtle"
          disabled={items.length === 0}
          onClick={() => setConfirmation({ kind: "clear" })}
        >
          <Trash2 size={16} aria-hidden="true" />
          {t("clipboardHistory.clear")}
        </Button>
        <Button
          variant="primary"
          disabled={!selected || !targetId || selected.missing || busy}
          title={!targetId ? t("clipboardHistory.noTarget") : undefined}
          onClick={() => void pasteSelected()}
        >
          <ClipboardPaste size={16} aria-hidden="true" />
          {t("clipboardHistory.paste")}
        </Button>
      </div>

      {confirmation ? (
        <Dialog title={t("clipboardHistory.clear")} onClose={() => setConfirmation(null)}>
          <p>{t("clipboardHistory.clearConfirm")}</p>
          {confirmation.kind === "clear" ? (
            <label className="adp-clipboard-include">
              <input
                type="checkbox"
                checked={includePinned}
                onChange={(event) => setIncludePinned(event.target.checked)}
              />
              {t("clipboardHistory.includePinned")}
            </label>
          ) : null}
          <div className="adp-dialog-actions">
            <Button onClick={() => setConfirmation(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void confirm()}>
              {t("clipboardHistory.clear")}
            </Button>
          </div>
        </Dialog>
      ) : null}

      <span className="adp-clipboard-count" aria-hidden="true">
        <History size={14} /> {items.length}
      </span>
    </Dialog>
  );
}

export type { ClipboardHistoryItem };
