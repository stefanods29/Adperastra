import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { officeHandlers } from "../handlers/office";
import { defaultSettings, normalizeSettings, SETTINGS_SCHEMA_VERSION } from "../services/settings";
import { officeViewStateCodec } from "../services/officeViewTypes";

describe("Office help and settings", () => {
  it("migration37_keeps_pack_policy", () => {
    const migrated = normalizeSettings({
      schema_version: 37,
      packs: { selected: ["office"] },
      office_view: {
        prefer_accurate: false,
        show_comments: true,
        keep_engine_warm: false,
        idle_seconds: 30,
      },
    });
    expect(SETTINGS_SCHEMA_VERSION).toBe(56);
    expect(migrated.schema_version).toBe(56);
    expect(migrated.office_view).toEqual({
      prefer_accurate: false,
      show_comments: true,
      keep_engine_warm: false,
      idle_seconds: 60,
    });
    expect(defaultSettings().office_view.idle_seconds).toBe(60);
  });

  it("saved_view_no_tokens", () => {
    const encoded = officeViewStateCodec.encode({
      section_id: "sheet:2",
      page: 4,
      zoom: 125,
      scroll_top: 120.5,
      mode: "pages",
      token: "0123456789abcdef0123456789abcdef",
      lease_id: "00000000-0000-4000-8000-000000000000",
      session_id: "00000000-0000-4000-8000-000000000001",
      password: "private",
      text: "document body",
    });
    const text = JSON.stringify(encoded);
    expect(text).not.toContain("token");
    expect(text).not.toContain("lease");
    expect(text).not.toContain("session");
    expect(text).not.toContain("password");
    expect(text).not.toContain("document body");
    expect(encoded.section_id).toBe("sheet:2");
    expect(encoded.page).toBe(4);
    expect(encoded.zoom).toBe(125);
  });

  it("all_three_handler_help_links", () => {
    expect(officeHandlers).toHaveLength(3);
    for (const handler of officeHandlers) {
      expect(handler.helpSlug).toBe("viewing-office");
      expect(handler.editable).toBe(false);
      expect(handler.maxBytes).toBe(512 * 1024 * 1024);
    }
    for (const language of ["en", "es"]) {
      for (const slug of ["viewing-office", "presentation-mode", "fonts-layout"]) {
        expect(existsSync(resolve(process.cwd(), "help", language, `${slug}.md`))).toBe(true);
      }
    }
  });
});
