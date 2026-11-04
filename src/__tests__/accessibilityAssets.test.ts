import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fontsDir = join(root, "src", "assets", "fonts");

/** Pinned OpenDyslexic assets (Step 10f T1). Source: official repository
 * commit 1824da5c0e41dc3e13ffc7f3a636dcaf695d61b7, SIL OFL 1.1. The
 * coordinator downloads the bytes; this test proves what landed. */
const PINNED: ReadonlyArray<{ file: string; bytes: number; sha256: string }> = [
  {
    file: "OpenDyslexic-Regular.woff2",
    bytes: 103336,
    sha256: "0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695",
  },
  {
    file: "OpenDyslexic-Bold.woff2",
    bytes: 108068,
    sha256: "b534a0b84ef3cca941ebdb506ce3f4e0010aa4ef881271bac8b6959dbf694fbf",
  },
  {
    file: "OpenDyslexic-Italic.woff2",
    bytes: 107968,
    sha256: "b18685dcb99b4ba903549d215c0ae2ab39a5087097614fd4100ae6d387332b47",
  },
  {
    file: "OpenDyslexic-Bold-Italic.woff2",
    bytes: 118048,
    sha256: "1aadc8fa9656c92c09c8194790d0671bcd2b4bd961ba41fb8f7e605e5c493be0",
  },
];

const OFL_SHA256 = "caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("pinned OpenDyslexic assets", () => {
  it("four bytes/hashes match the source table", () => {
    for (const pinned of PINNED) {
      const bytes = readFileSync(join(fontsDir, pinned.file));
      expect(bytes.length, pinned.file).toBe(pinned.bytes);
      expect(sha256(bytes), pinned.file).toBe(pinned.sha256);
    }
  });

  it("keeps the OFL license with the fonts (OFLpreserved)", () => {
    const license = readFileSync(join(fontsDir, "OFL.txt"));
    expect(sha256(license)).toBe(OFL_SHA256);
    expect(license.toString("utf8")).toContain("SIL OPEN FONT LICENSE");
  });

  it("bundles no other font (nofontfromMicrosoftbundled)", () => {
    const entries = readdirSync(fontsDir).sort();
    expect(entries).toEqual([...PINNED.map((p) => p.file), "OFL.txt"].sort());
  });
});
