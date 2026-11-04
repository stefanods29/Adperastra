import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AI_ACTIONS_SETTINGS_SCHEMA_VERSION,
  AI_ACTION_IDS,
  defaultAiActionsSettings,
  normalizeAiActionsSettings,
} from "../services/aiActionTypes";
import { escapeSubtitleText, toSrt } from "../ai-actions/transcriptSubtitles";

/** Step 17b T9 checks. Written tests only; the coordinator runs them. */

const helpRoot = fileURLToPath(repoUrl("../../help/", import.meta.url));
const localesRoot = fileURLToPath(repoUrl("../i18n/locales/", import.meta.url));

const PAGES = [
  "ai-actions-images",
  "ai-actions-documents",
  "ai-actions-media",
  "ai-actions-multiple",
  "automatic-captions",
  "checking-ai-suggestions",
];

const ERRORS = {
  ai_actions: ["invalid", "unsupported", "too_large", "source_changed", "empty_mask", "image_mask_too_large", "no_sources", "language_unsupported", "failed"],
  speech: ["invalid", "pack_missing", "permission_denied", "device_unavailable", "too_long", "expired", "changed", "failed"],
};

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("step 17b help and keys", () => {
  it("all action help pages are bilingual", () => {
    for (const page of PAGES) {
      const en = read(`${helpRoot}/en/${page}.md`);
      const es = read(`${helpRoot}/es/${page}.md`);
      expect(en.startsWith("# ")).toBe(true);
      expect(es.startsWith("# ")).toBe(true);
      expect(en).toContain("See also:");
      expect(es).toContain("Consulta también:");
      expect(en.trim().split("\n").length).toBeGreaterThan(8);
    }
  });

  it("all error keys exist in both locales", () => {
    const en = JSON.parse(read(`${localesRoot}/en.json`)) as Record<string, unknown>;
    const es = JSON.parse(read(`${localesRoot}/es.json`)) as Record<string, unknown>;
    const has = (tree: Record<string, unknown>, key: string) =>
      key.split(".").every((part) => {
        const next = tree[part];
        if (next === undefined) return false;
        tree = next as Record<string, unknown>;
        return true;
      });
    for (const [area, reasons] of Object.entries(ERRORS)) {
      for (const reason of reasons) {
        expect(has(en, `errors.${area}.${reason}`)).toBe(true);
        expect(has(es, `errors.${area}.${reason}`)).toBe(true);
      }
    }
    for (const key of ["aiActions.title", "aiActions.needsPack", "aiActions.keepOriginal", "speech.pack", "speech.transcript", "speech.captions"]) {
      expect(has(en, key)).toBe(true);
      expect(has(es, key)).toBe(true);
    }
  });

  it("schema 44 migrates to defaults at 45", () => {
    expect(AI_ACTIONS_SETTINGS_SCHEMA_VERSION).toBe(45);
    const migrated = normalizeAiActionsSettings(undefined);
    const defaults = defaultAiActionsSettings();
    expect(migrated).toEqual(defaults);
    for (const id of AI_ACTION_IDS) {
      if (id !== "copy_text") expect(migrated.enabled[id]).toBe(false);
    }
    expect(migrated.caption_window_seconds).toBe(30);
    expect(migrated.transcription_language).toBe("auto");
    const kept = normalizeAiActionsSettings({ enabled: { summarize: true }, dictation_language: "es" });
    expect(kept.enabled.summarize).toBe(true);
    expect(kept.dictation_language).toBe("es");
  });

  it("SRT text stays escaped and literal", () => {
    expect(escapeSubtitleText("<b>Hello</b> & bye")).toBe("&lt;b&gt;Hello&lt;/b&gt; &amp; bye");
    const srt = toSrt([{ id: "x", start_us: 0, end_us: 1_000_000, text: "<script>" }]);
    expect(srt).toContain("&lt;script&gt;");
    expect(srt).not.toContain("<script>");
    expect(srt).not.toContain("--> 00:00:00,000 -->");
  });

  it("dictation help mentions review", () => {
    const en = read(`${helpRoot}/en/automatic-captions.md`).toLowerCase();
    const es = read(`${helpRoot}/es/automatic-captions.md`).toLowerCase();
    expect(en).toContain("review");
    expect(en).toContain("never inserts");
    expect(es).toContain("revisa");
    expect(es).toContain("nunca inserta");
  });

  it("actual quality, security and pack gates remain coordinator checks", () => {
    // Nothing in this file asserts a model, microphone, pack or benchmark
    // result; those remain unrun evidence for the coordinator.
    const pending = ["model quality", "microphone privacy", "pack hashes", "benchmarks", "screenshots"];
    for (const item of pending) expect(item.length).toBeGreaterThan(0);
    expect(PAGES).toHaveLength(6);
  });
});