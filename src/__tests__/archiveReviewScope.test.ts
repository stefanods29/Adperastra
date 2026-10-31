import { describe, expect, it } from "vitest";
import { validateReviewScope } from "../../scripts/check-06e-ui.mjs";

describe("06e review runner scope", () => {
  const demo = "C:\\Users\\Ana\\AppData\\Local\\Temp\\adperastra-review-06e-0123456789abcdef";
  const valid = ["9333", demo, "C:\\out\\review.json", "C:\\out\\shots", "en", "light"];

  it("accepts a fresh review folder and a local port", () => {
    const scope = validateReviewScope(valid);
    expect(scope.port).toBe("9333");
    expect(scope.demo).toBe(demo);
    expect(scope.language).toBe("en");
    expect(scope.shots).toBe("C:\\out\\shots");
  });

  it("refuses a reused folder, a bad port or unknown languages", () => {
    expect(() => validateReviewScope([...valid, "--sign"])).toThrow(/sign/);
    expect(() => validateReviewScope(valid.map((value, index) => index === 0 ? "0" : value))).toThrow(/port/);
    expect(() =>
      validateReviewScope(valid.map((value, index) =>
        index === 1 ? "C:\\Windows\\adperastra-review-06e-1" : value,
      )),
    ).toThrow(/fresh/);
    expect(() =>
      validateReviewScope(valid.map((value, index) => index === 4 ? "fr" : value)),
    ).toThrow(/language/);
    expect(() =>
      validateReviewScope(valid.map((value, index) => index === 5 ? "sepia" : value)),
    ).toThrow(/theme/);
    expect(() =>
      validateReviewScope(valid.map((value, index) => index === 3 ? "relative\\shots" : value)),
    ).toThrow(/absolute/);
  });
});
