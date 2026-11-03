import { useVirtualizer } from "@tanstack/react-virtual";
import { Download } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import TextInput from "../../components/TextInput";
import type { Command } from "../../commands/registry";
import { errorCode, errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import { fontInfo, fontInstall, type FontInfo } from "../../services/fontView";
import type { JobHandle } from "../../services/jobs";
import Ribbon from "../../ribbon/Ribbon";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { charMapRows, codePointAt, formatCodePoint } from "./charMap";

/** The sample lines, in pixels. */
const SAMPLE_SIZES = [12, 16, 24, 36, 48, 72];
/** The longest sample text the box takes. */
const MAX_SAMPLE_CHARS = 200;
/** One character-map cell. */
const CELL_WIDTH = 56;
const CELL_HEIGHT = 64;
/** Formats Windows can install. */
const INSTALLABLE = ["ttf", "otf", "ttc"];

let faceCounter = 0;

interface SavedFontState {
  sample: string;
}

interface FontCtx {
  installable: boolean;
  canInstall: boolean;
  protectedView: boolean;
}

function readSaved(state: unknown): Partial<SavedFontState> {
  const value = (state ?? {}) as Partial<SavedFontState>;
  return { sample: typeof value.sample === "string" ? value.sample.slice(0, MAX_SAMPLE_CHARS) : undefined };
}

/** Font files as a sample sheet (Step 06f): six sizes, the font's details, a
 * character map, and Install through Windows after the user's click. */
export default function FontView({
  info,
  url,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
  protectedView,
  previewOnly = false,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [sample, setSample] = useState(() => readSaved(savedState).sample ?? t("font.sample"));
  const [details, setDetails] = useState<FontInfo | null>(null);
  const [fontName, setFontName] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [askInstall, setAskInstall] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const infoJob = useRef<JobHandle<FontInfo> | null>(null);
  const savedOnce = useRef(true);

  const installable = INSTALLABLE.includes(info.ext.toLowerCase());

  // The browser loads the font itself, so a broken file is refused there too.
  // The loaded face is removed when the tab closes (plan/pitfalls.md P-28).
  useEffect(() => {
    let cancelled = false;
    let loaded: FontFace | null = null;
    setLoadFailed(false);
    setFontName(null);
    if (typeof FontFace === "undefined") {
      // Test environments without the browser's font API still show the sheet.
      return;
    }
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("font.unreadable");
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        faceCounter += 1;
        const name = `adp-preview-${faceCounter}`;
        const face = new FontFace(name, buffer);
        await face.load();
        if (cancelled) return;
        document.fonts.add(face);
        loaded = face;
        setFontName(name);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) document.fonts.delete(loaded);
    };
  }, [url]);

  // Details come from the helper; the sheet still shows when they fail.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const job = await fontInfo(info.path);
        infoJob.current = job;
        const found = await job.completion;
        infoJob.current = null;
        if (!cancelled) setDetails(found);
      } catch {
        infoJob.current = null;
      }
    })();
    return () => {
      cancelled = true;
      void infoJob.current?.cancel();
    };
  }, [info.path]);

  // The sample text is part of the tab's saved state.
  useEffect(() => {
    if (savedOnce.current) {
      savedOnce.current = false;
      return;
    }
    onStateChange({ sample });
  }, [sample, onStateChange]);

  useEffect(() => {
    const items: string[] = [];
    if (details?.family) items.push(details.family);
    items.push(formatSize(info.size, i18n.language));
    if (notice) items.push(notice);
    onStatus({ items });
  }, [details, info.size, i18n.language, notice, onStatus]);

  // The character map's width decides how many cells fit in a row.
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const update = () => setMapWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [details]);

  const copyCharacter = useCallback(
    async (code: number) => {
      try {
        await navigator.clipboard.writeText(String.fromCodePoint(code));
        setNotice(t("json.copied"));
      } catch {
        setNotice(t("json.copyFailed"));
      }
    },
    [t],
  );

  const install = useCallback(async () => {
    if (previewOnly) return;
    setInstallError(null);
    try {
      const started = await fontInstall(info.path);
      setAskInstall(false);
      if (started) setNotice(t("font.installed"));
    } catch (error) {
      setInstallError(errorText(t, error, "font"));
    }
  }, [info.path, t, previewOnly]);

  const ctx: FontCtx = {
    installable,
    canInstall: installable && !protectedView && !previewOnly,
    protectedView,
  };
  const commands = useMemo<Command<FontCtx>[]>(
    () => [
      {
        id: "font.install",
        labelKey: "font.install",
        labelKeyFor: (current) => (current.protectedView ? "font.protectedNote" : "font.install"),
        icon: Download,
        risk: "change",
        helpSlug: "viewing-fonts",
        visibleWhen: (current) => current.installable,
        enabledWhen: (current) => current.canInstall,
        run: () => setAskInstall(true),
      },
    ],
    [],
  );

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "font",
            labelKey: "handlers.font",
            controls: [{ type: "button", command: "font.install", keyTip: "I" }],
          },
        ],
      },
    ],
  };

  const perRow = Math.max(1, Math.floor(mapWidth / CELL_WIDTH));
  const ranges = details?.ranges ?? [];
  const cells = details?.code_points ?? 0;
  const rowCount = charMapRows(cells, perRow);
  const mapRefScroll = useRef<HTMLDivElement | null>(null);
  const mapVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => mapRefScroll.current,
    estimateSize: () => CELL_HEIGHT,
    overscan: 4,
  });

  const detailRows = details
    ? [
        { id: "family", label: t("font.family"), value: details.family },
        { id: "style", label: t("font.style"), value: details.style },
        { id: "version", label: t("font.version"), value: details.version },
        { id: "designer", label: t("font.designer"), value: details.designer },
        { id: "copyright", label: t("font.copyright"), value: details.copyright },
        { id: "license", label: t("font.license"), value: details.license },
        { id: "glyphs", label: t("font.glyphs"), value: String(details.glyphs) },
      ].filter((row) => Boolean(row.value))
    : [];

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {loadFailed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("font.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : (
        <div className="adp-font" role="region" aria-label={t("font.label", { name: info.name })}>
          <div className="adp-font-sample-bar">
            <TextInput
              value={sample}
              onChange={(value) => setSample(value.slice(0, MAX_SAMPLE_CHARS))}
              placeholder={t("font.sampleLabel")}
              ariaLabel={t("font.sampleLabel")}
            />
          </div>
          {SAMPLE_SIZES.map((size) => (
            <div key={size} className="adp-font-line">
              <span className="adp-font-size">{t("font.sizeLabel", { size })}</span>
              <p
                className="adp-font-sample"
                style={{ fontSize: size, fontFamily: fontName ?? undefined }}
              >
                {sample}
              </p>
            </div>
          ))}
          {details && detailRows.length > 0 ? (
            <section className="adp-font-section">
              <h3 className="adp-heading">{t("font.details")}</h3>
              <dl className="adp-font-details">
                {detailRows.map((row) => (
                  <Fragment key={row.id}>
                    <dt>{row.label}</dt>
                    <dd className={row.id === "license" ? "adp-font-license" : undefined}>{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
              {details.faces > 1 ? (
                <p className="adp-font-note">{t("font.faces", { count: details.faces })}</p>
              ) : null}
            </section>
          ) : null}
          <section className="adp-font-section">
            <h3 className="adp-heading">{t("font.charMap")}</h3>
            {details ? (
              details.format === "woff" || details.format === "woff2" ? (
                <p className="adp-font-note">{t("font.noCharMap")}</p>
              ) : (
                <>
                  {notice ? (
                    <p className="adp-font-note" role="status">
                      {notice}
                    </p>
                  ) : null}
                  <div ref={mapRef} className="adp-font-map">
                    <div
                      ref={mapRefScroll}
                      className="adp-font-map-scroll"
                      style={{ height: mapVirtualizer.getTotalSize() }}
                    >
                      <div className="adp-font-map-rows">
                        {mapVirtualizer.getVirtualItems().map((rowItem) => (
                          <div
                            key={rowItem.key}
                            className="adp-font-map-row"
                            style={{
                              transform: `translateY(${rowItem.start}px)`,
                              height: CELL_HEIGHT,
                              width: perRow * CELL_WIDTH,
                            }}
                          >
                            {Array.from({ length: perRow }, (_, column) => {
                              const code = codePointAt(ranges, rowItem.index * perRow + column);
                              if (code === null) return null;
                              const label = formatCodePoint(code);
                              return (
                                <button
                                  key={code}
                                  type="button"
                                  className="adp-font-cell"
                                  aria-label={t("font.copyChar", { code: label })}
                                  style={{
                                    width: CELL_WIDTH,
                                    height: CELL_HEIGHT,
                                    fontFamily: fontName ?? undefined,
                                  }}
                                  onClick={() => void copyCharacter(code)}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    void copyCharacter(code);
                                  }}
                                >
                                  <span className="adp-font-cell-char">{String.fromCodePoint(code)}</span>
                                  <span className="adp-font-cell-code">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {details.ranges_cut ? (
                    <p className="adp-font-note">{t("font.rangesCut")}</p>
                  ) : null}
                </>
              )
            ) : null}
          </section>
        </div>
      )}
      {askInstall ? (
        <Dialog title={t("font.installTitle")} onClose={() => setAskInstall(false)}>
          <p className="adp-dialog-text">{t("font.installBody", { name: info.name })}</p>
          {installError ? (
            <p className="adp-dialog-text adp-protected-error" role="alert">
              {installError}
            </p>
          ) : null}
          <div className="adp-dialog-actions">
            <Button variant="primary" onClick={() => void install()}>
              {t("font.installConfirm")}
            </Button>
            <Button onClick={() => setAskInstall(false)}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}
    </ViewerFrame>
  );
}
