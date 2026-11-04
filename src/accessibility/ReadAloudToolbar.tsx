import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  readSpeechChunk,
  speechChunkUrl,
  startReadAloud,
  stopReadAloud,
  type SpeechSession,
} from "../services/readAloud";
import { errorText } from "../services/errors";
import { defaultAccessibilitySettings } from "../services/accessibility";
import { useAccessibilityOptional } from "./AccessibilityContext";

/** Read-aloud controls (Step 10f T4). Playback is local: each chunk is a
 * memory grant played through its file URL, Pause only pauses the element
 * (chunk memory is kept), and Stop ends the session and revokes every
 * queued chunk. Rate and volume are frontend playback settings. */

export interface ReadAloudToolbarProps {
  /** Plain text captured once when reading starts. A function is resolved
   * at each Start, so a view can read its current selection. For file names
   * this is the selected display names, never file contents. */
  text: string | (() => string);
  documentId?: string;
  sourceRevision?: number;
  sensitive: boolean;
}

export default function ReadAloudToolbar({
  text,
  documentId,
  sourceRevision,
  sensitive,
}: ReadAloudToolbarProps) {
  const { t } = useTranslation();
  // The app always provides the effective state; a standalone preview keeps
  // the documented defaults instead of failing to render.
  const accessibility = useAccessibilityOptional();
  const readSettings = accessibility?.settings ?? defaultAccessibilitySettings();
  const [session, setSession] = useState<SpeechSession | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  const busyRef = useRef(false);
  // Invalidates a Start whose native session arrives after Stop/unmount.
  const startToken = useRef(0);

  const applyPlaybackSettings = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = readSettings.read_rate;
    audio.volume = readSettings.read_volume;
  };

  const playChunk = async (active: SpeechSession, sequence: number) => {
    const chunk = await readSpeechChunk(active.session_id, sequence);
    const audio = audioRef.current;
    if (!audio || sessionRef.current?.session_id !== active.session_id) return;
    audio.src = speechChunkUrl(chunk);
    applyPlaybackSettings();
    setSession({ ...active, next_sequence: sequence, state: "playing" });
    await audio.play();
    setPlaying(true);
  };

  const start = async () => {
    // A second Start while the first chunk is synthesizing would open a
    // second native session whose grants the first reference would lose.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const token = ++startToken.current;
    try {
      const captured = typeof text === "function" ? text() : text;
      const created = await startReadAloud({
        text: captured,
        voice_id: readSettings.read_voice_id,
        document_id: documentId,
        source_revision: sourceRevision,
        sensitive,
      });
      if (token !== startToken.current) {
        void stopReadAloud(created.session_id).catch(() => undefined);
        return;
      }
      sessionRef.current = created;
      setSession(created);
      await playChunk(created, 0);
    } catch (error) {
      setMessage(errorText(t, error, "read_aloud"));
      // Never leave a half-started session (and its text) behind.
      await stop();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setSession((current) => (current ? { ...current, state: "paused" } : current));
  };

  const resume = async () => {
    try {
      applyPlaybackSettings();
      await audioRef.current?.play();
      setPlaying(true);
      setSession((current) => (current ? { ...current, state: "playing" } : current));
    } catch (error) {
      setMessage(errorText(t, error, "read_aloud"));
      await stop();
    }
  };

  const stop = async () => {
    startToken.current += 1;
    const active = sessionRef.current;
    sessionRef.current = null;
    audioRef.current?.pause();
    audioRef.current?.removeAttribute("src");
    setPlaying(false);
    setSession(null);
    if (active) {
      try {
        await stopReadAloud(active.session_id);
      } catch {
        // The session is already gone locally; native expiry cleans up.
      }
    }
  };

  const onEnded = () => {
    const active = sessionRef.current;
    if (!active) return;
    const next = (session?.next_sequence ?? 0) + 1;
    if (next >= active.chunk_count) {
      void stop();
      return;
    }
    playChunk(active, next).catch((error: unknown) => {
      setMessage(errorText(t, error, "read_aloud"));
      setPlaying(false);
      void stop();
    });
  };

  // Leaving the view stops reading and revokes the session's grants (P-28).
  useEffect(
    () => () => {
      startToken.current += 1;
      const active = sessionRef.current;
      sessionRef.current = null;
      if (active) void stopReadAloud(active.session_id).catch(() => undefined);
    },
    [],
  );

  return (
    <div
      className="adp-accessibility-toolbar"
      role="group"
      aria-label={t("accessibility.read")}
      aria-busy={busy}
    >
      <audio ref={audioRef} onEnded={onEnded} preload="auto" />
      {session === null || !playing ? (
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={session ? t("accessibility.resume") : t("accessibility.read")}
          title={session ? t("accessibility.resume") : t("accessibility.read")}
          disabled={busy}
          onClick={() => void (session ? resume() : start())}
        >
          <Play size={16} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("accessibility.pause")}
          title={t("accessibility.pause")}
          onClick={pause}
        >
          <Pause size={16} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="adp-icon-btn"
        aria-label={t("accessibility.stop")}
        title={t("accessibility.stop")}
        disabled={session === null}
        onClick={() => void stop()}
      >
        <Square size={16} aria-hidden="true" />
      </button>
      <span className="adp-note">{t("accessibility.installedOnly")}</span>
      {message ? (
        <span role="alert" className="adp-note">
          {message}
        </span>
      ) : null}
    </div>
  );
}
