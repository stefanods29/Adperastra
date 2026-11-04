import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_TOOL_SPECS,
  AssistantToolRegistry,
  capabilitiesForScope,
} from "../assistant/toolRegistry";
import { parseAssistantToolArguments } from "../assistant/toolSchemas";
import {
  ASSISTANT_TOOL_IDS,
  type AssistantCommandAdapter,
  type AssistantDraft,
  type AssistantToolArguments,
  type AssistantToolResult,
  type AssistantToolSpec,
} from "../assistant/types";

const CHAT = "11111111-1111-4111-8111-111111111111";
const SCOPE = "22222222-2222-4222-8222-222222222222";
const INPUT = "33333333-3333-4333-8333-333333333333";
const ROOT = "44444444-4444-4444-8444-444444444444";

function spec(toolId: AssistantToolSpec["tool_id"]): AssistantToolSpec {
  return { ...ASSISTANT_TOOL_SPECS.find((row) => row.tool_id === toolId)! };
}

function draftFor(args: AssistantToolArguments): AssistantDraft {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    chat_id: CHAT,
    revision: 1,
    operation: args as AssistantDraft["operation"],
    source_ids: [],
    preview_rows: [
      {
        input_id: null,
        source_label: "Selected folder",
        destination_label: "notes.txt",
        before_excerpt: null,
        after_excerpt: String((args as { content?: string }).content ?? ""),
        operation_key: args.tool_id,
      },
    ],
    warnings: [],
    accepted_warning_codes: [],
    accepted_losses: [],
    draft_sha256: "a".repeat(64),
    expires_unix: 1_900_000_000,
    risk: "change",
  };
}

function adapter(toolId: AssistantToolSpec["tool_id"], onPreview?: () => void): AssistantCommandAdapter {
  return {
    spec: spec(toolId),
    validate: (raw) => parseAssistantToolArguments(toolId, raw),
    preview: async (args) => {
      onPreview?.();
      return draftFor(args);
    },
    executeRead: async (args): Promise<AssistantToolResult> => ({
      call_id: "call-1",
      plain_text: "ok",
      citations: [],
      input_refs: [],
      error_code: null,
    }),
  };
}

describe("assistant tool registry", () => {
  it("irreversible_never_listed", () => {
    const registry = new AssistantToolRegistry();
    registry.register(adapter("open_tab"));
    const irreversible = { ...spec("open_tab"), risk: "irreversible" } as AssistantToolSpec;
    expect(() =>
      registry.register({
        ...adapter("switch_tab"),
        spec: irreversible,
      }),
    ).toThrow("assistant.invalid_tool");
    const listed = registry.list({
      chat_id: CHAT,
      scope_id: SCOPE,
      active_tab_id: null,
      capability_ids: capabilitiesForScope({
        hasFiles: true,
        readContents: true,
        hasImage: true,
        recycleAvailable: true,
      }),
    });
    expect(listed.map((row) => row.tool_id)).toEqual(["open_tab"]);
    expect(listed.some((row) => row.risk === "irreversible")).toBe(false);
  });

  it("unknown_tool_refused", () => {
    const registry = new AssistantToolRegistry();
    expect(registry.get("permanent_delete")).toBeNull();
    expect(() => registry.validate("permanent_delete", { tool_id: "permanent_delete" })).toThrow(
      "assistant.invalid_tool",
    );
    expect(() => parseAssistantToolArguments("delete_permanently", { input_ids: [INPUT] })).toThrow(
      "assistant.invalid_arguments",
    );
    // A known tool with an extra approval-looking key is refused.
    expect(() =>
      parseAssistantToolArguments("recycle_items", {
        tool_id: "recycle_items",
        input_ids: [INPUT],
        confirmed: true,
      }),
    ).toThrow("assistant.invalid_arguments");
  });

  it("create_text_preview_not_write", async () => {
    const diskWrite = vi.fn();
    const registry = new AssistantToolRegistry();
    registry.register(adapter("create_file"));
    const args = registry.validate("create_file", {
      tool_id: "create_file",
      parent_root_id: ROOT,
      name: "notes.txt",
      format: "text",
      content: "Meeting at 10.",
    });
    const draft = await registry.get("create_file")!.preview(args, SCOPE);
    expect(draft.risk).toBe("change");
    expect(draft.operation).toMatchObject({ tool_id: "create_file", name: "notes.txt" });
    expect(draft.preview_rows[0].after_excerpt).toContain("Meeting at 10.");
    expect(diskWrite).not.toHaveBeenCalled();
  });

  it("convert_missing_accepted_warning_codes_refused", () => {
    const base = {
      tool_id: "convert",
      input_ids: [INPUT],
      converter_id: "image/png",
      format: "jpeg",
      options: { kind: "image" },
      target_root_id: ROOT,
      accepted_losses: [],
    };
    expect(() => parseAssistantToolArguments("convert", base)).toThrow("assistant.invalid_arguments");
    expect(() =>
      parseAssistantToolArguments("convert", {
        ...base,
        accepted_warning_codes: ["transparency_loss"],
        accepted_losses: ["exif"],
      }),
    ).not.toThrow();
    expect(() =>
      parseAssistantToolArguments("convert", {
        ...base,
        accepted_warning_codes: ["not_a_real_warning"],
        accepted_losses: ["not_a_category"],
      }),
    ).toThrow("assistant.invalid_arguments");
  });

  it("every_registered_tool_has_a_static_read_or_change_schema", () => {
    expect(ASSISTANT_TOOL_IDS).toHaveLength(18);
    for (const row of ASSISTANT_TOOL_SPECS) {
      expect(row.command_id).toBe(`assistant.tool.${row.tool_id}`);
      expect(row.risk).not.toBe("irreversible");
      expect(row.help_slug).toBe("assistant-capabilities");
    }
  });
});
