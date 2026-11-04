import { readFileSync } from "node:fs";
import { repoUrl } from "./nodeUrl";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(repoUrl(relative, import.meta.url), "utf8");

const manifest = read("../../crates/search-index/Cargo.toml");

describe("search index dependencies", () => {
  it("pins rusqlite with bundled SQLite and the hooks feature", () => {
    expect(manifest).toContain('rusqlite = { version = "0.41.1", features = ["bundled", "hooks"] }');
    expect(manifest).not.toContain("load_extension");
  });

  it("pins regex 1.13.1 without default features", () => {
    expect(manifest).toContain('regex = { version = "1.13.1"');
    expect(manifest).toContain('default-features = false');
    expect(manifest).toContain('features = ["std", "perf", "unicode"]');
  });

  it("pins notify 8.2.1 and adds no GPL dependency", () => {
    expect(manifest).toContain('notify = "8.2.1"');
    expect(manifest.toLowerCase()).not.toContain("gpl");
  });

  it("is registered as a workspace member and a native dependency", () => {
    const workspace = read("../../Cargo.toml");
    const native = read("../../src-tauri/Cargo.toml");
    expect(workspace).toContain("crates/search-index");
    expect(native).toContain('search-index = { path = "../crates/search-index" }');
  });

  it("keeps the resolved versions and records the direct regex notice", () => {
    const lock = read("../../Cargo.lock");
    expect(lock).toContain('name = "rusqlite"\nversion = "0.41.1"');
    expect(lock).toContain('name = "notify"\nversion = "8.2.1"');
    expect(lock).toContain('name = "regex"\nversion = "1.13.1"');
    const notices = read("../../THIRD_PARTY_LICENSES.md");
    expect(notices.toLowerCase()).toContain("regex");
    expect(notices).toContain("1.13.1");
  });
});