import { describe, expect, it } from "vitest";
import type { MetadataCategory } from "../convert/types";
import { PrivacyPolicyError, privacyPolicyFor } from "../privacy/policy";
import type { PrivacySettings } from "../services/privacy";

const defaults: PrivacySettings = {
  mode: "keep",
  image_mode: "keep",
  pdf_mode: "keep",
  image_categories: [],
  pdf_categories: [],
  location_warning: false,
  sharing_prompt: false,
};

function settings(patch: Partial<PrivacySettings>): PrivacySettings {
  return { ...defaults, ...patch };
}

describe("privacyPolicyFor", () => {
  it("defaults remove zero fields", () => {
    expect(privacyPolicyFor(defaults, "jpeg")).toEqual({ mode: "keep", categories: [] });
    expect(privacyPolicyFor(defaults, "pdf")).toEqual({ mode: "keep", categories: [] });
  });

  it("a saved remove choice with no categories removes nothing", () => {
    expect(
      privacyPolicyFor(settings({ image_mode: "remove", image_categories: [] }), "png"),
    ).toEqual({ mode: "keep", categories: [] });
  });

  it("returns the exact fixed categories, never remove-all", () => {
    const categories: MetadataCategory[] = ["gps", "date"];
    expect(
      privacyPolicyFor(
        settings({ image_mode: "remove", image_categories: categories }),
        "jpeg",
      ),
    ).toEqual({ mode: "remove", categories });
  });

  it("ask preserves the review step", () => {
    expect(
      privacyPolicyFor(
        settings({ pdf_mode: "ask", pdf_categories: ["author"] }),
        "pdf",
      ),
    ).toEqual({ mode: "ask", categories: ["author"] });
  });

  it("explicit selection wins over saved keep", () => {
    expect(privacyPolicyFor(defaults, "png", ["gps"])).toEqual({
      mode: "remove",
      categories: ["gps"],
    });
  });

  it("an explicit empty selection never falls back to saved removal", () => {
    expect(
      privacyPolicyFor(
        settings({ image_mode: "remove", image_categories: ["gps"] }),
        "png",
        [],
      ),
    ).toEqual({ mode: "keep", categories: [] });
  });

  it("refuses unsupported formats and categories", () => {
    expect(() => privacyPolicyFor(defaults, "bmp")).toThrow(PrivacyPolicyError);
    expect(() =>
      privacyPolicyFor(settings({ pdf_mode: "remove", pdf_categories: ["gps"] }), "pdf"),
    ).toThrow(PrivacyPolicyError);
  });
});
