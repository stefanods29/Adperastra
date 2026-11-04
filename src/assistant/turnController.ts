/**
 * One assistant turn at a time (Step 17a T3, E4/E5).
 *
 * The controller owns no DOM and no timer: the panel calls `pollOnce` every
 * 100 ms while a turn runs. It guarantees a single in-flight turn, one Stop
 * click, and bounded screen-reader announcements of finished sentences.
 */

import type { JobHandle } from "../services/jobs";
import type {
  AssistantConversation,
  AssistantDraft,
  AssistantMessage,
  AssistantTurnRequest,
  AssistantTurnResult,
} from "./types";

export type TurnStatus = "idle" | "sending" | "streaming" | "done" | "stopped" | "failed";

export interface TurnState {
  status: TurnStatus;
  conversation: AssistantConversation | null;
  draft: AssistantDraft | null;
  errorCode: string | null;
  /** True once the 100 ms skeleton has elapsed. */
  slowHint: boolean;
  lastMessageId: string | null;
}

export interface TurnPorts {
  send(request: AssistantTurnRequest): Promise<JobHandle<AssistantTurnResult>>;
  stop(jobId: string): Promise<void>;
  messages(chatId: string, afterMessageId: string | null): Promise<AssistantMessage[]>;
  announce(text: string): void;
  now(): number;
}

export const EMPTY_TURN_STATE: TurnState = {
  status: "idle",
  conversation: null,
  draft: null,
  errorCode: null,
  slowHint: false,
  lastMessageId: null,
};

const ANNOUNCE_INTERVAL_MS = 2_000;

function errorCodeOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "assistant.failed";
}

function finishedSentence(text: string): string | null {
  const match = text.match(/^(.+?[.!?])\s/s);
  return match ? match[1] : null;
}

export class AssistantTurnController {
  private state: TurnState = { ...EMPTY_TURN_STATE };
  private handle: JobHandle<AssistantTurnResult> | null = null;
  private lastAnnounceAt = 0;
  private announced = new Set<string>();
  private readonly listeners = new Set<(state: TurnState) => void>();

  constructor(private readonly ports: TurnPorts) {}

  getState(): TurnState {
    return this.state;
  }

  subscribe(listener: (state: TurnState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<TurnState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  setConversation(conversation: AssistantConversation): void {
    this.setState({
      conversation,
      lastMessageId: conversation.messages.at(-1)?.id ?? null,
    });
  }

  /** Called once by the composer's Send. Returns false for a second send. */
  async begin(request: AssistantTurnRequest): Promise<boolean> {
    if (this.state.status === "sending" || this.state.status === "streaming") {
      return false;
    }
    this.setState({ status: "sending", errorCode: null, draft: null, slowHint: false });
    try {
      const handle = await this.ports.send(request);
      this.handle = handle;
      this.setState({ status: "streaming" });
      const result = await handle.completion;
      if (this.state.status === "stopped") return true;
      const conversation = this.state.conversation
        ? { ...this.state.conversation, revision: result.revision }
        : this.state.conversation;
      this.setState({
        status: "done",
        draft: result.draft,
        conversation,
        lastMessageId: result.chat_id ? this.state.lastMessageId : this.state.lastMessageId,
      });
      return true;
    } catch (error) {
      if (this.state.status === "stopped") return true;
      this.setState({ status: "failed", errorCode: errorCodeOf(error) });
      return true;
    } finally {
      this.handle = null;
    }
  }

  /** Stop is idempotent; the first click cancels the one active job. */
  async stop(): Promise<void> {
    const handle = this.handle;
    if (!handle || this.state.status === "stopped") return;
    this.setState({ status: "stopped" });
    try {
      await this.ports.stop(handle.id);
    } finally {
      await handle.cancel();
    }
  }

  /** Called by the panel's 100 ms interval. */
  async pollOnce(): Promise<void> {
    const conversation = this.state.conversation;
    if (!conversation || this.state.status !== "streaming") return;
    try {
      const messages = await this.ports.messages(conversation.id, this.state.lastMessageId);
      if (messages.length === 0) return;
      const last = messages.at(-1)!;
      this.setState({
        conversation: { ...conversation, messages: [...conversation.messages, ...messages] },
        lastMessageId: last.id,
      });
      this.announceFinished(last.plain_text);
    } catch (error) {
      this.setState({ status: "failed", errorCode: errorCodeOf(error) });
    }
  }

  /** At most one polite announcement per two seconds, never per token. */
  private announceFinished(text: string): void {
    const sentence = finishedSentence(text);
    if (!sentence || this.announced.has(sentence)) return;
    const now = this.ports.now();
    if (now - this.lastAnnounceAt < ANNOUNCE_INTERVAL_MS) return;
    this.announced.add(sentence);
    this.lastAnnounceAt = now;
    this.ports.announce(sentence);
  }

  /** The panel's 100 ms timer calls this once to reveal the loading words. */
  markSlowHint(): void {
    if (this.state.status === "sending" || this.state.status === "streaming") {
      this.setState({ slowHint: true });
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.handle = null;
  }
}
