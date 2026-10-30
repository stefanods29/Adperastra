import { Music, Pause, Play, Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { fileGrant, fileRevoke, fileUrl } from "../../services/files";
import { formatSize } from "../../services/format";
import { mediaSidecars } from "../../services/media";
import { isTauriRuntime } from "../../services/settings";
import Ribbon from "../../ribbon/Ribbon";
import type { RibbonDef, RibbonGroup } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { decodeText, detectEncoding } from "../text/encoding";
import type { HandlerViewProps } from "../types";
import { formatDuration, isVideo, SPEEDS, subtitleLabel, toVtt } from "./helpers";

/** Largest subtitle file read. */
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const HELP = "playing-audio-and-video";

interface SavedMediaState {
  speed: number;
  loop: boolean;
}

interface MediaCtx {
  ready: boolean;
  playing: boolean;
  loop: boolean;
}

function readSaved(state: unknown): SavedMediaState {
  const value = (state ?? {}) as Partial<SavedMediaState>;
  return {
    speed: typeof value.speed === "number" && SPEEDS.includes(value.speed) ? value.speed : 1,
    loop: value.loop === true,
  };
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Read a subtitle file through a file token; returns a WebVTT Blob URL
 * (the caller revokes it). */
async function loadSubtitle(path: string): Promise<string> {
  const token = await fileGrant(path);
  try {
    const response = await fetch(fileUrl(token, nameOf(path)), { headers: { Range: `bytes=0-${MAX_SUBTITLE_BYTES - 1}` } });
    if (!response.ok) throw new Error("files.read_failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = decodeText(bytes, detectEncoding(bytes.subarray(0, 65536)).encoding);
    return URL.createObjectURL(new Blob([toVtt(nameOf(path), text)], { type: "text/vtt" }));
  } finally {
    void fileRevoke(token).catch(() => undefined);
  }
}

/** Audio and video player (Step 04c): the webview's own player and its
 * controls, plus a ribbon for play, loop, speed and subtitles. It keeps
 * playing while another tab is shown. */
export default function MediaView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const video = isVideo(info);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [settings, setSettings] = useState<SavedMediaState>(() => readSaved(savedState));
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noPicture, setNoPicture] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [sidecars, setSidecars] = useState<string[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [subtitleFailed, setSubtitleFailed] = useState(false);

  const update = useCallback(
    (patch: Partial<SavedMediaState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Speed and Loop follow the ribbon and the saved state.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = settings.speed;
    media.loop = settings.loop;
  }, [settings.speed, settings.loop, ready]);

  // The player gets the keyboard when it is first ready (Space plays).
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || !active || focused.current) return;
    focused.current = true;
    mediaRef.current?.focus({ preventScroll: true });
  }, [ready, active]);

  // Subtitle files next to a video.
  useEffect(() => {
    if (!video || !isTauriRuntime()) return;
    let cancelled = false;
    mediaSidecars(info.path)
      .then((paths) => {
        if (!cancelled) setSidecars(paths);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [video, info.path]);

  // Load the chosen subtitle file.
  useEffect(() => {
    if (!subtitle) {
      setTrackUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setSubtitleFailed(false);
    loadSubtitle(subtitle)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        created = blobUrl;
        setTrackUrl(blobUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setSubtitleFailed(true);
        setSubtitle("");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [subtitle]);

  // A track added after the video loaded is not shown by itself.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    for (const track of Array.from(media.textTracks)) track.mode = trackUrl ? "showing" : "disabled";
  }, [trackUrl]);

  // Status bar: length, kind, size.
  useEffect(() => {
    const items: string[] = [];
    if (duration !== null && Number.isFinite(duration)) items.push(formatDuration(duration));
    items.push(t(video ? "media.video" : "media.audio"));
    if (subtitleFailed) items.push(t("media.subtitlesFailed"));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [duration, video, subtitleFailed, info.size, i18n.language, onStatus, t]);

  const ctx: MediaCtx = { ready, playing, loop: settings.loop };
  const commands = useMemo<Command<MediaCtx>[]>(
    () => [
      {
        id: "media.play",
        labelKey: "media.play",
        icon: Play,
        risk: "read-only",
        helpSlug: HELP,
        visibleWhen: (c) => !c.playing,
        enabledWhen: (c) => c.ready,
        run: () => {
          void mediaRef.current?.play().catch(() => undefined);
        },
      },
      {
        id: "media.pause",
        labelKey: "media.pause",
        icon: Pause,
        risk: "read-only",
        helpSlug: HELP,
        visibleWhen: (c) => c.playing,
        enabledWhen: (c) => c.ready,
        run: () => mediaRef.current?.pause(),
      },
      {
        id: "media.loop",
        labelKey: "media.loop",
        icon: Repeat,
        risk: "read-only",
        helpSlug: HELP,
        checkKind: "toggle",
        checkedWhen: (c) => c.loop,
        enabledWhen: () => true,
        run: (c) => update({ loop: !c.loop }),
      },
    ],
    [update],
  );

  const groups: RibbonGroup[] = [
    {
      id: "playback",
      labelKey: "ribbon.playback",
      controls: [
        { type: "button", command: "media.play", keyTip: "P" },
        { type: "button", command: "media.pause", keyTip: "P" },
        { type: "toggle", command: "media.loop", keyTip: "L" },
      ],
    },
    {
      id: "speed",
      labelKey: "media.speed",
      controls: [
        {
          type: "custom",
          id: "speed",
          render: () => (
            <label className="adp-ribbon-custom">
              {t("media.speed")}
              <select value={String(settings.speed)} onChange={(event) => update({ speed: Number(event.target.value) })}>
                {SPEEDS.map((speed) => (
                  <option key={speed} value={String(speed)}>
                    {t("media.speedValue", { speed })}
                  </option>
                ))}
              </select>
            </label>
          ),
        },
      ],
    },
  ];
  if (video) {
    groups.push({
      id: "subtitles",
      labelKey: "media.subtitles",
      controls: [
        {
          type: "custom",
          id: "subtitles",
          render: () => (
            <label className="adp-ribbon-custom">
              {t("media.subtitles")}
              <select value={subtitle} disabled={sidecars.length === 0} onChange={(event) => setSubtitle(event.target.value)}>
                <option value="">{sidecars.length === 0 ? t("media.noSubtitles") : t("media.subtitlesOff")}</option>
                {sidecars.map((path) => (
                  <option key={path} value={path}>
                    {subtitleLabel(info.name, nameOf(path))}
                  </option>
                ))}
              </select>
            </label>
          ),
        },
      ],
    });
  }
  const ribbon: RibbonDef = { tabs: [{ id: "play", labelKey: "ribbon.play", keyTip: "P", groups }] };

  const events = {
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget;
      setReady(true);
      setDuration(media.duration);
      if (media instanceof HTMLVideoElement && media.videoWidth === 0) setNoPicture(true);
    },
    onError: () => setFailed(true),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("media.cantPlay")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : (
        <div className="adp-media">
          {noPicture ? (
            <div className="adp-media-notice" role="status">
              <span>{t("media.noPicture")}</span>
              <Button onClick={onOpenInWindowsApp}>{t("fileTab.openInWindowsApp")}</Button>
            </div>
          ) : null}
          {video ? (
            <video
              ref={(element) => {
                mediaRef.current = element;
              }}
              className="adp-media-video"
              src={url}
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              preload="metadata"
              {...events}
            >
              {trackUrl ? <track key={trackUrl} kind="subtitles" src={trackUrl} /> : null}
            </video>
          ) : (
            <div className="adp-media-audio">
              <Music size={64} aria-hidden="true" className="adp-media-icon" />
              <p className="adp-media-title">{info.name}</p>
              <audio
                ref={(element) => {
                  mediaRef.current = element;
                }}
                src={url}
                controls
                controlsList="nodownload noremoteplayback"
                preload="metadata"
                {...events}
              />
            </div>
          )}
        </div>
      )}
    </ViewerFrame>
  );
}
