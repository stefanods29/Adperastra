import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_IDS } from "../assistant/types";
import { AI_EVAL_REQUIRES_COORDINATOR } from "../assistant/evalTypes";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function locale(language: "en" | "es"): Record<string, unknown> {
  return JSON.parse(read(`src/i18n/locales/${language}.json`)) as Record<string, unknown>;
}

function hasKey(dictionary: Record<string, unknown>, key: string): boolean {
  let current: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0;
}

const HELP_PAGES = [
  "assistant",
  "assistant-capabilities",
  "assistant-preferences",
  "assistant-models",
];

describe("assistant help and disclosure", () => {
  it("alltoolhelp_bilingual", () => {
    for (const page of HELP_PAGES) {
      const en = read(`help/en/${page}.md`);
      const es = read(`help/es/${page}.md`);
      expect(en.startsWith("# ")).toBe(true);
      expect(es.startsWith("# ")).toBe(true);
      expect(en).toContain("See also:");
      expect(es).toContain("Consulta también:");
    }
    const en = locale("en");
    const es = locale("es");
    for (const tool of ASSISTANT_TOOL_IDS) {
      expect(hasKey(en, `assistant.tool.${tool}`)).toBe(true);
      expect(hasKey(es, `assistant.tool.${tool}`)).toBe(true);
    }
  });

  it("allerrors_localized", () => {
    const keys = [
      "invalid",
      "scope_denied",
      "changed",
      "confirmation_required",
      "recycle_unavailable",
      "outbound_required",
      "outbound_expired",
      "sensitive_api",
      "api_auth",
      "api_rate_limit",
      "api_unavailable",
      "api_response",
      "key_store",
      "provider_invalid",
      "history_failed",
      "failed",
    ];
    for (const language of ["en", "es"] as const) {
      const dictionary = locale(language);
      for (const key of keys) {
        expect(hasKey(dictionary, `errors.assistant.${key}`), `${language} ${key}`).toBe(true);
      }
    }
  });

  it("API_disclosure_before_network", () => {
    const en = read("help/en/assistant-models.md");
    const es = read("help/es/assistant-models.md");
    expect(en).toContain("API mode uses the network only for requests you approve.");
    expect(es).toContain("El modo de API usa la red solo en solicitudes que apruebas.");
    expect(read("help/en/assistant-preferences.md")).toContain(
      "show the exact content and provider before **Send this content**",
    );
    expect(read("help/es/assistant-preferences.md")).toContain(
      "muestran el contenido exacto y el proveedor antes de **Enviar este contenido**",
    );
  });

  it("models_missing_pack_link", () => {
    expect(read("help/en/assistant-models.md")).toContain("**App storage**");
    expect(read("help/es/assistant-models.md")).toContain("**Almacenamiento de la aplicación**");
    expect(read("help/en/assistant-models.md")).toContain('See also: "AI packs and hardware"');
    expect(read("help/es/assistant-models.md")).toContain('Consulta también: "Paquetes de IA y hardware"');
  });

  it("actualchecks/gatecoordinatorrequired", () => {
    expect(AI_EVAL_REQUIRES_COORDINATOR).toBe(true);
    for (const page of HELP_PAGES) {
      expect(read(`help/en/${page}.md`)).not.toContain("test passed");
      expect(read(`help/es/${page}.md`)).not.toContain("prueba superada");
    }
  });
});
