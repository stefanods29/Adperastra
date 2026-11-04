import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("helper isolation policy", () => {
  it("lets Tauri add only its runtime isolation origin without a conflicting static frame policy", () => {
    const config = JSON.parse(read("src-tauri/tauri.helper.conf.json"));
    const policy: string = config.app.security.csp;
    expect(config.app.security.pattern.use).toBe("isolation");
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toMatch(/(?:^|;)\s*(?:frame-src|child-src)\s/);
    expect(policy).not.toMatch(/\*|unsafe-eval|wasm-unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("connect-src 'self' http://adpfile.localhost;");
  });

  it.each(["pdf", "book", "model", "psd", "pdf-write", "office-quick", "presentation"])(
    "%s uses the native CSP that contains the exact runtime isolation origin",
    (kind) => {
      const document = new DOMParser().parseFromString(read(`${kind}-helper.html`), "text/html");
      expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
      expect(document.querySelector('script[type="module"]')).not.toBeNull();
    },
  );
});
