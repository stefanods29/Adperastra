import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import SheetAiFormulaPreview from "../office/sheet/ai/SheetAiFormulaPreview";
import SheetAiChartPreview from "../office/sheet/ai/SheetAiChartPreview";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.documentElement.removeAttribute("data-theme");
  await i18n.changeLanguage("en");
});
async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}
describe("sheet AI non-owning preview children only", () => {
  it("formula_pending_is_not_shown_as_calculated", async () => {
    const view = await render(<SheetAiFormulaPreview canonical="=SUM(A1:A2)" localized={null} calculation={null} />);
    const fields = view.querySelectorAll("textarea");
    expect(fields[2].value).toBe(i18n.t("sheetAi.notCalculated"));
    expect([...fields].every(f => f.readOnly)).toBe(true);
    expect(view.querySelector("button")).toBeNull();
  });
  it("formula_preview_uses_native_display", async () => {
    const view = await render(<SheetAiFormulaPreview canonical="=SUM(A1:A2)" localized="=SUMA(A1:A2)" calculation={{
      address: { sheet_id: "00000000-0000-4000-8000-000000000001", row: 2, column: 0 },
      canonical: "=SUM(A1:A2)", localized: "=SUMA(A1:A2)", result: { kind: "number", value: 5 },
      display: "5", deterministic: true, error_code: null,
    }} />);
    expect(view.querySelectorAll("textarea")[2].value).toBe("5");
  });
  it("sheet_spanish_dark_labels", async () => {
    await i18n.changeLanguage("es");
    document.documentElement.dataset.theme = "dark";
    const view = await render(<SheetAiFormulaPreview canonical="=SUM(1,2)" localized={null} calculation={null} />);
    expect(view.textContent).toContain("Fórmula canónica");
    expect(view.textContent).toContain("Resultado calculado");
    expect(view.querySelectorAll("textarea")[2].value).toContain("Sin calcular");
    // Layout/contrast still require the coordinator's actual dark screenshot.
  });
  it("chart_has_no_model_image_fallback", async () => {
    const view = await render(<SheetAiChartPreview render={null} caption="Synthetic chart" source={{
      sheet_id: "00000000-0000-4000-8000-000000000001", first_row: 0, last_row: 2, first_column: 0, last_column: 1,
    }} />);
    expect(view.querySelector("img")).toBeNull();
    expect(view.querySelector("figcaption")?.textContent).toBe("Synthetic chart");
  });
});
