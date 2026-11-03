import { Layers } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { errorText } from "../../services/errors";
import { fileUrl } from "../../services/files";
import { formatSize } from "../../services/format";
import type { JobHandle } from "../../services/jobs";
import {
  closeSpecialView,
  openSpecialView,
  psdLayers,
  type PsdLayerInfo,
  type SpecialSession,
} from "../../services/specialViews";
import type { HandlerViewProps } from "../types";
import PsdLayers from "./PsdLayers";

interface SavedPsdState {
  layers_open: boolean;
}

function readSaved(state: unknown): SavedPsdState {
  const value = (state ?? {}) as Partial<SavedPsdState>;
  return { layers_open: value.layers_open !== false };
}

/** PSD viewer (Step 07g D7): the saved composite plus bounded layer names. */
export default function PsdView({ info, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<SpecialSession | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "online">(() => (info.online_only ? "online" : "loading"));
  const [slow, setSlow] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [open, setOpen] = useState(() => readSaved(savedState).layers_open);
  const [layers, setLayers] = useState<PsdLayerInfo[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);
  const job = useRef<JobHandle<SpecialSession> | null>(null);
  const sessionRef = useRef<SpecialSession | null>(null);
  const layersRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setPhase(info.online_only ? "online" : "loading");
    if (info.online_only) return;
    void (async () => {
      try {
        const handle = await openSpecialView(info.path, "psd");
        job.current = handle;
        const opened = await handle.completion;
        job.current = null;
        if (cancelled) return;
        sessionRef.current = opened;
        setSession(opened);
        setPhase(opened.preview || !opened.codec_required ? "ready" : "error");
      } catch {
        job.current = null;
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      void job.current?.cancel();
      job.current = null;
      const opened = sessionRef.current;
      sessionRef.current = null;
      if (opened) void closeSpecialView(opened.session_id).catch(() => undefined);
    };
  }, [info.path, info.online_only]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({ items });
  }, [i18n.language, info.size, natural, onStatus, t]);

  const loadPage = useCallback(async (next: string | null, append: boolean) => {
    const current = sessionRef.current;
    if (!current || layersLoading) return;
    const request = layersRequest.current + 1;
    layersRequest.current = request;
    setLayersLoading(true);
    setLayersError(null);
    try {
      const page = await psdLayers(current.session_id, next);
      if (layersRequest.current !== request) return;
      setLayers((existing) => (append ? [...existing, ...page.layers] : page.layers));
      setCursor(page.next_cursor);
      setComplete(page.complete);
    } catch (error) {
      if (layersRequest.current === request) {
        setLayersError(errorText(t, error, "special_view"));
      }
    } finally {
      if (layersRequest.current === request) setLayersLoading(false);
    }
  }, [layersLoading, t]);

  useEffect(() => {
    if (!open || !session || layers.length > 0 || layersLoading || complete) return;
    void loadPage(null, false);
  }, [complete, layers.length, layersLoading, loadPage, open, session]);

  const toggleLayers = () => {
    const next = !open;
    setOpen(next);
    onStateChange({ ...readSaved(savedState), layers_open: next });
  };

  const url = session?.preview ? fileUrl(session.preview.token, session.preview.name) : null;

  return (
    <div className="adp-psd-view">
      <div className="adp-psd-main">
        <div className="adp-psd-toolbar">
          <Button variant="subtle" onClick={toggleLayers} aria-pressed={open}>
            <Layers size={16} aria-hidden="true" /> {t("psd.layers")}
          </Button>
        </div>
        {phase === "online" ? (
          <div className="adp-viewer-message" role="status">
            <p>{t("preview.onlineOnly")}</p>
            <Button variant="primary" onClick={onOpenInWindowsApp}>{t("common.open")}</Button>
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, new Error("special_view.corrupt"), "special_view")}</p>
            <Button variant="primary" onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
          </div>
        ) : null}
        {phase === "loading" ? (
          <div className="adp-psd-loading" role="status" aria-label={t("components.loading")}>
            <div className="adp-skeleton-tile adp-psd-skeleton" />
            {slow ? <p>{t("preview.loading")}</p> : null}
          </div>
        ) : null}
        {phase === "ready" && url ? (
          <div className="adp-psd-stage">
            <img
              className="adp-psd-composite"
              src={url}
              alt={info.name}
              draggable={false}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })}
            />
          </div>
        ) : null}
        {phase === "ready" && !url ? (
          <div className="adp-viewer-message" role="status">
            <p>{t("psd.noComposite")}</p>
          </div>
        ) : null}
      </div>
      {open ? (
        <PsdLayers
          layers={layers}
          query={query}
          onQuery={setQuery}
          loading={layersLoading}
          error={layersError}
          hasMore={!complete && cursor !== null}
          onMore={() => void loadPage(cursor, true)}
        />
      ) : null}
      {!active ? <span className="adp-psd-paused" aria-hidden="true" /> : null}
    </div>
  );
}
