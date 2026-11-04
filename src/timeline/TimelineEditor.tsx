import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { isCommandEnabled } from "../commands/registry";
import IconButton from "../components/IconButton";
import type { FileTabStatus } from "../handlers/types";
import type { MediaSource, WavePage } from "../media-edit/types";
import type { CacheLease } from "../services/cache";
import { fileUrl } from "../services/files";
import { waveformPage } from "../services/mediaEdit";
import { proxyPlan, proxyQualityValue, releaseTimelineProxy } from "../services/timeline";
import type { TimelineEffectOperation } from "./effectTypes";
import { applyTimelineEffect } from "./effects";
import { audioClippingRequired } from "./audioMix";
import type { TimelineClip, TimelineOperation, TimelineProject, Track } from "./types";
import { newUuid, timelineErrorCode } from "./types";
import { commitTimelineTransaction } from "./transactions";
import { snapTimelineTime } from "./snap";
import { computeProjectDurationUs } from "./projectValidation";
import { normalizeTimeline } from "./renderPlan";
import { finishGesture, TimelineGesture } from "./timelineTransfer";
import {
  createTimelineCommands,
  type TimelineCommandActions,
  type TimelineCommandContext,
} from "./timelineCommands";
import {
  decodeTimelineViewState,
  encodeTimelineViewState,
  playheadAfterArrow,
} from "./timelineViewTypes";
import type { TimelineController } from "./TimelineDocument";
import ExportTimelineDialog from "./ExportTimelineDialog";
import TimelinePreview from "./TimelinePreview";
import TrackList from "./TrackList";
import TimelineProperties, { type TimelinePanelTab } from "./TimelineProperties";

export interface TimelineEditorProps {
  documentId: string;
  controller: TimelineController;
  active: boolean;
  savedState?: unknown;
  onStateChange?: (state: unknown) => void;
  onStatus?: (status: FileTabStatus) => void;
  onOpenHelp?: (slug: string) => void;
  proxyQuality?: "source" | 512 | 960;
  proxyEnabled?: boolean;
  proxyCapability?: boolean;
  onRequestProxy?: (source: MediaSource, quality: 512 | 960) => Promise<CacheLease>;
}

function findClip(project: Readonly<TimelineProject>, id: string): TimelineClip | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return clip;
  }
  return null;
}

function trackOf(project: Readonly<TimelineProject>, clipId: string): Track | null {
  return project.tracks.find((track) => track.clips.some((clip) => clip.id === clipId)) ?? null;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Buttons and links also own Space/Enter; the editor's transport keys must
  // never fire a second action from a focused control.
  return Boolean(
    target.closest("input, textarea, select, button, a, [contenteditable='true']"),
  );
}

/** Commands the mounted editor can really run. `timeline.new` and
 * `timeline.edit` belong to the app's new-document host, which this view does
 * not own; export opens the bounded review dialog, whose Start action stays
 * disabled until a native graph executor exists. */
const EDITOR_COMMAND_IDS = new Set([
  "timeline.addVideo",
  "timeline.addAudio",
  "timeline.split",
  "timeline.ripple",
  "timeline.snap",
  "timeline.transition",
  "timeline.title",
  "timeline.effects",
  "timeline.audio",
  "timeline.subtitles",
  "timeline.export",
]);

/** The timeline editor: preview, properties, virtualized tracks and transport. */
export default function TimelineEditor(props: TimelineEditorProps) {
  const { t } = useTranslation();
  const { controller, documentId, active } = props;
  const [project, setProject] = useState<Readonly<TimelineProject>>(() => controller.getProject());
  const [view, setView] = useState(() => decodeTimelineViewState(props.savedState));
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [width, setWidth] = useState(960);
  const [dragClipId, setDragClipId] = useState<string | null>(null);
  const [dragStartUs, setDragStartUs] = useState<number | null>(null);
  const [wavePage, setWavePage] = useState<WavePage | null>(null);
  const [waveLoading, setWaveLoading] = useState(false);
  const [proxyLease, setProxyLease] = useState<CacheLease | null>(null);
  const [tab, setTab] = useState<TimelinePanelTab>("properties");
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const gesture = useRef(new TimelineGesture());
  const dragOrigin = useRef(0);
  const dragOriginStart = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  const duration = computeProjectDurationUs(project);
  const selected = new Set(view.selected_clip_ids);
  const selectedClip = view.selected_clip_ids.length > 0 ? findClip(project, view.selected_clip_ids[0]) : null;
  const activeTrack = project.tracks.find((track) => track.id === view.active_track_id) ?? null;
  const preview = active ? proxyPlan(props.proxyQuality ?? 960, props.proxyEnabled === true, props.proxyCapability === true) : "original";
  // The exact 19a plan shared with preview/export drives the conservative
  // clipping notice. A project that cannot normalize shows no false warning.
  const plan = useMemo(() => {
    // Only the audio inspector needs the conservative clipping bound; keep the
    // full project normalization out of gesture/render paths.
    if (tab !== "audio") return null;
    try {
      return normalizeTimeline(project);
    } catch {
      return null;
    }
  }, [project, tab]);
  const clippingWarning = useMemo(() => {
    if (!plan) return false;
    try {
      return audioClippingRequired(plan);
    } catch {
      return false;
    }
  }, [plan]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const unsubscribe = controller.subscribe((next) => setProject(next));
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(0, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setWavePage(null);
    setWaveLoading(false);
    if (!selectedClip) return;
    const owner = trackOf(project, selectedClip.id);
    if (!owner || owner.kind !== "audio") return;
    const source = project.sources.find((item) => item.id === selectedClip.source_id);
    if (!source) return;
    timer = window.setTimeout(() => {
      if (!cancelled) setWaveLoading(true);
    }, 100);
    void waveformPage(source, 0, 0)
      .then((page) => {
        if (!cancelled) {
          setWavePage(page);
          setWaveLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setWaveLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedClip?.id, project.sources]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    return () => {
      if (proxyLease) void releaseTimelineProxy(proxyLease.lease_id);
    };
  }, [proxyLease]);

  useEffect(() => {
    // A proxy belongs to one source; selecting another clip releases it.
    setProxyLease(null);
  }, [selectedClip?.source_id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      props.onStateChange?.(encodeTimelineViewState(view));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [view, props.onStateChange]);

  useEffect(() => {
    props.onStatus?.({
      items: [
        t("timeline.status", {
          tracks: project.tracks.length,
          clips: project.tracks.reduce((total, track) => total + track.clips.length, 0),
        }),
      ],
    });
  }, [project, props.onStatus, t]);

  useEffect(() => {
    if (!playing || !active) return;
    const base = viewRef.current.playhead_us;
    const started = performance.now();
    let painted = 0;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(duration, base + Math.max(0, now - started) * 1000);
      if (now - painted >= 33) {
        painted = now;
        setView((current) => ({ ...current, playhead_us: Math.round(next) }));
      }
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active, duration]);

  const updateView = useCallback((patch: Partial<typeof view>) => {
    setView((current) => ({ ...current, ...patch }));
  }, []);

  const run = useCallback(
    async (operation: TimelineOperation) => {
      setBusy(true);
      setError(null);
      try {
        await controller.apply(operation);
      } catch (caught) {
        setError(timelineErrorCode(caught));
      } finally {
        setBusy(false);
      }
    },
    [controller],
  );

  const applyEffect = useCallback(
    async (operation: TimelineEffectOperation) => {
      setBusy(true);
      setError(null);
      try {
        await applyTimelineEffect(
          documentId,
          controller.getProject().content_id,
          operation,
        );
      } catch (caught) {
        setError(timelineErrorCode(caught));
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [controller, documentId],
  );

  const commitTrack = useCallback(
    async (trackId: string, patch: Partial<Track>) => {
      setBusy(true);
      setError(null);
      try {
        await commitTimelineTransaction(documentId, controller.getProject().content_id, (current) => ({
          ...current,
          tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
        }));
      } catch (caught) {
        setError(timelineErrorCode(caught));
      } finally {
        setBusy(false);
      }
    },
    [controller, documentId],
  );

  const addTrack = (kind: "video" | "audio") => {
    const number = project.tracks.filter((track) => track.kind === kind).length + 1;
    const track: Track = {
      id: newUuid(),
      kind,
      name: t(kind === "video" ? "timeline.videoTrackName" : "timeline.audioTrackName", { number }),
      locked: false,
      visible: true,
      mute: false,
      solo: false,
      gain: 1,
      index: project.tracks.length,
      clips: [],
    };
    void run({ kind: "add_track", track });
  };

  const moveTrack = (track: Track, direction: -1 | 1) => {
    const ids = project.tracks.map((item) => item.id);
    const from = ids.indexOf(track.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run({ kind: "reorder_tracks", ids });
  };

  const selectClip = (clipId: string, additive: boolean) => {
    const ids = additive
      ? selected.has(clipId)
        ? view.selected_clip_ids.filter((id) => id !== clipId)
        : [...view.selected_clip_ids, clipId]
      : [clipId];
    updateView({ selected_clip_ids: ids });
  };

  const onClipPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    track: Track,
  ) => {
    selectClip(clip.id, event.ctrlKey || event.metaKey || event.shiftKey);
    if (track.locked) return;
    gesture.current.begin(clip.id, track.id, clip.start_us);
    dragOrigin.current = event.clientX;
    dragOriginStart.current = clip.start_us;
    setDragClipId(clip.id);
    setDragStartUs(clip.start_us);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.active || dragStartUs === null) return;
    const delta = ((event.clientX - dragOrigin.current) * 1_000_000) / view.pixels_per_second;
    const candidate = Math.max(0, Math.round(dragOriginStart.current + delta));
    const snapped = snapTimelineTime(project, candidate, {
      enabled: view.snap_enabled && !event.altKey,
      pixels_per_second: view.pixels_per_second,
      playhead_us: view.playhead_us,
      frame_rate: project.frame_rate,
      exclude_clip_ids: dragClipId ? [dragClipId] : [],
    });
    gesture.current.preview(snapped.time_us);
    setDragStartUs(snapped.time_us);
  };

  const finishDrag = async () => {
    setDragClipId(null);
    setDragStartUs(null);
    await finishGesture(gesture.current, run);
  };

  const cancelDrag = () => {
    gesture.current.cancel();
    setDragClipId(null);
    setDragStartUs(null);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (duration <= 0) return;
    setView((current) => ({ ...current, playhead_us: Math.min(current.playhead_us, duration) }));
    setPlaying(true);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && gesture.current.active) {
      event.preventDefault();
      cancelDrag();
      return;
    }
    if (isTextInput(event.target)) return;
    if (event.key === " ") {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? "right" : "left";
      updateView({
        playhead_us: playheadAfterArrow(
          view.playhead_us,
          direction,
          event.shiftKey,
          project.frame_rate,
        ),
      });
      return;
    }
    if (event.key === "Delete" && view.selected_clip_ids.length > 0) {
      event.preventDefault();
      void run({ kind: "delete_clips", ids: view.selected_clip_ids, ripple: false });
    }
  };

  const split = () => {
    if (!selectedClip) return;
    void run({ kind: "split_clip", id: selectedClip.id, time_us: view.playhead_us });
  };

  const ripple = () => {
    if (view.selected_clip_ids.length === 0) return;
    const primary = trackOf(project, view.selected_clip_ids[0]);
    if (!primary || view.selected_clip_ids.some((id) => trackOf(project, id)?.id !== primary.id)) return;
    void run({ kind: "delete_clips", ids: view.selected_clip_ids, ripple: true });
  };

  const requestProxy = async () => {
    if (!props.onRequestProxy || !selectedClip) return;
    const source = project.sources.find((item) => item.id === selectedClip.source_id);
    const quality = proxyQualityValue(props.proxyQuality ?? 960);
    if (!source || quality === null) return;
    setBusy(true);
    setError(null);
    try {
      const lease = await props.onRequestProxy(source, quality);
      setProxyLease(lease);
      updateView({ proxy_preview: true });
    } catch (caught) {
      setError(timelineErrorCode(caught));
    } finally {
      setBusy(false);
    }
  };

  const commandActions: TimelineCommandActions = {
    // The app host owns creating/opening a project; those commands are left
    // out of this editor's local registry instead of calling an empty stub.
    newProject: () => undefined,
    editInTimeline: () => undefined,
    addVideoTrack: () => addTrack("video"),
    addAudioTrack: () => addTrack("audio"),
    split,
    ripple,
    toggleSnap: () => updateView({ snap_enabled: !view.snap_enabled }),
    openTransition: () => setTab("transitions"),
    openTitle: () => setTab("titles"),
    openEffects: () => setTab("effects"),
    openAudio: () => setTab("audio"),
    openSubtitles: () => setTab("subtitles"),
    openExport: () => setExportOpen(true),
  };
  const commandContext: TimelineCommandContext = {
    hasProject: true,
    canEditMedia: false,
    hasSelection: view.selected_clip_ids.length > 0,
    canSplit: Boolean(selectedClip),
    snapEnabled: view.snap_enabled,
    // The bounded review dialog opens and reports the verified encoder pack
    // state, but this build has no concrete graph executor: its Start action
    // stays disabled instead of claiming output that cannot be produced.
    canExportTimeline: true,
  };
  const commands = createTimelineCommands(commandActions).filter((command) =>
    EDITOR_COMMAND_IDS.has(command.id),
  );

  return (
    <div
      className="adp-timeline-editor"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => void finishDrag()}
      onPointerCancel={cancelDrag}
      aria-label={t("timeline.title")}
    >
      <div className="adp-timeline-main">
        <div className="adp-timeline-preview" ref={viewportRef}>
          <TimelinePreview
            project={project}
            playhead_us={view.playhead_us}
            active={active}
            label={t("timeline.previewLabel")}
            emptyLabel={t("timeline.previewEmpty")}
            proxy_url={proxyLease ? fileUrl(proxyLease.token, proxyLease.name) : undefined}
          />
          {preview === "proxy" ? <p className="adp-timeline-proxy-note">{t("timeline.proxy")}</p> : null}
        </div>
        <TimelineProperties
          project={project}
          clip={selectedClip}
          track={activeTrack}
          playhead_us={view.playhead_us}
          duration_us={duration}
          tab={tab}
          onTab={setTab}
          onSeek={(timeUs) => updateView({ playhead_us: timeUs })}
          onOperation={(operation) => void run(operation)}
          onApplyEffect={applyEffect}
          onAddTrack={addTrack}
          onOpenHelp={(slug) => props.onOpenHelp?.(slug)}
          selectedTitleId={selectedTitleId}
          selectedTransitionId={selectedTransitionId}
          clippingWarning={clippingWarning}
          waveformPage={wavePage}
          waveformLoading={waveLoading}
          waveformLabel={t("timeline.waveform")}
        />
      </div>
      <div className="adp-timeline-bottom">
        <div className="adp-timeline-transport" role="toolbar" aria-label={t("timeline.title")}>
          <IconButton
            icon={playing ? Pause : Play}
            labelKey={playing ? "media.pause" : "media.play"}
            onClick={togglePlay}
            disabled={duration <= 0}
            pressed={playing}
          />
          <label className="adp-timeline-zoom">
            <span>{t("timeline.zoom")}</span>
            <input
              type="range"
              min={1}
              max={1000}
              step={1}
              value={view.pixels_per_second}
              onChange={(event) => updateView({ pixels_per_second: Number(event.currentTarget.value) })}
              aria-label={t("timeline.zoom")}
            />
          </label>
          <label className="adp-timeline-scroll">
            <span>{t("timeline.scroll")}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, duration)}
              step={1000}
              value={Math.min(view.scroll_us, Math.max(0, duration))}
              onChange={(event) => updateView({ scroll_us: Number(event.currentTarget.value) })}
              aria-label={t("timeline.scroll")}
            />
          </label>
          {props.onRequestProxy ? (
            <button
              type="button"
              className="adp-btn adp-btn--subtle"
              onClick={() => void requestProxy()}
              disabled={!selectedClip || busy || props.proxyQuality === "source"}
            >
              {t("timeline.proxy")}
            </button>
          ) : null}
        </div>
        <div className="adp-timeline-commandbar" role="toolbar" aria-label={t("timeline.title")}>
          {commands.map((command) => (
            <IconButton
              key={command.id}
              icon={command.icon}
              labelKey={command.labelKey}
              onClick={() => command.run(commandContext)}
              disabled={!isCommandEnabled(command, commandContext) || busy}
              pressed={command.checkedWhen?.(commandContext)}
            />
          ))}
        </div>
        <TrackList
          project={project}
          selected_ids={selected}
          active_track_id={view.active_track_id}
          playhead_us={view.playhead_us}
          scroll_us={view.scroll_us}
          pixels_per_second={view.pixels_per_second}
          viewport_width={width}
          viewport_height={280}
          scroll_top={scrollTop}
          drag_clip_id={dragClipId}
          drag_start_us={dragStartUs}
          onScrollTop={setScrollTop}
          onSelectTrack={(trackId) => updateView({ active_track_id: trackId })}
          onSelectClip={selectClip}
          onSelectTransition={(transitionId) => {
            setSelectedTransitionId(transitionId);
            setTab("transitions");
          }}
          onSelectTitle={(titleId) => {
            setSelectedTitleId(titleId);
            setTab("titles");
          }}
          onClipPointerDown={onClipPointerDown}
          onToggleLock={(track) => void commitTrack(track.id, { locked: !track.locked })}
          onToggleVisible={(track) => void commitTrack(track.id, { visible: !track.visible })}
          onToggleMute={(track) => void commitTrack(track.id, { mute: !track.mute })}
          onMoveTrack={moveTrack}
        />
      </div>
      <div className="adp-timeline-statusbar" role="status">
        <span>{t("timeline.status", {
          tracks: project.tracks.length,
          clips: project.tracks.reduce((total, track) => total + track.clips.length, 0),
        })}</span>
        <span>
          {t("timeline.milliseconds", { value: Math.round(view.playhead_us / 1000) })}
        </span>
      </div>
      {exportOpen ? (
        <ExportTimelineDialog
          project={project}
          onClose={() => setExportOpen(false)}
          onOpenHelp={props.onOpenHelp}
        />
      ) : null}
      {error ? (
        <p className="adp-timeline-error" role="alert" data-code={error}>
          {t("errors.timeline.failed")}
        </p>
      ) : null}
    </div>
  );
}
