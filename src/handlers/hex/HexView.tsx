import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, Scan, ZoomIn, ZoomOut } from "lucide-react";
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
import { BYTES_PER_ROW, formatHexRow, HEX_PART_BYTES, hexPartCount, offsetDigits } from "./format";

const ROW_HEIGHT = 20;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;
const HELP = "open-as-text-or-hex";

interface SavedHexState {
  zoom: number;
}

interface HexCtx {
  zoom: number;
  part: number;
  parts: number;
}

function readSaved(state: unknown): SavedHexState {
  const value = (state ?? {}) as Partial<SavedHexState>;
  return { zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1 };
}

/** Hex viewer (Step 04c): offset, 16 bytes in hex and as text per row,
 * read-only. Files over 1 MB show in parts of 1 MB, like big text files. */
export default function HexView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<SavedHexState>(() => readSaved(savedState));
  const [part, setPart] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);
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

  // The rows get the keyboard (arrows, Page Up, Page Down) when shown.
  useEffect(() => {
    if (active && bytes) scrollRef.current?.focus({ preventScroll: true });
  }, [active, bytes]);

  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (parts > 1) items.unshift(t("text.part", { part: part + 1, parts }));
    onStatus({ items });
  }, [info.size, i18n.language, part, parts, onStatus, t]);

  const ctx: HexCtx = { zoom: settings.zoom, part, parts };
  const zoomTo = useCallback((zoom: number) => update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10)) }), [update]);
  const commands = useMemo<Command<HexCtx>[]>(
    () => [
      { id: "hex.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom < ZOOM_MAX, run: (c) => zoomTo(c.zoom * 1.1) },
      { id: "hex.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom > ZOOM_MIN, run: (c) => zoomTo(c.zoom / 1.1) },
      { id: "hex.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: HELP, enabledWhen: (c) => c.zoom !== 1, run: () => zoomTo(1) },
      { id: "hex.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "hex.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: HELP, visibleWhen: (c) => c.parts > 1, enabledWhen: (c) => c.part < c.parts - 1, run: (c) => setPart(Math.min(c.parts - 1, c.part + 1)) },
    ],
    [zoomTo],
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
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
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
                  return (
                    <div key={item.key} className="adp-hex-row" style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}>
                      <span className="adp-hex-offset">{row.offset}</span>
                      <span className="adp-hex-bytes">{row.hex}</span>
                      <span className="adp-hex-text">{row.text}</span>
                    </div>
                  );
                })
              : null}
          </div>
        </div>
      )}
    </ViewerFrame>
  );
}
