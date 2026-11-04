import { fileURLToPath } from "node:url";
import { repoUrl } from "./nodeUrl";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const help = (locale: string) => readFileSync(repoUrl(`../../help/${locale}/ai-writing-in-documents.md`, import.meta.url), "utf8");
const locales = (locale: string) => JSON.parse(readFileSync(repoUrl(`../i18n/locales/${locale}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
function lookup(value: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((part, segment) =>
    part !== null && typeof part === "object" ? (part as Record<string, unknown>)[segment] : undefined, value);
}

it("document_help_lists_all_actions_and_separates_send_from_accept", () => {
  const en = help("en");
  const es = help("es");
  for (const text of ["Rewrite", "Shorten", "Expand", "Simplify", "Fix grammar", "Change tone", "Translate", "Draft a section", "Continue writing", "Write alt text"]) expect(en).toContain(text);
  for (const text of ["Reescribir", "Acortar", "Ampliar", "Simplificar", "Corregir gramática", "Cambiar tono", "Traducir", "Redactar una sección", "Continuar escribiendo", "Escribir texto alternativo"]) expect(es).toContain(text);
  expect(en).toContain("separate one-time Send review; accepting a suggestion is a later action.");
  expect(es).toContain("revisión separada de envío de una sola vez; aceptar una sugerencia es una acción posterior.");
});
it("ai_document_language_keys", () => {
  const en = locales("en");
  const es = locales("es");
  const keys = ["title", "rewrite", "shorten", "expand", "simplify", "grammar", "tone", "translate", "altText", "draft", "continue", "formal", "friendly", "persuasive", "neutral", "targetLanguage", "topic", "source", "suggestion", "accept", "retry", "edit", "discard", "cancel", "progress", "protected", "acknowledge", "tracked", "unverified", "discardEdited", "kindNumber", "kindDate", "kindName", "kindUrl", "kindIdentifier", "kindQuotation", "removed"];
  for (const key of keys) {
    const english = lookup(en, `documentAi.${key}`);
    const spanish = lookup(es, `documentAi.${key}`);
    expect(typeof english).toBe("string");
    expect(typeof spanish).toBe("string");
    const args = (value: unknown) => [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
    expect(args(spanish)).toEqual(args(english));
  }
});
