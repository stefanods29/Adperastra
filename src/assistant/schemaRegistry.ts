/**
 * Registered AI output schemas (Step 17a T2, assistant-schema-1 E2).
 *
 * TypeScript validation is a user-facing guard, never the authority: the
 * native schema registry validates the same IDs and constraints again. A
 * schema's validator may only accept the exact typed shape.
 */

import type { AiCitation, AiTaskKind } from "../services/localAiTypes";
import { parseAssistantToolArguments, validateSourceLocation } from "./toolSchemas";
import type { AssistantReply } from "./types";

export const AI_SCHEMA_INVALID = "ai.schema_invalid" as const;
export const MAX_SCHEMA_OUTPUT_BYTES = 262_144;

export type AiSchemaValidation =
  | { ok: true; value: unknown }
  | { ok: false; error_code: typeof AI_SCHEMA_INVALID };

export interface AiSchemaDescriptor {
  id: string;
  revision: number;
  task: Extract<AiTaskKind, "structured_text" | "vision_answer">;
  max_output_bytes: number;
  validate(value: unknown): AiSchemaValidation;
}

const ASCII_ID = /^[A-Za-z0-9._-]{1,96}$/;
const schemas = new Map<string, AiSchemaDescriptor>();

export function registerAiSchema(descriptor: AiSchemaDescriptor): void {
  if (!ASCII_ID.test(descriptor.id)) throw new Error("ai.schema_invalid");
  if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 1) {
    throw new Error("ai.schema_invalid");
  }
  if (descriptor.task !== "structured_text" && descriptor.task !== "vision_answer") {
    throw new Error("ai.schema_invalid");
  }
  if (
    !Number.isSafeInteger(descriptor.max_output_bytes) ||
    descriptor.max_output_bytes < 1 ||
    descriptor.max_output_bytes > MAX_SCHEMA_OUTPUT_BYTES
  ) {
    throw new Error("ai.schema_invalid");
  }
  if (schemas.has(descriptor.id)) throw new Error("ai.schema_invalid");
  schemas.set(descriptor.id, descriptor);
}

export function getAiSchema(id: string): AiSchemaDescriptor | null {
  return schemas.get(id) ?? null;
}

export function describeAiSchemas(): readonly AiSchemaDescriptor[] {
  return [...schemas.values()].map((row) => ({ ...row }));
}

export function validateAiSchema(id: string, value: unknown): AiSchemaValidation {
  const schema = schemas.get(id);
  if (!schema) return { ok: false, error_code: AI_SCHEMA_INVALID };
  return schema.validate(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function citationsValid(value: unknown): value is AiCitation[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  return value.every((entry) => {
    if (!isObject(entry) || !hasOnlyKeys(entry, ["input_id", "revision", "location", "quote"])) {
      return false;
    }
    let locationValid = false;
    try {
      validateSourceLocation(entry.location);
      locationValid = true;
    } catch {
      locationValid = false;
    }
    return (
      typeof entry.input_id === "string" &&
      typeof entry.revision === "number" &&
      Number.isSafeInteger(entry.revision) &&
      entry.revision >= 1 &&
      typeof entry.quote === "string" &&
      entry.quote.trim().length >= 1 &&
      Array.from(entry.quote).length <= 500 &&
      locationValid
    );
  });
}

/** Exact `AssistantReply` discriminator, closed to unknown keys. */
export function validateAssistantReply(value: unknown): AiSchemaValidation {
  if (!isObject(value) || typeof value.kind !== "string") {
    return { ok: false, error_code: AI_SCHEMA_INVALID };
  }
  if (value.kind === "answer") {
    if (!hasOnlyKeys(value, ["kind", "text", "citations"])) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    if (
      typeof value.text !== "string" ||
      value.text.trim().length === 0 ||
      Array.from(value.text).length > 32_768
    ) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    if (!citationsValid(value.citations)) return { ok: false, error_code: AI_SCHEMA_INVALID };
    return { ok: true, value: value as unknown as AssistantReply };
  }
  if (value.kind === "refusal") {
    if (!hasOnlyKeys(value, ["kind", "reason_code"])) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    if (typeof value.reason_code !== "string" || value.reason_code.length > 96) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    return { ok: true, value: { kind: "refusal", reason_code: value.reason_code } };
  }
  if (value.kind === "tool") {
    if (!hasOnlyKeys(value, ["kind", "request"]) || !isObject(value.request)) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    const request = value.request;
    if (
      !hasOnlyKeys(request, ["tool_id", "arguments", "call_id", "source_message_id"]) ||
      typeof request.tool_id !== "string" ||
      typeof request.call_id !== "string" ||
      request.call_id.length === 0 ||
      request.call_id.length > 64 ||
      typeof request.source_message_id !== "string" ||
      !isObject(request.arguments)
    ) {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    try {
      // The same closed typed validator used on the real native boundary.
      parseAssistantToolArguments(request.tool_id, request.arguments);
    } catch {
      return { ok: false, error_code: AI_SCHEMA_INVALID };
    }
    return { ok: true, value: value as unknown as AssistantReply };
  }
  return { ok: false, error_code: AI_SCHEMA_INVALID };
}

let registered = false;

/** Registers the two 17a schemas once. Called by the coordinator at boot. */
export function registerBuiltInAssistantSchemas(): void {
  if (registered) return;
  registered = true;
  registerAiSchema({
    id: "assistant.reply.v1",
    revision: 1,
    task: "structured_text",
    max_output_bytes: MAX_SCHEMA_OUTPUT_BYTES,
    validate: validateAssistantReply,
  });
  registerAiSchema({
    id: "assistant.vision.v1",
    revision: 1,
    task: "vision_answer",
    max_output_bytes: 65_536,
    validate: (value) => {
      if (!isObject(value) || typeof value.answer !== "string") {
        return { ok: false, error_code: AI_SCHEMA_INVALID };
      }
      if (Array.from(value.answer).length > 32_768) {
        return { ok: false, error_code: AI_SCHEMA_INVALID };
      }
      return { ok: true, value: { answer: value.answer } };
    },
  });
}
