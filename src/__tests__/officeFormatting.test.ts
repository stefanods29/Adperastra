import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../services/settings";
import { formatOfficeFormula, parseOfficeFormula } from "../services/officeEdit";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: vi.fn() }));

const sessionId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
});

describe("Office formula transport", () => {
  it("passes_formula_notation_to_native_without_text_replacement", async () => {
    const text = '=SUMA(1;2)&"SUMA;"';
    const parsed = {
      canonical: '=SUM(1,2)&"SUMA;"', functions: ["SUM"], valid: true, error_offset_utf16: null,
    };
    vi.mocked(invoke).mockResolvedValue(parsed);
    expect(await parseOfficeFormula(sessionId, text, "es-419")).toEqual(parsed);
    expect(invoke).toHaveBeenCalledWith("office_edit_formula_parse", { sessionId, text, locale: "es-419" });
    // The fixture is a native response, not proof that an engine AST translator exists.
  });

  it("formats_through_native_with_exact_locale", async () => {
    vi.mocked(invoke).mockResolvedValue("=SUMA(1;2)");
    expect(await formatOfficeFormula(sessionId, "=SUM(1,2)", "es-419")).toBe("=SUMA(1;2)");
    expect(invoke).toHaveBeenCalledWith("office_edit_formula_format", {
      sessionId, canonical: "=SUM(1,2)", locale: "es-419",
    });
  });

  it("native_formula_failure_is_not_converted_to_success", async () => {
    vi.mocked(invoke).mockRejectedValue("office_edit.invalid");
    await expect(parseOfficeFormula(sessionId, "=SUM(1,2)", "en-US")).rejects.toBe("office_edit.invalid");
  });

  it("missingengine_disabled", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    await expect(parseOfficeFormula(sessionId, "=SUMA(1;2)", "es-419")).rejects.toThrow("office_edit.engine_missing");
    expect(invoke).not.toHaveBeenCalled();
  });
});
