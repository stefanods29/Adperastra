/** Windows activation service (Step 09c E4; Step 16 D3 intent extension).
 * The native side owns the per-user pipe and the bounded queue; this module
 * only validates what arrives, delivers each `request_id` at most once
 * (bounded 256 ids per ten minutes) and exposes the one-shot ready
 * handshake. The optional fixed intent is carried as data: converting still
 * means opening the review, never converting before the user confirms.
 * Paths are still opened later through `planOpen`, never here. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isAbsolutePath, isUuid } from "../documents/types";
import { isTauriRuntime } from "./settings";

export const ACTIVATION_OPEN_EVENT = "activation-open";
export const MAX_ACTIVATION_PATHS = 256;

const DEDUPE_CAPACITY = 256;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface ActivationRequest {
  readonly version: 1;
  readonly request_id: string;
  readonly paths: readonly string[];
  readonly sent_unix: number;
  /** Fixed Explorer verb; absent keeps the pre-Step-16 open behavior. */
  readonly intent?: "open" | "convert";
}

const seen: { id: string; at: number }[] = [];

/** True the first time an id is seen inside the window; keeps a repeated
 * pipe delivery from opening the same files twice. */
function remember(requestId: string): boolean {
  const now = Date.now();
  while (seen.length > 0 && now - seen[0].at > DEDUPE_WINDOW_MS) seen.shift();
  if (seen.some((entry) => entry.id === requestId)) return false;
  seen.push({ id: requestId, at: now });
  while (seen.length > DEDUPE_CAPACITY) seen.shift();
  return true;
}

function parseActivationRequest(value: unknown): ActivationRequest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasIntent = Object.prototype.hasOwnProperty.call(candidate, "intent");
  if (Object.keys(candidate).length !== (hasIntent ? 5 : 4)) return null;
  if (candidate.version !== 1) return null;
  if (typeof candidate.request_id !== "string" || !isUuid(candidate.request_id)) {
    return null;
  }
  if (
    !Array.isArray(candidate.paths) ||
    candidate.paths.length < 1 ||
    candidate.paths.length > MAX_ACTIVATION_PATHS
  ) {
    return null;
  }
  if (!candidate.paths.every((path) => isAbsolutePath(path))) return null;
  if (
    typeof candidate.sent_unix !== "number" ||
    !Number.isSafeInteger(candidate.sent_unix) ||
    candidate.sent_unix < 0
  ) {
    return null;
  }
  if (hasIntent && candidate.intent !== "open" && candidate.intent !== "convert") {
    return null;
  }
  return Object.freeze({
    version: 1 as const,
    request_id: candidate.request_id,
    paths: Object.freeze([...candidate.paths]) as readonly string[],
    sent_unix: candidate.sent_unix,
    ...(hasIntent ? { intent: candidate.intent as "open" | "convert" } : {}),
  });
}

/** Subscribe to `activation-open`. Install this before calling
 * `activationReady`, so nothing queued during startup is lost. */
export async function onOpenRequest(
  listener: (request: ActivationRequest) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<unknown>(ACTIVATION_OPEN_EVENT, (event) => {
    const request = parseActivationRequest(event.payload);
    if (request && remember(request.request_id)) listener(request);
  });
}

/** Install the native ready flag and drain requests the starting window
 * missed. Each request is returned (and later events delivered) once. */
export async function activationReady(): Promise<ActivationRequest[]> {
  if (!isTauriRuntime()) return [];
  const response = await invoke<unknown>("activation_ready");
  if (!Array.isArray(response)) return [];
  const fresh: ActivationRequest[] = [];
  for (const value of response) {
    const request = parseActivationRequest(value);
    if (request && remember(request.request_id)) fresh.push(request);
  }
  return fresh;
}
