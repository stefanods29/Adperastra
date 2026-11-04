import { Crop, FolderOpen, Pause, Play, Redo2, Save, Scissors, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import IconButton from "../components/IconButton";
import ProgressBar from "../components/ProgressBar";
import Skeleton from "../components/Skeleton";
import type { Command } from "../commands/registry";
import type { ConversionReport } from "../convert/types";
import type { VirtualViewProps } from "../documents/types";
import type { JobHandle } from "../services/jobs";
import { archivePickFolder } from "../services/archive";
import { capabilityAvailable, engineCapabilities } from "../services/engines";
import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import { formatSize } from "../services/format";
import type { MediaInfo } from "../services/mediaEngine";
import { buildMediaExportRequest, defaultMediaConverterId, exportMediaRecipe } from "../services/mediaEdit";
import { loadSettings, type MediaEditorSettings } from "../services/settings";
import Ribbon from "../ribbon/Ribbon";
import type { RibbonDef, RibbonGroup } from "../ribbon/types";
import ViewerFrame from "../ribbon/ViewerFrame";
import { createMediaEditCommands, type MediaEditContext } from "./commands";
import type { MediaEditController } from "./MediaDocument";
import { saveMediaDraftRecipe } from "./MediaDraft";
import { rotateWithin } from "./operations";
import MediaProperties from "./MediaProperties";
import { recipeViewStateCodec } from "./recipeCodec";
import { cuesToVtt } from "./subtitles";
import Waveform from "./Waveform";
import type { MediaRecipe } from "./types";
import { isMediaCancellation } from "./types";
import {
  formatTimeUs,
  outputToSource,
  removeRange,
  splitSegments,
  trimSegments,
} from "./timing";
import { useMediaPreview, useMediaProxy } from "./useMediaPreview";

const HELP = "media-trimming";

export interface MediaEditorBodyProps {
  document: VirtualViewProps["document"];
  controller: MediaEditController;
  recipe: MediaRecipe;
  active: boolean;
  sourceUrl: string;
  sourceInfo: MediaInfo | null;
  durationUs: number;
  errorCode: string;
  exporting: JobHandle<ConversionReport> | null;
  savedState: unknown;
  onStateChange: (state: unknown) => void;
  onStatus: VirtualViewProps["onStatus"];
  onError: (code: string) => void;
  onExporting: (job: JobHandle<ConversionReport> | null) => void;
  onRelink: () => void;
}

/** The editor stage, transport, properties and ribbon (`T2`). */
export default function MediaEditorBody({
  document,
  controller,
  recipe,
  active,
  sourceUrl,
  sourceInfo,
  durationUs,
  errorCode,
  exporting,
  savedState,
  onStateChange,
  onStatus,
  onError,
  onExporting,
  onRelink,
}: MediaEditorBodyProps) {
  const { t, i18n } = useTranslation();
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const mediaRef = useCallback((element: HTMLMediaElement | null) => setMedia(element), []);
  const preview = useMediaPreview({ recipe, active, media });
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [settings, setSettings] = useState<Pick<MediaEditorSettings, "preview_quality" | "waveform">>({
    preview_quality: "source",
    // Until the saved preference is read, do not start a native waveform job
    // the user may have turned off.
    waveform: false,
  });
  // `null` while the native capability list is loading; export stays
  // unavailable until the media engine reports a verified encoder.
  const [mediaPack, setMediaPack] = useState<boolean | null>(null);
  const [editable, setEditable] = useState(() => document.getState().editing_enabled !== false);
  const source = recipe.sources[0];
  const video = Boolean(source && source.video_rate !== null);
  const proxyUrl = useMediaProxy({
    source: source ?? null,
    quality: settings.preview_quality,
    // No proxy request without a verified media pack: the source is the
    // fallback and the command would only fail closed.
    active: active && mediaPack === true,
  });
  // An optional proxy may replace the original only before the player has
  // read metadata: a later swap would restart playback. The source is always
  // the fallback and needs no pack.
  const playbackUrl = proxyUrl && (!media || media.readyState === 0) ? proxyUrl : sourceUrl;
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const controlsActive = active && editable;
  const sourceSize = useMemo(() => {
    const stream = sourceInfo?.streams.find((entry) => entry.kind === "video" && entry.width && entry.height);
    if (!stream || !stream.width || !stream.height) return null;
    return { width: stream.width, height: stream.height };
  }, [sourceInfo]);

  useEffect(() => {
    const only = recipe.segments.length === 1 ? recipe.segments[0] : null;
    // Recipe cues live on the output timeline. Until the output is mapped
    // back segment by segment, only an untrimmed source has identical times:
    // showing shifted cues would be a fake preview.
    const wholeSource =
      only !== null &&
      only.start_us === 0 &&
      only.end_us === (source?.duration_us ?? -1) &&
      only.speed === 1;
    if (!wholeSource || recipe.subtitle_mode === "off" || recipe.subtitles.length === 0) {
      setSubtitleUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([cuesToVtt(recipe.subtitles)], { type: "text/vtt" }));
    setSubtitleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recipe.segments, recipe.subtitle_mode, recipe.subtitles, source?.duration_us]);

  useEffect(() => {
    const unsubscribe = document.subscribe((state) => setEditable(state.editing_enabled !== false));
    return unsubscribe;
  }, [document]);

  useEffect(() => {
    let cancelled = false;
    void loadSettings()
      .then((saved) => {
        if (cancelled) return;
        setSettings({
          preview_quality: saved.media_editor.preview_quality,
          waveform: saved.media_editor.waveform,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void engineCapabilities()
      .then((capabilities) => {
        if (!cancelled) setMediaPack(capabilityAvailable(capabilities, "media.encode"));
      })
      .catch(() => {
        if (!cancelled) setMediaPack(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    // Closing the tab cancels its export; a finished job ignores this.
    void exporting?.cancel();
  }, [exporting]);

  useEffect(() => {
    if (!media) return;
    const initial = recipeViewStateCodec.decode(savedState);
    if (initial.position_us > 0) preview.seekOutput(Math.min(initial.position_us, durationUs));
    // The player element exists only after its ref callback has rendered;
    // restore once then, not before `media` is available.
  }, [document, media]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onStateChange({
        version: 1,
        position_us: preview.positionUs,
        selected_segment_id: null,
        active_source_id: source?.id ?? null,
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [onStateChange, preview.positionUs, source?.id]);

  useEffect(() => {
    onStatus({
      items: [
        formatTimeUs(durationUs),
        t("mediaEdit.edit"),
        source ? formatSize(source.stamp.size_bytes, i18n.language) : "",
        mediaPack === false ? t("errors.engines.pack_missing") : "",
      ].filter(Boolean),
    });
  }, [durationUs, i18n.language, mediaPack, onStatus, source, t]);

  const apply = useCallback(
    async (operation: Parameters<MediaEditController["apply"]>[0]) => {
      try {
        await controller.apply(operation);
        onError("");
      } catch (error) {
        onError(error instanceof Error ? error.message : "media_edit.failed");
      }
    },
    [controller, onError],
  );

  const startExport = async (converterId: string) => {
    if (mediaPack !== true) {
      onError("engines.pack_missing");
      return;
    }
    let snapshot: ExportSnapshot | null = null;
    try {
      const destDir = await archivePickFolder(t("convert.chooseFolder"));
      if (!destDir) return;
      const state = document.getState();
      // An export only needs the immutable recipe bytes, never the live
      // document authority: use the export capture path.
      const captured = await controller.captureForExport(state.revision, state.content_id);
      snapshot = captured;
      const request = buildMediaExportRequest(recipe, captured, { destDir, converterId });
      const job = await exportMediaRecipe(captured, request);
      onExporting(job);
      try {
        await job.completion;
        onError("");
      } finally {
        onExporting(null);
      }
    } catch (error) {
      // Cancel is not a failure and gets no error banner.
      if (!isMediaCancellation(error)) {
        onError(error instanceof Error ? error.message : "media_edit.failed");
      }
    } finally {
      if (snapshot) void releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    }
  };

  const actions = useMemo(
    () => ({
      trim: () => {
        if (selection) void apply({ kind: "set_segments", segments: trimSegments(recipe, selection.start, selection.end) });
      },
      cut: () => {
        if (selection) void apply({ kind: "set_segments", segments: removeRange(recipe, selection.start, selection.end) });
      },
      split: () => {
        const mapped = outputToSource(recipe, preview.positionUs);
        void apply({ kind: "set_segments", segments: splitSegments(recipe, mapped.source_us) });
      },
      extractAudio: () => {
        if (source) void startExport("media/audio");
      },
      crop: () => {
        if (!sourceSize) onError("media_edit.unsupported");
      },
      rotate: () => {
        const next = ((recipe.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        try {
          if (recipe.crop !== null) {
            if (!sourceSize) {
              onError("media_edit.unsupported");
              return;
            }
            rotateWithin(recipe, next, sourceSize.width, sourceSize.height);
          }
          void apply({ kind: "set_rotation", rotation: next });
        } catch (error) {
          onError(error instanceof Error ? error.message : "media_edit.bad_request");
        }
      },
      exportMedia: () => startExport(defaultMediaConverterId(recipe)),
    }),
    // The closures intentionally read the newest recipe/selection.
    [apply, durationUs, mediaPack, onError, preview.positionUs, recipe, selection, source, sourceSize],
  );

  const commands: Command<MediaEditContext>[] = useMemo(() => {
    const base = createMediaEditCommands(actions);
    return [
      ...base,
      {
        id: "media.play", labelKey: "media.play", icon: Play, risk: "read-only", helpSlug: HELP,
        enabledWhen: (ctx) => ctx.ready && !preview.playing, run: () => preview.toggle(),
      },
      {
        id: "media.pause", labelKey: "media.pause", icon: Pause, risk: "read-only", helpSlug: HELP,
        enabledWhen: (ctx) => ctx.ready && preview.playing, run: () => preview.pause(),
      },
      {
        id: "media.undo", labelKey: "commands.undo", icon: Undo2, risk: "change", helpSlug: HELP,
        enabledWhen: (ctx) => ctx.editable && ctx.canUndo, run: () => void controller.undo(),
      },
      {
        id: "media.redo", labelKey: "commands.redo", icon: Redo2, risk: "change", helpSlug: HELP,
        enabledWhen: (ctx) => ctx.editable && ctx.canRedo, run: () => void controller.redo(),
      },
      {
        id: "media.save", labelKey: "mediaEdit.saveRecipe", icon: Save, risk: "change", helpSlug: HELP,
        enabledWhen: (ctx) => ctx.editable,
        run: () => {
          // A draft has no native document authority: its first Save picks a
          // new `.admedia` file, later saves replace only that file.
          const write = document.source.kind === "draft"
            ? saveMediaDraftRecipe(document)
            : document.save();
          void write.catch((error: unknown) =>
            onError(error instanceof Error ? error.message : "media_edit.failed"),
          );
        },
      },
    ];
  }, [actions, controller, document, onError, preview]);

  const groups: RibbonGroup[] = [
    {
      id: "playback", labelKey: "ribbon.playback",
      controls: [
        { type: "button", command: "media.play", keyTip: "P" },
        { type: "button", command: "media.pause", keyTip: "P" },
        { type: "button", command: "media.undo", keyTip: "U" },
        { type: "button", command: "media.redo", keyTip: "R" },
      ],
    },
    {
      id: "edit", labelKey: "mediaEdit.trim",
      controls: [
        { type: "button", command: "media.trim" },
        { type: "button", command: "media.cut" },
        { type: "button", command: "media.split" },
        { type: "button", command: "media.extract" },
        { type: "button", command: "media.crop" },
        { type: "button", command: "media.rotate" },
      ],
    },
    { id: "export", labelKey: "mediaEdit.export", controls: [{ type: "button", command: "media.export" }] },
  ];
  const def: RibbonDef = {
    tabs: [
      { id: "home", labelKey: "explorer.homeLocation", keyTip: "H", groups: [groups[0], groups[2]] },
      { id: "edit", labelKey: "editor.edit", keyTip: "E", groups: [groups[1]] },
      { id: "export", labelKey: "mediaEdit.exportShort", keyTip: "X", groups: [groups[2]] },
    ],
  };
  const context: MediaEditContext = {
    ready: Boolean(media) || sourceUrl.length > 0,
    editable: controlsActive,
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
    hasSelection: selection !== null,
    hasVideo: Boolean(video),
    canExport: exporting === null && mediaPack === true,
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={def} ctx={context} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-media-editor">
        <nav className="adp-media-rail" aria-label={t("mediaEdit.edit")}>
          <IconButton icon={Play} labelKey="media.play" onClick={() => preview.toggle()} />
          <IconButton icon={Scissors} labelKey="mediaEdit.cut" onClick={actions.cut} disabled={!selection || !controlsActive} />
          <IconButton icon={Crop} labelKey="mediaEdit.crop" onClick={actions.crop} disabled={!sourceSize || !controlsActive} />
          <IconButton icon={FolderOpen} labelKey="mediaEdit.relink" onClick={onRelink} disabled={!editable} />
        </nav>
        <div className="adp-media-stage">
          {playbackUrl ? (
            video ? (
              <video ref={mediaRef} className="adp-media-player" src={playbackUrl} controls
                controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback preload="metadata">
                {subtitleUrl ? <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} default /> : null}
              </video>
            ) : (
              <audio ref={mediaRef} className="adp-media-player" src={playbackUrl} controls preload="metadata" />
            )
          ) : (
            <Skeleton variant="rows" count={2} />
          )}
          <div className="adp-media-transport">
            <IconButton icon={preview.playing ? Pause : Play} labelKey={preview.playing ? "media.pause" : "media.play"} onClick={preview.toggle} />
            <span>{formatTimeUs(preview.positionUs)} / {formatTimeUs(durationUs)}</span>
            {exporting ? (
              <>
                <ProgressBar label={t("jobs.converting", { count: 1 })} />
                <Button onClick={() => void exporting.cancel()}>{t("common.cancel")}</Button>
              </>
            ) : null}
          </div>
          {source && settings.waveform ? (
            <Waveform source={source} durationUs={durationUs} positionUs={preview.positionUs} active={controlsActive} onSeek={preview.seekOutput} />
          ) : null}
        </div>
        <MediaProperties recipe={recipe} active={controlsActive} canExport={mediaPack === true} sourceSize={sourceSize}
          onApply={apply} onRangeChange={setSelection} onError={onError} />
        {errorCode ? (
          <p className="adp-media-error" role="alert" title={errorCode}>
            {errorCode === "engines.pack_missing" ? t("errors.engines.pack_missing") : t("errors.media_edit.failed")}
          </p>
        ) : null}
      </div>
    </ViewerFrame>
  );
}
