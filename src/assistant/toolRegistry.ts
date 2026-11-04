/**
 * Trusted assistant tool adapters (Step 17a T1, assistant-core-1 E1).
 *
 * The registry is static: only app code registers adapters. The model sees
 * `AssistantToolSpec`s, never a run closure. Irreversible commands are never
 * listed, and a missing capability hides the tool instead of granting it.
 */

import type { CommandRisk } from "../commands/registry";
import { parseAssistantToolArguments } from "./toolSchemas";
import type {
  AssistantCommandAdapter,
  AssistantToolArguments,
  AssistantToolContext,
  AssistantToolId,
  AssistantToolSpec,
} from "./types";
import { ASSISTANT_RECYCLE_SAFE, ASSISTANT_TOOL_IDS } from "./types";

const READ_ONLY: CommandRisk = "read-only";

/** The exact 18 tool rows of the guide; order is stable for prompts. */
export const ASSISTANT_TOOL_SPECS: readonly AssistantToolSpec[] = [
  spec("open_tab", READ_ONLY, "assistant.tabs", true),
  spec("switch_tab", READ_ONLY, "assistant.tabs", true),
  spec("close_tab", READ_ONLY, "assistant.tabs", true),
  spec("group_tabs", READ_ONLY, "assistant.tabs", true),
  spec("open_saved_group", READ_ONLY, "assistant.tabs", true),
  spec("search_files", READ_ONLY, "assistant.search", true),
  spec("read_file", READ_ONLY, "assistant.read", true),
  spec("describe_image", READ_ONLY, "assistant.vision", false),
  spec("create_file", "change", "assistant.create", false),
  spec("create_folder", "change", "assistant.create", false),
  spec("create_from_template", "change", "assistant.create", false),
  spec("rename_items", "change", "assistant.transform", false),
  spec("move_items", "change", "assistant.transform", false),
  spec("copy_items", "change", "assistant.transform", false),
  spec("convert", "change", "assistant.transform", false),
  spec("tag_items", "change", "assistant.tags", false),
  spec("privacy_clean", "change", "assistant.privacy", false),
  spec("recycle_items", "recycle", "assistant.recycle", false),
];

function spec(
  toolId: AssistantToolId,
  risk: CommandRisk,
  capability: string,
  automaticAllowed: boolean,
): AssistantToolSpec {
  return {
    tool_id: toolId,
    command_id: `assistant.tool.${toolId}`,
    schema_id: `assistant.tool.${toolId}.v1`,
    risk,
    required_capability: capability,
    automatic_allowed: automaticAllowed,
    description_key: `assistant.tool.${toolId}`,
    help_slug: "assistant-capabilities",
  };
}

export class AssistantToolRegistry {
  private readonly adapters = new Map<AssistantToolId, AssistantCommandAdapter>();

  register(adapter: AssistantCommandAdapter): void {
    const id = adapter.spec.tool_id;
    if (!ASSISTANT_TOOL_IDS.includes(id)) {
      throw new Error("assistant.invalid_tool");
    }
    if (adapter.spec.risk === "irreversible") {
      // Defensive: the type table has no irreversible row, and a future
      // registration cannot smuggle one in.
      throw new Error("assistant.invalid_tool");
    }
    if (this.adapters.has(id)) {
      throw new Error("assistant.duplicate_tool");
    }
    this.adapters.set(id, adapter);
  }

  get(toolId: string): AssistantCommandAdapter | null {
    return this.adapters.get(toolId as AssistantToolId) ?? null;
  }

  /**
   * The tools this chat may see: registered, capability allowed, and never
   * irreversible. `automatic_tools` preference is applied by the turn, not
   * here, so the composer can still ask for a preview.
   */
  list(context: AssistantToolContext): readonly AssistantToolSpec[] {
    const capabilities = new Set(context.capability_ids);
    const result: AssistantToolSpec[] = [];
    for (const toolSpec of ASSISTANT_TOOL_SPECS) {
      if (toolSpec.risk === "irreversible") continue;
      if (!capabilities.has(toolSpec.required_capability)) continue;
      if (!this.adapters.has(toolSpec.tool_id)) continue;
      result.push({ ...toolSpec });
    }
    return result;
  }

  /** Validate a raw model argument object against the static schema. */
  validate(toolId: string, raw: unknown): AssistantToolArguments {
    const adapter = this.get(toolId);
    if (!adapter) throw new Error("assistant.invalid_tool");
    return adapter.validate(raw);
  }

  /** The fallback validator is the shared parser; adapters may only narrow. */
  static parse(toolId: string, raw: unknown): AssistantToolArguments {
    return parseAssistantToolArguments(toolId, raw);
  }
}

/** Capabilities that never depend on a file being open. */
export const BASE_ASSISTANT_CAPABILITIES: readonly string[] = [
  "assistant.tabs",
  "assistant.search",
  "assistant.create",
  "assistant.transform",
  "assistant.tags",
  "assistant.privacy",
];

export function capabilitiesForScope(options: {
  hasFiles: boolean;
  readContents: boolean;
  hasImage: boolean;
  recycleAvailable: boolean;
}): string[] {
  const capabilities = new Set(BASE_ASSISTANT_CAPABILITIES);
  if (options.hasFiles && options.readContents) capabilities.add("assistant.read");
  if (options.hasImage && options.readContents) capabilities.add("assistant.vision");
  if (options.recycleAvailable && ASSISTANT_RECYCLE_SAFE) {
    capabilities.add("assistant.recycle");
  }
  return [...capabilities];
}
