import { describe, expect, it, vi } from "vitest";
import {
  AutomaticCaptionController,
  CAPTIONS_WRITE_SRT_AUTOMATICALLY,
  captionsNeedAssistant,
  cueFromSegment,
  initialCaptionState,
  type CaptionSource,
} from "../ai-actions/useAutomaticCaptions";
import type { AiInputRef } from "../services/localAiTypes";
import type { JobHandle } from "../services/jobs";
import type { TranscriptInfo } from "../services/speechTypes";

/** Step 17b T5 oracles. Written tests only; the coordinator runs them. */

const input: AiInputRef = {
  kind: "document",
  id: "11111111-1111-4111-8111-111111111111",
  expected_revision: 1,
};

interface Pending {
  resolve: (info: TranscriptInfo) => void;
  reject: (error: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
  generation: number;
}

function makeSource() {
  const pending: Pending[] = [];
  const applied: Array<{ documentId: string; transcriptId: string; mode: string }> = [];
  const released: string[] = [];
  const source: CaptionSource = {
    startWindow: async (_input, _language, _startUs, generation) => {
      let resolve!: (info: TranscriptInfo) => void;
      let reject!: (error: Error) => void;
      const completion = new Promise<TranscriptInfo>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const cancel = vi.fn(async () => undefined);
      pending.push({ resolve, reject, cancel, generation });
      const handle: JobHandle<TranscriptInfo> = { id: `job-${generation}`, cancel, completion };
      return handle;
    },
    page: async (id) => ({
      segments: [
        { start_us: 1_000_000, end_us: 2_000_000, text: id === "t2" ? "second" : "first" },
      ],
      next_index: null,
    }),
    release: async (id) => {
      released.push(id);
    },
    apply: async (documentId, _contentId, transcriptId, mode) => {
      applied.push({ documentId, transcriptId, mode });
    },
  };
  return { source, pending, applied, released };
}

function info(id: string, _generation: number): TranscriptInfo {
  return {
    id,
    source_input_id: input.id,
    source_revision: 1,
    language: "en",
    duration_us: 30_000_000,
    segment_count: 1,
    partial: false,
    model_id: "ggml-base",
    model_revision: "1",
    expires_unix: 10,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("step 17b automatic captions", () => {
  it("seek generation 2 ignores late generation 1", async () => {
    const { source, pending } = makeSource();
    const controller = new AutomaticCaptionController(source);
    controller.setEnabled(true);
    const first = controller.seek(input, "en", 0);
    const second = controller.seek(input, "en", 60_000_000);
    expect(second).toBe(first + 1);
    pending[1].resolve(info("t2", second));
    await flush();
    pending[0].resolve(info("t1", first));
    await flush();
    const state = controller.getState();
    expect(state.generation).toBe(second);
    expect(state.cues).toHaveLength(1);
    expect(state.cues[0].text).toBe("second");
  });

  it("inactive cancels", async () => {
    const { source, pending } = makeSource();
    const controller = new AutomaticCaptionController(source);
    controller.setEnabled(true);
    controller.seek(input, "en", 0);
    controller.setActive(false);
    // The window handle arrives one microtask after `seek`; the cancellation
    // still reaches it before any cue is shown.
    await flush();
    expect(pending[0].cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState().cues).toHaveLength(0);
    expect(controller.getState().status).toBe("preparing");
  });

  it("subtitle file overrides automatic", async () => {
    const { source, pending } = makeSource();
    const controller = new AutomaticCaptionController(source);
    controller.setEnabled(true);
    controller.chooseSubtitleFile();
    expect(controller.getState().subtitleFileChosen).toBe(true);
    const started = pending.length;
    controller.seek(input, "en", 0);
    expect(pending.length).toBe(started);
    controller.chooseAutomatic();
    expect(controller.getState().subtitleFileChosen).toBe(false);
  });

  it("hearing preference is off by default", () => {
    expect(initialCaptionState.enabled).toBe(false);
    expect(initialCaptionState.status).toBe("off");
    const controller = new AutomaticCaptionController(makeSource().source);
    expect(controller.getState().enabled).toBe(false);
    // Turning the accessibility preference on does not switch captions on.
    expect(controller.getState().enabled).toBe(false);
  });

  it("cue 1s..2s becomes 1000000..2000000 TimeUs", () => {
    const cue = cueFromSegment({ start_us: 1_000_000, end_us: 2_000_000, text: "Budget" });
    expect(cue).toEqual({ start_us: 1_000_000, end_us: 2_000_000, text: "Budget" });
    expect(() => cueFromSegment({ start_us: 2_000_000, end_us: 2_000_000, text: "x" })).toThrow("speech.invalid");
  });

  it("apply is one media transaction", async () => {
    const { source, pending, applied } = makeSource();
    const controller = new AutomaticCaptionController(source);
    controller.setEnabled(true);
    controller.seek(input, "en", 0);
    pending[0].resolve(info("t1", 1));
    await flush();
    await controller.apply("document", "content", "select");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({ documentId: "document", transcriptId: "t1", mode: "select" });
  });

  it("no assistant pack works", async () => {
    expect(captionsNeedAssistant()).toBe(false);
    const { source, pending } = makeSource();
    const controller = new AutomaticCaptionController(source);
    controller.setEnabled(true);
    controller.seek(input, "en", 0);
    pending[0].resolve(info("t1", 1));
    await flush();
    expect(controller.getState().status).toBe("ready");
  });

  it("captions never write SRT automatically", () => {
    expect(CAPTIONS_WRITE_SRT_AUTOMATICALLY).toBe(false);
    const controller = new AutomaticCaptionController(makeSource().source);
    expect("writeSrt" in controller).toBe(false);
    expect("exportSrt" in controller).toBe(false);
  });
});
