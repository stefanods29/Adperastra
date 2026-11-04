import { describe, expect, it } from "vitest";
import {
  shouldCheckAutomatically,
  whatsNewDue,
  whatsNewSlug,
} from "../services/updates";

describe("update scheduling", () => {
  it("never checks automatically while the setting is off", () => {
    expect(shouldCheckAutomatically(false, 0, 1_000_000)).toBe(false);
    expect(shouldCheckAutomatically(false, 1_000, 1_000_000)).toBe(false);
  });

  it("checks at most once per 24 hours", () => {
    const now = 1_000_000;
    expect(shouldCheckAutomatically(true, 0, now)).toBe(true);
    expect(shouldCheckAutomatically(true, now - 86_399, now)).toBe(false);
    expect(shouldCheckAutomatically(true, now - 86_400, now)).toBe(true);
  });
});

describe("What's new", () => {
  it("is due when the app version changed", () => {
    expect(whatsNewDue("0.1.0", "")).toBe(true);
    expect(whatsNewDue("0.1.0", "0.1.0")).toBe(false);
    expect(whatsNewDue("0.2.0", "0.1.0")).toBe(true);
    expect(whatsNewDue("", "0.1.0")).toBe(false);
  });

  it("opens only a help page that exists for this version", () => {
    expect(whatsNewSlug("0.1.0")).toBe("whats-new-0-1");
    expect(whatsNewSlug("v0.1.2")).toBe("whats-new-0-1");
    expect(whatsNewSlug("0.2.0")).toBeNull();
    expect(whatsNewSlug("not a version")).toBeNull();
  });
});
