import { Expand, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import { fileUrl } from "../../services/files";
import { errorCode, errorText } from "../../services/errors";
import { formatSize } from "../../services/format";
import type { JobHandle } from "../../services/jobs";
import {
  closeSpecialView,
  fullRawPreview,
  openSpecialView,
  type SpecialImageState,
  type SpecialSession,
} from "../../services/specialViews";
import type { HandlerViewProps } from "../types";
import { MAX_ZOOM, MIN_ZOOM, nextZoom, readSpecialImageState, rotate } from "./specialImageState";

export type SpecialImageKind = "raw" | "codec_image";

/** RAW and HEIC/HEIF previews (Step 07g D5/D6). The first picture is the
 * embedded/codec preview; a full RAW frame is read only after the explicit
 * button, never on restore or in the background. */
export default function SpecialImageView({
  kind,
  info,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenInWindowsApp,
}: HandlerViewProps & { kind: SpecialImageKind }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<SpecialImageState>(() => readSpecialImageState(savedState));
  const [session, setSession] = useState<SpecialSession | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "codec" | "online">(() => (info.online_only ? "online" : "loading"));
  const [slow, setSlow] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const openJob = useRef<JobHandle<SpecialSession> | null>(null);
  const fullJob = useRef<JobHandle<SpecialSession> | null>(null);
  const sessionRef = useRef<SpecialSession | null>(null);

  const apply = useCallback(
    (patch: Partial<SpecialImageState>) => {
      setState((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  useEffect(() => {
    let cancelled = false;
    setPhase(info.online_only ? "online" : "loading");
    setSlow(false);
    setFailed(false);
    setNatural(null);
    if (info.online_only) return;
    void (async () => {
      try {
        const job = await openSpecialView(info.path, kind);
        openJob.current = job;
        const opened = await job.completion;
        openJob.current = null;
        if (cancelled) return;
        sessionRef.current = opened;
        setSession(opened);
        if (opened.preview) {
          setPhase("ready");
        } else if (opened.codec_required) {
          setPhase("codec");
        } else {
          setPhase("error");
        }
      } catch (error) {
        openJob.current = null;
        if (cancelled) return;
        setPhase(errorCode(error) === "special_view.codec_required" ? "codec" : "error");
      }
    })();
    return () => {
      cancelled = true;
      void openJob.current?.cancel();
      openJob.current = null;
      void fullJob.current?.cancel();
      fullJob.current = null;
      const opened = sessionRef.current;
      sessionRef.current = null;
      if (opened) void closeSpecialView(opened.session_id).catch(() => undefined);
    };
  }, [info.path, info.online_only, kind]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const items = [formatSize(info.size, i18n.language)];
    if (natural) items.unshift(t("viewer.dimensions", { width: natural.width, height: natural.height }));
    onStatus({
      items,
      zoom: natural
        ? {
            percent: state.zoom,
            min: MIN_ZOOM,
            max: MAX_ZOOM,
            set: (percent) => apply({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent))) }),
            fit: () => apply({ zoom: 100 }),
          }
        : undefined,
    });
  }, [apply, i18n.language, info.size, natural, onStatus, state.zoom, t]);

  const loadFull = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || kind !== "raw" || fullJob.current) return;
    try {
      const job = await fullRawPreview(current.session_id, 4096);
      fullJob.current = job;
      const updated = await job.completion;
      fullJob.current = null;
      if (!updated.preview) {
        setPhase(updated.codec_required ? "codec" : phase);
        return;
      }
      sessionRef.current = updated;
      setSession(updated);
      setNatural(null);
      setPhase("ready");
      apply({ full_resolution: true });
    } catch (error) {
      fullJob.current = null;
      if (errorCode(error) === "special_view.codec_required") setPhase("codec");
      else setFailed(true);
    }
  }, [apply, kind, phase]);

  const previewUrl = session?.preview ? fileUrl(session.preview.token, session.preview.name) : null;
  const sideways = state.rotation % 180 !== 0;
  const shownWidth = natural ? (sideways ? natural.height : natural.width) : 0;
  const shownHeight = natural ? (sideways ? natural.width : natural.height) : 0;

  return (
    <div className="adp-special-image" aria-busy={phase === "loading"}>
      {phase === "online" ? (
        <div className="adp-viewer-message" role="status">
          <p>{t("preview.onlineOnly")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>{t("common.open")}</Button>
        </div>
      ) : null}
      {phase === "codec" ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("special_view.codec")}</p>
          <p className="adp-special-image-help">{t("special_view.codecHelp")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
        </div>
      ) : null}
      {phase === "error" || failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{errorText(t, new Error("special_view.corrupt"), "special_view")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
        </div>
      ) : null}
      {phase === "loading" ? (
        <div className="adp-special-image-loading" role="status" aria-label={t("components.loading")}>
          <div className="adp-skeleton-tile adp-special-image-skeleton" />
          {slow ? <p>{t("preview.loading")}</p> : null}
        </div>
      ) : null}
      {previewUrl && phase === "ready" ? (
        <div className="adp-special-image-stage">
          <img
            className="adp-special-image-picture"
            src={previewUrl}
            alt={info.name}
            draggable={false}
            decoding="async"
            style={{
              width: Math.max(1, Math.round((shownWidth * state.zoom) / 100)),
              height: Math.max(1, Math.round((shownHeight * state.zoom) / 100)),
              transform: `rotate(${state.rotation}deg)`,
            }}
            onLoad={(event) => {
              const image = event.currentTarget;
              setNatural({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
            }}
            onError={() => setFailed(true)}
          />
        </div>
      ) : null}
      <div className="adp-special-image-controls" role="toolbar" aria-label={t("viewer.zoom")}>
        <button type="button" className="adp-icon-btn" aria-label={t("viewer.zoomOut")} disabled={!natural || state.zoom <= MIN_ZOOM} onClick={() => apply({ zoom: nextZoom(state.zoom, -1) })}>
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("viewer.zoomIn")} disabled={!natural || state.zoom >= MAX_ZOOM} onClick={() => apply({ zoom: nextZoom(state.zoom, 1) })}>
          <ZoomIn size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("viewer.fitToWindow")} disabled={!natural} onClick={() => apply({ zoom: 100 })}>
          <Expand size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("viewer.rotateLeft")} disabled={!natural} onClick={() => apply({ rotation: rotate(state.rotation, false) })}>
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("viewer.rotateRight")} disabled={!natural} onClick={() => apply({ rotation: rotate(state.rotation, true) })}>
          <RotateCw size={16} aria-hidden="true" />
        </button>
        {kind === "raw" ? (
          <Button variant="subtle" disabled={!session || state.full_resolution} onClick={() => void loadFull()}>
            {t("raw.fullResolution")}
          </Button>
        ) : null}
      </div>
      {!active ? <span className="adp-special-image-paused" aria-hidden="true" /> : null}
    </div>
  );
}
