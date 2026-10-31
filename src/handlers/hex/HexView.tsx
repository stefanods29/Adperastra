import { useVirtualizer } from "@tanstack/react-virtual";
import { Binary, CaseSensitive, ChevronLeft, ChevronRight, LocateFixed, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import TextInput from "../../components/TextInput";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { findInFile } from "./findInFile";
import { BYTES_PER_ROW, formatHexRow, HEX_PART_BYTES, hexPartCount, offsetDigits } from "./format";
import {
  encodeTextPattern,
  hexCharRange,
  offsetLocation,
  parseHexPattern,
  parseOffset,
} from "./search";

const ROW_HEIGHT = 20;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;
const HELP = "open-as-text-or-hex";

type SearchMode = "text" | "bytes";

interface SavedHexState {
  zoom: number;
  searchMode: SearchMode;
}

interface HexCtx {
  zoom: number;
  part: number;
  parts: number;
  searchMode: SearchMode;
  searching: boolean;
  hasFile: boolean;
}

/** True when the match covers any byte of this row. */
function rowOverlaps(match: { offset: number; length: number } | null, rowStart: number): boolean {
  if (match === null) return false;
  return match.offset - rowStart < BYTES_PER_ROW && match.offset + match.length - rowStart > 0;
}

/** True when the match starts in this row (it gets the current marker). */
function rowHoldsStart(match: { offset: number; length: number } | null, rowStart: number): boolean {
  if (match === null) return false;
  const from = match.offset - rowStart;
  if (from < 0) return false;
  return from < BYTES_PER_ROW;
}

function readSaved(state: unknown): SavedHexState {
  const value = (state ?? {}) as Partial<SavedHexState>;
  return {
    zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1,
    searchMode: value.searchMode === "bytes" ? "bytes" : "text",
  };
}

/** Hex viewer (Step 04c, search in Step 06f): offset, 16 bytes in hex and as
 * text per row, read-only. Files over 1 MB show in parts of 1 MB. Search
 * runs through the whole file with range reads and wraps once. */
export default function HexView({
  info,
  url,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
  find,
  protectedView: _protectedView,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<SavedHexState>(() => readSaved(savedState));
  const [part, setPart] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);
  const [match, setMatch] = useState<{ offset: number; length: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [slowSearch, setSlowSearch] = useState(false);
  const [scrollRow, setScrollRow] = useState<number | null>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToText, setGoToText] = useState("");
  const [goToError, setGoToError] = useState<string | null>(null);
  const searchRef = useRef<AbortController | null>(null);
  const parts = hexPartCount(info.size);
  const digits = offsetDigits(info.size);
  const partStart = part * HEX_PART_BYTES;
  const rowHeight = Math.round(ROW_HEIGHT * settings.zoom);

  const update = useCallback(
    (patch: Partial<SavedHexState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Read the current part with one Range request.
  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    if (info.size === 0) {
      setBytes(new Uint8Array(0));
      return;
    }
    const end = Math.min(info.size, partStart + HEX_PART_BYTES) - 1;
    fetch(url, { headers: { Range: `bytes=${partStart}-${end}` } })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("files.read_failed"))))
      .then((buffer) => {
        if (!cancelled) setBytes(new Uint8Array(buffer));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, partStart, info.size]);

  const rowCount = bytes ? Math.ceil(bytes.length / BYTES_PER_ROW) : 0;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 24,
  });
  useEffect(() => {
    virtualizer.measure();
    // Row height changes with the zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [part]);
  useEffect(() => {
    if (scrollRow === null || !bytes) return;
    virtualizer.scrollToIndex(scrollRow);
    setScrollRow(null);
    // The row is scrolled once its part arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRow, bytes]);

  // The rows get the keyboard (arrows, Page Up, Page Down) when shown.
  useEffect(() => {
    if (active && bytes) scrollRef.current?.focus({ preventScroll: true });
  }, [active, bytes]);

  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (parts > 1) items.unshift(t("text.part", { part: part + 1, parts }));
    if (status) items.push(status);
    onStatus({ items });
  }, [info.size, i18n.language, part, parts, onStatus, t, status]);

  useEffect(() => {
    if (!searching) {
      setSlowSearch(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowSearch(true), 1000);
    return () => window.clearTimeout(timer);
  }, [searching]);

  // Typing a new search word stops the running search (T10.5).
  const lastText = useRef(find.text);
  useEffect(() => {
    if (lastText.current === find.text) return;
    lastText.current = find.text;
    searchRef.current?.abort();
    setSearching(false);
    setMatch(null);
  }, [find.text]);

  // Going inactive stops the search too.
  useEffect(() => {
    if (active) return;
    searchRef.current?.abort();
    setSearching(false);
  }, [active]);

  const readRange = useCallback(
    async (start: number, end: number): Promise<Uint8Array> => {
      const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (!response.ok) throw new Error("files.read_failed");
      return new Uint8Array(await response.arrayBuffer());
    },
    [url],
  );

  const startSearch = useCallback(async () => {
    searchRef.current?.abort();
    const controller = new AbortController();
    searchRef.current = controller;
    setStatus(null);
    if (find.text.trim() === "") return;
    const needle =
      settings.searchMode === "text"
        ? encodeTextPattern(find.text)
        : parseHexPattern(find.text);
    if (!needle) {
      setStatus(t("hex.badPattern"));
      return;
    }
    const from = match
      ? find.backwards
        ? Math.max(0, match.offset - 1)
        : Math.min(info.size, match.offset + 1)
      : partStart;
    setSearching(true);
    setProgress(0);
    try {
      const found = await findInFile({
        size: info.size,
        needle,
        from,
        backwards: find.backwards,
        fold: settings.searchMode === "text" && !(find.options?.caseSensitive ?? false),
        read: readRange,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      if (found === null) {
        setMatch(null);
        setStatus(t("hex.notFound"));
        return;
      }
      const location = offsetLocation(found);
      setMatch({ offset: found, length: needle.length });
      setPart(location.part);
      setScrollRow(location.row);
      setStatus(
        t("hex.foundAt", {
          offset: found.toString(16).toUpperCase().padStart(digits, "0"),
        }),
      );
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") return;
      // A failed search never sets the view's own error (D14).
      setStatus(t("hex.searchFailed"));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, [digits, find.backwards, find.options, find.text, info.size, match, partStart, readRange, settings.searchMode, t]);

  // Enter or F3 starts a search; it stops with the tab (P-28).
  const lastRequest = useRef(0);
  useEffect(() => {
    if (find.request === lastRequest.current) return;
    lastRequest.current = find.request;
    if (find.request === 0) return;
    void startSearch();
    return () => {
      searchRef.current?.abort();
    };
    // The request number is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.request]);

  useEffect(() => () => searchRef.current?.abort(), []);

  const confirmGoTo = useCallback(() => {
    const offset = parseOffset(goToText, info.size);
    if (offset === null) {
      const last = Math.max(0, info.size - 1).toString(16).toUpperCase();
      setGoToError(t("hex.goToBad", { last }));
      return;
    }
    const location = offsetLocation(offset);
    setPart(location.part);
    setScrollRow(location.row);
    setMatch({ offset, length: 1 });
    setStatus(t("hex.foundAt", { offset: offset.toString(16).toUpperCase().padStart(digits, "0") }));
    setGoToError(null);
    setGoToOpen(false);
  }, [digits, goToText, info.size, t]);

  const zoomTo = useCallback(
    (zoom: number) =>
      update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10)) }),
    [update],
  );
  const ctx: HexCtx = {
    zoom: settings.zoom,
    part,
    parts,
    searchMode: settings.searchMode,
    searching,
    hasFile: info.size > 0,
  };
  const commands = useMemo<Command<HexCtx>[]>(
    () => [
      { id: "hex.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom < ZOOM_MAX, run: (c) => zoomTo(c.zoom * 1.1) },
      { id: "hex.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom > ZOOM_MIN, run: (c) => zoomTo(c.zoom / 1.1) },
      { id: "hex.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom !== 1, run: () => zoomTo(1) },
      { id: "hex.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "hex.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part < c.parts - 1, run: (c) => setPart(Math.min(c.parts - 1, c.part + 1)) },
      {
        id: "hex.searchText",
        labelKey: "hex.searchText",
        icon: CaseSensitive,
        risk: "read-only",
        helpSlug: HELP,
        checkKind: "radio",
        checkedWhen: (c) => c.searchMode === "text",
        enabledWhen: () => true,
        run: () => update({ searchMode: "text" }),
      },
      {
        id: "hex.searchBytes",
        labelKey: "hex.searchBytes",
        icon: Binary,
        risk: "read-only",
        helpSlug: HELP,
        checkKind: "radio",
        checkedWhen: (c) => c.searchMode === "bytes",
        enabledWhen: () => true,
        run: () => update({ searchMode: "bytes" }),
      },
      {
        id: "hex.goToOffset",
        labelKey: "hex.goToOffset",
        icon: LocateFixed,
        shortcut: "Ctrl+G",
        risk: "read-only",
        helpSlug: HELP,
        enabledWhen: (c) => c.hasFile,
        run: () => {
          setGoToText("");
          setGoToError(null);
          setGoToOpen(true);
        },
      },
    ],
    [update, zoomTo],
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
              { type: "button", command: "hex.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "hex.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "hex.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
          {
            id: "parts",
            labelKey: "text.parts",
            controls: [
              { type: "button", command: "hex.previousPart", keyTip: "P" },
              { type: "button", command: "hex.nextPart", keyTip: "X" },
            ],
          },
          {
            id: "search",
            labelKey: "common.search",
            controls: [
              { type: "toggle", command: "hex.searchText", keyTip: "T" },
              { type: "toggle", command: "hex.searchBytes", keyTip: "B" },
              { type: "button", command: "hex.goToOffset", keyTip: "G" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {slowSearch ? (
        <div className="adp-hex-note" role="status">
          {t("hex.searching", { percent: progress })}
        </div>
      ) : null}
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("hex.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="adp-hex"
          tabIndex={0}
          role="region"
          aria-label={t("hex.label", { name: info.name })}
          style={{ ["--adp-hex-zoom" as string]: String(settings.zoom) }}
        >
          <div className="adp-hex-rows" style={{ height: virtualizer.getTotalSize() }}>
            {bytes
              ? virtualizer.getVirtualItems().map((item) => {
                  const row = formatHexRow(bytes, item.index * BYTES_PER_ROW, partStart + item.index * BYTES_PER_ROW, digits);
                  const rowStart = partStart + item.index * BYTES_PER_ROW;
                  const overlaps = rowOverlaps(match, rowStart);
                  const first = overlaps && match ? Math.max(0, match.offset - rowStart) : 0;
                  const last =
                    overlaps && match
                      ? Math.min(BYTES_PER_ROW - 1, match.offset + match.length - 1 - rowStart)
                      : 0;
                  const startRow = rowHoldsStart(match, rowStart);
                  const [hexStart, hexEnd] = hexCharRange(first, last);
                  return (
                    <div
                      key={item.key}
                      className="adp-hex-row"
                      aria-current={startRow ? "true" : undefined}
                      style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}
                    >
                      <span className="adp-hex-offset">{row.offset}</span>
                      {overlaps ? (
                        <span className="adp-hex-bytes">
                          {row.hex.slice(0, hexStart)}
                          <span className="adp-hex-match">{row.hex.slice(hexStart, hexEnd)}</span>
                          {row.hex.slice(hexEnd)}
                        </span>
                      ) : (
                        <span className="adp-hex-bytes">{row.hex}</span>
                      )}
                      {overlaps ? (
                        <span className="adp-hex-text">
                          {row.text.slice(0, first)}
                          <span className="adp-hex-match">{row.text.slice(first, last + 1)}</span>
                          {row.text.slice(last + 1)}
                        </span>
                      ) : (
                        <span className="adp-hex-text">{row.text}</span>
                      )}
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      )}
      {goToOpen ? (
        <Dialog title={t("hex.goToTitle")} onClose={() => setGoToOpen(false)}>
          <div
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              confirmGoTo();
            }}
          >
            <TextInput
              value={goToText}
              onChange={(value) => {
                setGoToText(value);
                setGoToError(null);
              }}
              placeholder={t("hex.goToLabel")}
              ariaLabel={t("hex.goToLabel")}
            />
            {goToError ? (
              <p className="adp-dialog-text adp-protected-error" role="alert">
                {goToError}
              </p>
            ) : null}
            <div className="adp-dialog-actions">
              <Button variant="primary" onClick={confirmGoTo}>
                {t("hex.goToConfirm")}
              </Button>
              <Button onClick={() => setGoToOpen(false)}>{t("common.cancel")}</Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </ViewerFrame>
  );
}
