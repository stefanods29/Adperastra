import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  EXTRACTION_HELP_SLUGS,
  createExtractionCommands,
} from "../commands/extractionCommands";
import {
  acceptInlineCompletion,
  currentGhost,
  dismissInlineCompletion,
  inlineGhostExtension,
  showInlineGhost,
} from "../editor/aiInlineGhost";
import {
  emptyMilestoneEvidence,
  milestoneReleaseDecision,
  missingMilestoneEvidence,
  draftReleaseAllowed,
} from "../extraction/releaseEvidence";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function localeValue(language: "en" | "es", key: string): unknown {
  const json = JSON.parse(read(`src/i18n/locales/${language}.json`)) as Record<string, unknown>;
  let value: unknown = json;
  for (const part of key.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const EXTRACTION_KEYS = [
  "aiExtract.document",
  "aiExtract.tables",
  "aiExtract.receipts",
  "aiExtract.source",
  "aiExtract.result",
  "aiExtract.review",
  "aiExtract.export",
  "aiExtract.cancel",
  "aiExtract.retry",
  "aiExtract.uncertain",
  "aiExtract.corrected",
  "aiExtract.missing",
  "aiExtract.inconsistent",
  "aiExtract.progress",
  "aiExtract.partial",
  "aiExtract.splitColumn",
  "aiExtract.mergeColumns",
  "aiExtract.sourceLabels",
  "aiExtract.formulaSafety",
  "aiExtract.discard",
  "aiExtract.vendor",
  "aiExtract.taxId",
  "aiExtract.date",
  "aiExtract.currency",
  "aiExtract.subtotal",
  "aiExtract.tax",
  "aiExtract.total",
  "aiExtract.lineItems",
  "aiInline.title",
  "aiInline.available",
  "aiInline.paused",
  "aiInline.localRequired",
  "errors.ai_extract.invalid",
  "errors.ai_extract.changed",
  "errors.ai_extract.too_large",
  "errors.ai_extract.unsupported",
  "errors.ai_extract.uncertain",
  "errors.ai_extract.failed",
  "errors.ai_inline.unavailable",
  "errors.ai_inline.changed",
] as const;

const API_SENTENCE = {
  en: "With an API backend, review the displayed scan content and confirm Send once before inference.",
  es: "Con un servicio de API, revisa el contenido mostrado del escaneo y confirma el envío una vez antes del procesamiento.",
} as const;

describe("extraction help", () => {
  it("extraction_help_bilingual", () => {
    const actions = {
      scanToDocument: () => undefined,
      tablesToSheet: () => undefined,
      receiptsToSheet: () => undefined,
      toggleInlineSuggestions: () => undefined,
    };
    const commands = createExtractionCommands(actions);
    expect(commands.map((command) => command.id)).toEqual([
      "file.scanToDocument",
      "file.tablesToSheet",
      "file.receiptsToSheet",
      "text.inlineSuggestions",
    ]);
    expect(commands.every((command) => command.shortcut === undefined)).toBe(true);
    expect(commands.slice(0, 3).every((command) => command.risk === "read-only")).toBe(true);
    expect(commands.map((command) => command.helpSlug)).toEqual([...EXTRACTION_HELP_SLUGS]);

    for (const slug of EXTRACTION_HELP_SLUGS) {
      for (const language of ["en", "es"] as const) {
        const text = read(`help/${language}/${slug}.md`);
        expect(text.startsWith("# "), `${language}/${slug}`).toBe(true);
        expect(text).toContain(language === "en" ? "## How to use it" : "## Cómo usarlo");
        expect(text).toContain(language === "en" ? "## Good to know" : "## Conviene saber");
        expect(text).toMatch(language === "en" ? /^See also: /m : /^Consulta también: /m);
      }
    }
    for (const slug of ["turning-scans-into-documents", "extracting-tables", "extracting-receipts-and-invoices"]) {
      for (const language of ["en", "es"] as const) {
        expect(read(`help/${language}/${slug}.md`)).toContain(API_SENTENCE[language]);
      }
    }
    for (const key of EXTRACTION_KEYS) {
      for (const language of ["en", "es"] as const) {
        expect(typeof localeValue(language, key), `${language}: ${key}`).toBe("string");
      }
    }
  });

  it("inline_keyboard_help", () => {
    const en = read("help/en/inline-writing-suggestions.md");
    const es = read("help/es/inline-writing-suggestions.md");
    expect(en).toContain("**Tab**");
    expect(en).toContain("**Escape**");
    expect(es).toContain("**Tab**");
    expect(es).toContain("**Escape**");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "The meeting ", extensions: [inlineGhostExtension] }),
      parent: host,
    });
    showInlineGhost(
      view,
      {
        generation: 1,
        revision: 1,
        content_id: "22222222-2222-4222-8222-222222222222",
        cursor_utf16: 12,
        text: "begins.",
        expires_unix: 2_000_000_000,
      },
      12,
    );
    expect(dismissInlineCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("The meeting ");
    expect(currentGhost(view)).toBeNull();
    expect(acceptInlineCompletion(view)).toBe(false);
    view.destroy();
    host.remove();
  });

  it("milestone_not_automatic", () => {
    const empty = emptyMilestoneEvidence();
    expect(milestoneReleaseDecision(empty)).toBe("hold");
    expect(missingMilestoneEvidence(empty)).toHaveLength(7);
    const unverified = { ...empty, gate_passed: true, package_passed: true };
    expect(draftReleaseAllowed(unverified)).toBe(true);
    expect(milestoneReleaseDecision(unverified)).toBe("hold");
    const unapproved = { ...unverified, evaluations_passed: true, screenshots_captured: true, accessibility_checked: true, source_hashes_recorded: true };
    expect(milestoneReleaseDecision(unapproved)).toBe("hold");
    expect(milestoneReleaseDecision({ ...unapproved, owner_approved: true })).toBe("publish");
  });
});
