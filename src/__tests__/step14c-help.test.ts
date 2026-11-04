import { existsSync, readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (path: string) => fileURLToPath(repoUrl(path, import.meta.url));

function readJson(locale: "en" | "es"): Record<string, unknown> {
  return JSON.parse(readFileSync(root(`../i18n/locales/${locale}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [nested, text] of flatten(child, path)) out.set(nested, text);
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)/g)].map((match) => match[1]).sort();
}

const AI_COMMAND_HELP: Record<string, string> = {
  "image.aiUpscale": "ai-upscaling",
  "app.aiSettings": "ai-packs-hardware",
};

const AI_ERRORS = [
  "bad_request",
  "disabled",
  "pack_missing",
  "unverified",
  "unsupported",
  "memory_limit",
  "sandbox_failed",
  "source_changed",
  "expired",
  "timeout",
  "cancelled",
  "model_output",
  "schema_invalid",
  "sensitive_unsupported",
  "failed",
];

describe("Step 14c help and translations", () => {
  it("every_ai_command_help_bilingual", () => {
    for (const slug of new Set(Object.values(AI_COMMAND_HELP))) {
      expect(existsSync(root(`../../help/en/${slug}.md`)), `help/en/${slug}.md`).toBe(true);
      expect(existsSync(root(`../../help/es/${slug}.md`)), `help/es/${slug}.md`).toBe(true);
    }
  });

  it("every_error_localized", () => {
    const en = flatten(readJson("en").errors);
    const es = flatten(readJson("es").errors);
    for (const reason of AI_ERRORS) {
      expect(en.get(`ai.${reason}`), `errors.ai.${reason} (en)`).toBeTruthy();
      expect(es.get(`ai.${reason}`), `errors.ai.${reason} (es)`).toBeTruthy();
    }
  });

  it("locale_placeholders_match", () => {
    const en = flatten(readJson("en"));
    const es = flatten(readJson("es"));
    for (const [key, english] of en) {
      if (!(key.startsWith("ai.") || key.startsWith("errors.ai."))) continue;
      const spanish = es.get(key);
      expect(spanish, `${key} (es)`).toBeTruthy();
      expect(placeholders(spanish ?? ""), key).toEqual(placeholders(english));
    }
  });
});