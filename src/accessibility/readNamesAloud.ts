import type { AccessibilitySettings } from "../services/accessibility";
import {
  readSpeechChunk,
  speechChunkUrl,
  startReadAloud,
  stopReadAloud,
  type SpeechSession,
} from "../services/readAloud";

/** Background read-aloud for selected display names (Step 10f D6). The
 * command has no toolbar of its own: chunks are short and local, Stop at
 * the native session is the only control. Text is captured once at Start;
 * an edit of the selection never changes what is being spoken. */
export class ReadNamesAloud {
  private readonly settings: () => AccessibilitySettings;
  private session: SpeechSession | null = null;
  private audio: HTMLAudioElement | null = null;
  private token = 0;

  constructor(settings: () => AccessibilitySettings) {
    this.settings = settings;
  }

  get reading(): boolean {
    return this.session !== null;
  }

  /** Starts a new reading, ending any previous one first. */
  async read(text: string): Promise<void> {
    await this.stop();
    const token = ++this.token;
    const current = this.settings();
    const session = await startReadAloud({
      text,
      voice_id: current.read_voice_id,
      sensitive: false,
    });
    if (token !== this.token) {
      await stopReadAloud(session.session_id).catch(() => undefined);
      return;
    }
    this.session = session;
    try {
      await this.play(session, 0, token);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** Stops immediately; the native stop revokes every queued chunk. */
  async stop(): Promise<void> {
    this.token += 1;
    const session = this.session;
    this.session = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    if (session) await stopReadAloud(session.session_id).catch(() => undefined);
  }

  private async play(session: SpeechSession, sequence: number, token: number): Promise<void> {
    const chunk = await readSpeechChunk(session.session_id, sequence);
    if (token !== this.token) return;
    const audio = new Audio(speechChunkUrl(chunk));
    this.audio = audio;
    const current = this.settings();
    audio.playbackRate = current.read_rate;
    audio.volume = current.read_volume;
    await audio.play();
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("read_aloud.failed"));
    });
    if (token !== this.token) return;
    if (!chunk.end && sequence + 1 < session.chunk_count) {
      await this.play(session, sequence + 1, token);
      return;
    }
    await this.stop();
  }
}

export default ReadNamesAloud;
