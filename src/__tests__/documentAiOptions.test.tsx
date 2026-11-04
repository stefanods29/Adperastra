import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DocumentAiOptions } from "../office/document/ai/DocumentAiOptions";
import { DocumentAiDiff } from "../office/document/ai/DocumentAiDiff";
import type { DocumentAiOptions as Options } from "../office/document/ai/documentAiTypes";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => `translated:${key}` }) }));
const value: Options = { action: "rewrite", tone: null, target_language: null, topic: null, locale: "en" };

it("options_list_all_ten_translated_actions", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DocumentAiOptions value={value} supportedLanguages={["en", "es"]} disabled={false} unavailableActions={["alt_text"]} onChange={() => undefined} />));
    const options = [...host.querySelectorAll("option")];
    expect(options).toHaveLength(10);
    expect(options.every((option) => option.textContent!.startsWith("translated:documentAi."))).toBe(true);
    expect(options.find((option) => option.value === "alt_text")!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); }
});
it("option_changes_clear_inapplicable_fields", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  try {
    await act(async () => root.render(<DocumentAiOptions value={{ ...value, action: "tone", tone: "formal" }} supportedLanguages={["es"]} disabled={false} unavailableActions={[]} onChange={onChange} />));
    const action = host.querySelector("select")!;
    await act(async () => { action.value = "translate"; action.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ ...value, action: "translate" });
  } finally { await act(async () => root.unmount()); }
});
it("diff_escapes_model_markup_and_uses_semantic_changes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DocumentAiDiff before="A" after={'<img src="remote" />'} />));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("del")!.textContent).toBe("A");
    expect(host.querySelector("ins")!.textContent).toBe('<img src="remote" />');
  } finally { await act(async () => root.unmount()); }
});
