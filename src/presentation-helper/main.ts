import {
  onHelperRequest, sendHelperReply, type HelperOutputDTO,
} from "../services/helperBridge";
import {
  PRESENTATION_WAIT_MS, frameGrantOf, validateAudienceEnd, validateAudienceFrame,
  validateEndAck, validateWaitIntent, type PresentationAudienceFrame, type PresentationEndAck,
  type PresentationFrameAck, type PresentationIntentReply, type PresentationWaitIntentRequest,
} from "../services/presentationHelperTypes";
import { clearCanvas, paintFrame } from "./frames";
import {
  AudienceIntentQueue, intentFromKey, isPresentationAction, type PresentationHelperAction,
} from "./intents";

/** The audience helper's entry (Step 22a T7, D8).
 *
 * It owns exactly one canvas and one queue. The host sends at most one
 * request at a time: a frame, a short intent wait, or the end command. Only
 * the current rendered frame and the black/paused flags are displayed; notes,
 * presenter previews, paths and engine handles never reach this window. */

let canvas: HTMLCanvasElement | null = null;
let presentationId: string | null = null;
let busy = false;
let lastAcknowledged = 0;
let displayedRevision = -1;
let waiter: (() => void) | null = null;
const queue = new AudienceIntentQueue();

function canvasElement(): HTMLCanvasElement {
  if (!canvas) {
    const element = document.getElementById("presentation-canvas");
    if (!(element instanceof HTMLCanvasElement)) throw new Error("presentation.failed");
    canvas = element;
  }
  return canvas;
}

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^presentation\.[a-z_]+$/.test(message) ? message : "presentation.failed";
}

async function replyOk(requestId: string, payload: unknown, outputs: HelperOutputDTO[] = []): Promise<void> {
  await sendHelperReply({ status: "ok", protocol_version: 1, request_id: requestId, payload, outputs });
}

async function replyError(requestId: string, code: string): Promise<void> {
  await sendHelperReply({
    status: "error", protocol_version: 1, request_id: requestId, error_code: code.slice(0, 128),
  });
}

function wake(): void {
  const pending = waiter;
  waiter = null;
  pending?.();
}

async function handleFrame(requestId: string, payload: unknown, inputs: Parameters<typeof frameGrantOf>[0]): Promise<void> {
  if (!validateAudienceFrame(payload)) throw new Error("presentation.invalid");
  const frame: PresentationAudienceFrame = payload;
  if (presentationId !== null && presentationId !== frame.presentation_id) {
    throw new Error("presentation.invalid");
  }
  presentationId = frame.presentation_id;
  const grant = frameGrantOf(inputs, frame);
  if (!grant) throw new Error("presentation.failed");
  const revision = await paintFrame(canvasElement(), grant, frame);
  if (revision < displayedRevision) throw new Error("presentation.failed");
  displayedRevision = revision;
  const ack: PresentationFrameAck = {
    presentation_id: frame.presentation_id,
    frame_revision: frame.frame_revision,
    displayed: true,
  };
  await replyOk(requestId, ack);
}

function nextIntent(afterSequence: number): { sequence: number; intent: PresentationIntentReply["intent"] } | null {
  const found = queue.peek(afterSequence);
  return found ? { sequence: found.sequence, intent: found.intent } : null;
}

async function handleWait(requestId: string, payload: unknown): Promise<void> {
  if (!validateWaitIntent(payload)) throw new Error("presentation.invalid");
  const request: PresentationWaitIntentRequest = payload;
  if (presentationId !== null && presentationId !== request.presentation_id) {
    throw new Error("presentation.invalid");
  }
  presentationId = request.presentation_id;
  // Everything at or below the host's sequence is already consumed.
  queue.acknowledge(request.after_sequence);
  lastAcknowledged = Math.max(lastAcknowledged, request.after_sequence);
  let found = nextIntent(request.after_sequence);
  if (!found) {
    await new Promise<void>((resolve) => {
      waiter = resolve;
      window.setTimeout(() => {
        if (waiter === resolve) wake();
      }, PRESENTATION_WAIT_MS);
    });
    found = nextIntent(request.after_sequence);
  }
  const reply: PresentationIntentReply = {
    presentation_id: request.presentation_id,
    sequence: found ? found.sequence : Math.max(lastAcknowledged, request.after_sequence),
    intent: found ? found.intent : null,
  };
  await replyOk(requestId, reply);
}

async function handleEnd(requestId: string, payload: unknown): Promise<void> {
  if (!validateAudienceEnd(payload)) throw new Error("presentation.invalid");
  clearCanvas(canvas);
  canvas = null;
  presentationId = null;
  displayedRevision = -1;
  lastAcknowledged = 0;
  queue.clear();
  wake();
  const ack: PresentationEndAck = { presentation_id: payload.presentation_id, ended: true };
  if (!validateEndAck(ack)) throw new Error("presentation.failed");
  await replyOk(requestId, ack);
}

async function dispatch(action: PresentationHelperAction, requestId: string, payload: unknown, inputs: Parameters<typeof frameGrantOf>[0]): Promise<void> {
  if (busy) {
    await replyError(requestId, "helper.busy");
    return;
  }
  busy = true;
  try {
    if (action === "presentation.frame") await handleFrame(requestId, payload, inputs);
    else if (action === "presentation.wait_intent") await handleWait(requestId, payload);
    else await handleEnd(requestId, payload);
  } catch (error) {
    await replyError(requestId, codeOf(error));
  } finally {
    busy = false;
  }
}

/** Start listening. Only the three audience actions are accepted; any other
 * action or text/notes command is refused before it can reach a handler. */
export function startPresentationHelper(): Promise<void> {
  const seen = new Set<string>();
  return onHelperRequest<unknown>({
    action: isPresentationAction,
    handler: (request) => {
      if (seen.has(request.request_id)) return;
      seen.add(request.request_id);
      if (seen.size > 64) seen.delete(seen.values().next().value as string);
      void dispatch(request.action as PresentationHelperAction, request.request_id, request.payload, request.inputs);
    },
  }).then(() => undefined);
}

window.addEventListener("keydown", (event) => {
  if (!presentationId) return;
  const intent = intentFromKey(event.key, {
    ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey,
  });
  if (!intent) return;
  event.preventDefault();
  const sequence = queue.push(intent);
  if (sequence !== null) wake();
});

void startPresentationHelper();
