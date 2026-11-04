import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  PresentationDisplay, PresentationIntent, PresentationRequest, PresentationState,
} from "../office/presentationTypes";
import { isTauriRuntime } from "./settings";

/** Display-aware presentation (Step 22a E5, office-deck-ui-1).
 *
 * Native commands are main-window only: `ensure_main`, live display IDs and
 * a revalidated session/slide are checked there. This service never chooses
 * a monitor, a window handle or an engine command string. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function available(): void {
  if (!isTauriRuntime()) throw new Error("presentation.unsupported");
}

export function isPresentationDisplay(value: unknown): value is PresentationDisplay {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<PresentationDisplay>;
  const rect = item.rect;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 128 &&
    typeof item.name === "string" && item.name.length <= 128 &&
    typeof item.primary === "boolean" &&
    typeof rect === "object" && rect !== null &&
    [rect.left, rect.top, rect.width, rect.height]
      .every((part) => typeof part === "number" && Number.isSafeInteger(part)) &&
    rect.width > 0 && rect.height > 0;
}

export function isPresentationIntent(value: unknown): value is PresentationIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.kind === "go_to") return typeof item.slide_id === "string" && UUID.test(item.slide_id) && Object.keys(item).length === 2;
  return ["next", "previous", "first", "last", "end", "toggle_black", "toggle_pause", "reset_timer"]
    .includes(String(item.kind)) && Object.keys(item).length === 1;
}

function safe(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isPresentationState(value: unknown): value is PresentationState {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<PresentationState>;
  return typeof item.presentation_id === "string" && UUID.test(item.presentation_id) &&
    typeof item.session_id === "string" && UUID.test(item.session_id) &&
    typeof item.slide_id === "string" && UUID.test(item.slide_id) &&
    safe(item.slide_index, 0, 0xffffffff) && safe(item.slide_count, 0, 0xffffffff) &&
    safe(item.step_index, 0, 0xffffffff) && safe(item.elapsed_ms) &&
    typeof item.paused === "boolean" && typeof item.black === "boolean" &&
    typeof item.ended === "boolean" &&
    typeof item.output_display_id === "string" && item.output_display_id.length <= 128;
}

export function validatePresentationRequest(request: PresentationRequest): void {
  if (!request || typeof request !== "object") throw new Error("presentation.invalid");
  if (typeof request.slide_id !== "string" || !UUID.test(request.slide_id)) throw new Error("presentation.invalid");
  if (request.start_from !== "first" && request.start_from !== "current") throw new Error("presentation.invalid");
  if (typeof request.output_display_id !== "string" || request.output_display_id.length < 1 ||
      request.output_display_id.length > 128) throw new Error("presentation.invalid");
  if (request.presenter_display_id !== null &&
      (typeof request.presenter_display_id !== "string" || request.presenter_display_id.length > 128)) {
    throw new Error("presentation.invalid");
  }
  if (typeof request.show_presenter !== "boolean") throw new Error("presentation.invalid");
}

export async function presentationDisplays(): Promise<PresentationDisplay[]> {
  available();
  const list = (await invoke("office_presentation_displays")) as PresentationDisplay[];
  if (!Array.isArray(list) || list.length > 16 || !list.every(isPresentationDisplay)) {
    throw new Error("presentation.failed");
  }
  return list;
}

export async function startPresentation(
  sessionId: string,
  request: PresentationRequest,
): Promise<PresentationState> {
  available();
  if (!UUID.test(sessionId)) throw new Error("presentation.invalid");
  validatePresentationRequest(request);
  const state = (await invoke("office_presentation_start", { sessionId, request })) as PresentationState;
  if (!isPresentationState(state) || state.ended) throw new Error("presentation.failed");
  return state;
}

export async function presentationNavigate(
  presentationId: string,
  intent: PresentationIntent,
): Promise<PresentationState> {
  available();
  if (!UUID.test(presentationId) || !isPresentationIntent(intent)) throw new Error("presentation.invalid");
  const state = (await invoke("office_presentation_navigate", { presentationId, intent })) as PresentationState;
  if (!isPresentationState(state)) throw new Error("presentation.failed");
  return state;
}

export async function endPresentation(id: string): Promise<void> {
  available();
  if (!UUID.test(id)) throw new Error("presentation.invalid");
  await invoke("office_presentation_end", { presentationId: id });
}

/** Additive state event used by the presenter panel. The native worker emits
 * it after an audience intent is applied as well as after a main-window
 * command; the audience helper never listens to it. */
export function onPresentationState(
  listener: (state: PresentationState) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<PresentationState>("office-presentation-state", (event) => {
    if (isPresentationState(event.payload)) listener(event.payload);
  });
}

/** Additive display-loss event: the worker pauses the output and the main
 * presenter shows the chooser instead of pretending the window still works. */
export function onPresentationDisplayLost(
  listener: (presentationId: string) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<string>("office-presentation-display-lost", (event) => {
    if (typeof event.payload === "string" && UUID.test(event.payload)) listener(event.payload);
  });
}
