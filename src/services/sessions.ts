import { invoke } from "@tauri-apps/api/core";
import { sessionWritesBlocked } from "./sessionValidation";
import type { SessionData } from "./tabs";

/** Session persistence (Step 09a E5). The native endpoints keep their
 * existing names (`get_session` / `save_session`); writes are debounced
 * 500 ms and flushed on a clean close after the dirty decision. */

export async function loadSession(): Promise<SessionData | null> {
  const data = (await invoke("get_session")) as SessionData | null;
  return data ?? null;
}

/** Step 09h: report the first successful paint/session restore. The native
 * handshake is idempotent, so a webview reload may ask again without
 * downgrading the launch marker. */
export async function startupReady(): Promise<void> {
  await invoke("startup_ready");
}

export async function saveSession(data: SessionData): Promise<void> {
  if (sessionWritesBlocked()) throw new Error("tabs.invalid_state");
  await invoke("save_session", { session: data });
}

export interface SessionSaver {
  schedule(data: SessionData): void;
  flush(): Promise<void>;
  cancel(): void;
}

/** A 500 ms debounced saver. `flush` writes the latest scheduled state at
 * once (clean close); `cancel` drops a pending write (the state changed
 * hands). A failed write keeps the pending state so the next schedule or
 * flush retries it. */
export function createSessionSaver(
  write: (data: SessionData) => Promise<void> = saveSession,
  delayMs = 500,
): SessionSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SessionData | null = null;
  const run = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (sessionWritesBlocked()) return;
    const data = pending;
    if (!data) return;
    pending = null;
    try {
      await write(data);
    } catch {
      pending = data;
    }
  };
  return {
    schedule(data) {
      if (sessionWritesBlocked()) return;
      pending = data;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
