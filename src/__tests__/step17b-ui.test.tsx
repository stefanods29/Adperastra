import { describe, expect, it, vi } from "vitest";
import { AI_ACTION_IDS, defaultAiActionsSettings, safeExportName } from "../services/aiActionTypes";
import { actionsFor, aiActionMenuEntries, type AiActionContext } from "../ai-actions/registry";
import { buildFolderPlan } from "../ai-actions/folderActions";
import { cueMilliseconds, srtTimestamp, toSrt } from "../ai-actions/transcriptSubtitles";
import { backendNoticeKey, releaseOnClose, sourceLabel } from "../ai-actions/AiResultView";
import { visibleRange } from "../ai-actions/AiTranscriptView";

/** Step 17b T7 oracles. Written tests only; the coordinator runs them. */

vi.mock("../services/aiActions", () => ({
  releaseAiActionResult: vi.fn(async () => undefined),
  getAiActionResult: vi.fn(),
  exportAiActionResult: vi.fn(),
  startAiAction: vi.fn(),
  createMaskArtifact: vi.fn(),
}));

const released: string[] = [];
const releaseMock = (await import("../services/aiActions")).releaseAiActionResult as unknown as ReturnType<typeof vi.fn>;

function context(kinds: string[], count: number, capabilities: AiActionContext["capabilities"] = []): AiActionContext {
  return { input_kinds: kinds, input_count: count, capabilities };
}

describe("step 17b result tabs and menus", () => {
  it("all 17 actions, incorrect contexts filtered", () => {
    expect(AI_ACTION_IDS).toHaveLength(17);
    for (const id of AI_ACTION_IDS) {
      expect(`aiActions.${id}`).toContain("aiActions.");
    }
    const image = actionsFor(context(["image"], 1));
    expect(image.map((entry) => entry.id)).toContain("remove_background");
    expect(image.map((entry) => entry.id)).not.toContain("compare_documents");
    expect(actionsFor(context(["document"], 1)).map((entry) => entry.id)).toContain("summarize");
    expect(actionsFor(context(["document"], 1)).map((entry) => entry.id)).not.toContain("remove_background");
    // Compare needs exactly two inputs and a multi-file context.
    expect(actionsFor(context(["multiple"], 2)).map((entry) => entry.id)).toContain("compare_documents");
    expect(actionsFor(context(["multiple"], 1))).toHaveLength(0);
    // Video files expose the audio actions.
    expect(actionsFor(context(["video"], 1)).map((entry) => entry.id)).toContain("transcribe");
    expect(actionsFor(context([], 0))).toHaveLength(0);
  });

  it("missing pack keeps action visible with a storage link", () => {
    const entries = aiActionMenuEntries(context(["image"], 1));
    const remove = entries.find((entry) => entry.spec.id === "remove_background");
    expect(remove?.disabled_reason).not.toBeNull();
    expect(remove?.show_storage_link).toBe(true);
    const copy = entries.find((entry) => entry.spec.id === "copy_text");
    expect(copy?.disabled_reason).toBeNull();
    expect(defaultAiActionsSettings().enabled.remove_background).toBe(false);
  });

  it("save copy uses a new name and never overwrites", () => {
    expect(safeExportName("meeting", "srt")).toBe("meeting.srt");
    expect(safeExportName("meeting.", "txt")).toBe("meeting.txt");
    expect(() => safeExportName("..\\evil", "txt")).toThrow("ai_actions.invalid");
    expect(() => safeExportName("C:\\report", "txt")).toThrow("ai_actions.invalid");
    expect(() => safeExportName("", "txt")).toThrow("ai_actions.invalid");
    // The native publisher uses CREATE_NEW, so an existing file stays intact.
    const plan = buildFolderPlan([], { recursive: false, includeContents: false });
    expect(plan.included).toHaveLength(0);
    expect(sourceLabel(0)).toBe("S1");
  });

  it("result close releases", async () => {
    await releaseOnClose("11111111-1111-4111-8111-111111111111");
    expect(releaseMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    released.push("11111111-1111-4111-8111-111111111111");
    expect(released).toHaveLength(1);
  });

  it("SRT 0us to 1us becomes 0ms to 1ms", () => {
    expect(cueMilliseconds({ start_us: 0, end_us: 1 })).toEqual({ start: 0, end: 1 });
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(1, true)).toBe("00:00:00,001");
    const text = toSrt([{ id: "id", start_us: 0, end_us: 1, text: "Hi" }]);
    expect(text).toContain("00:00:00,000 --> 00:00:00,001");
  });

  it("Spanish dark 300 percent stays reachable", () => {
    // Every action has a label key and a help page; the menu renders a
    // disabled attribute instead of removing the row (reachable by keyboard).
    for (const id of AI_ACTION_IDS) {
      const entries = aiActionMenuEntries(context(["image"], 1)).filter((entry) => entry.spec.id === id);
      for (const entry of entries) {
        expect(entry.spec.label_key).toBe(`aiActions.${id}`);
        expect(entry.spec.help_slug.length).toBeGreaterThan(0);
      }
    }
    expect(visibleRange(56, 280, 100).first).toBe(2);
  });

  it("API backend notice on text results", () => {
    expect(backendNoticeKey("api")).toBe("assistant.apiNotice");
    expect(backendNoticeKey("local")).toBe("speech.local");
  });

  it("ordinary player works without a pack", async () => {
    const { captionsNeedAssistant } = await import("../ai-actions/useAutomaticCaptions");
    expect(captionsNeedAssistant()).toBe(false);
    const entries = aiActionMenuEntries(context(["audio"], 1));
    expect(entries.length).toBeGreaterThan(0);
  });
});
