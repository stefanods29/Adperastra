import { describe, expect, it } from "vitest";
import { imageViewStateCodec, isSerializableViewState, mediaViewStateCodec, textViewStateCodec } from "../services/viewState";
import {
  SessionValidationError,
  resetSessionWriteBlockForTests,
  sessionWritesBlocked,
  validateSessionData,
} from "../services/sessionValidation";

const baseSession = {
  schema_version: 2,
  tabs: [
    { id: "explorer", kind: "explorer" },
    {
      id: "img-1",
      kind: "file",
      path: "C:\\photos\\a.png",
      handler: "image",
      title: "a.png",
      view: { mode: "manual", percent: 150, turns: 1 },
      view_version: 1,
    },
  ],
  active_tab: "img-1",
  saved_unix: 10,
  history: ["explorer", "img-1"],
};

describe("bounded view-state restore (T5)", () => {
  it("image_fit_manual_and_turns_preserved", () => {
    const decoded = imageViewStateCodec.decode({ mode: "manual", percent: 150, turns: 5 });
    expect(decoded).toEqual({ mode: "manual", percent: 150, turns: 1 });
    const fit = imageViewStateCodec.decode({ mode: "fit", percent: 100, turns: 0 });
    expect(fit).toEqual({ mode: "fit", percent: 100, turns: 0 });
  });

  it("media_restore_never_autoplays", () => {
    const decoded = mediaViewStateCodec.decode({ speed: 1.5, loop: true, position_ms: 4200, autoplay: true });
    expect(decoded).toMatchObject({ speed: 1.5, loop: true, position_ms: 4200, autoplay: false });
  });

  it("text_state_keeps_cursor_without_keeping_text", () => {
    const encoded = textViewStateCodec.encode({ wrap: true, numbers: false, zoom: 2, spellcheck: true, cursor_line: 9, scroll_top: 120 });
    expect(encoded).toMatchObject({ wrap: true, cursor_line: 9, scroll_top: 120 });
    expect(JSON.stringify(encoded)).not.toContain("content");
  });

  it("prototype_key_depth_9_and_64KiB_plus_1_rejected", () => {
    expect(isSerializableViewState(JSON.parse('{"__proto__": {"x": 1}}'))).toBe(false);
    let deep: unknown = { value: 1 };
    for (let index = 0; index < 9; index += 1) deep = { next: deep };
    expect(isSerializableViewState(deep)).toBe(false);
    const big = { text: "x".repeat(64 * 1024 + 1) };
    expect(isSerializableViewState(big)).toBe(false);
    expect(isSerializableViewState({ value: Number.NaN })).toBe(false);
  });

  it("schema_newer_retained_not_downgraded", () => {
    resetSessionWriteBlockForTests();
    const newer = { ...baseSession, schema_version: 4 };
    expect(() => validateSessionData(newer, ["image"])).toThrow(SessionValidationError);
    // The thrown code is the one the UI translates; the file stays as is
    // and the rest of this run may not write a downgraded session.
    expect(sessionWritesBlocked()).toBe(true);
    try {
      validateSessionData(newer, ["image"]);
    } catch (error) {
      expect((error as SessionValidationError).code).toBe("tabs.invalid_state");
    }
    resetSessionWriteBlockForTests();
  });

  it("missing_file_placeholder_keeps_others", () => {
    const validated = validateSessionData(baseSession, ["image"]);
    expect(validated.tabs.map((tab) => tab.id)).toEqual(["explorer", "img-1"]);
    expect(validated.schema_version).toBe(3);
    const unknownHandler = validateSessionData(
      {
        ...baseSession,
        tabs: [...baseSession.tabs, { id: "doc-1", kind: "file", path: "C:\\a.pdf", handler: "pdf", title: "a.pdf" }],
      },
      ["image"],
    );
    const placeholder = unknownHandler.tabs.find((tab) => tab.id === "doc-1");
    expect(placeholder?.missing_reason).toBe("handler_missing");
    expect(unknownHandler.tabs.map((tab) => tab.id)).toContain("img-1");
  });

  it("session_caps_tabs_and_history", () => {
    const tabs: { id: string; kind: string; path?: string; handler?: string }[] = [{ id: "explorer", kind: "explorer" }];
    for (let index = 0; index < 200; index += 1) {
      tabs.push({ id: `f-${index}`, kind: "file", path: `C:\\f-${index}.png`, handler: "image" });
    }
    expect(() => validateSessionData({ ...baseSession, tabs }, ["image"])).toThrow(SessionValidationError);
  });

  it("valid_session_round_trips_view_state", () => {
    const validated = validateSessionData(baseSession, ["image"]);
    const image = validated.tabs.find((tab) => tab.id === "img-1");
    expect(image?.view).toEqual({ mode: "manual", percent: 150, turns: 1 });
    expect(image?.view_version).toBe(1);
    expect(validated.history).toEqual(["explorer", "img-1"]);
  });
});
