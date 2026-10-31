import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import HexView from "../handlers/hex/HexView";
import type { FileTypeInfo } from "../services/files";

const statuses: string[][] = [];

function fileInfo(size: number): FileTypeInfo {
  return {
    path: "C:\\data\\sample.bin",
    name: "sample.bin",
    ext: "bin",
    mime: "application/octet-stream",
    size,
    modified_unix: 0,
    online_only: false,
    read_only: false,
    from_internet: false,
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function rangeFetch(data: Uint8Array<ArrayBuffer>) {
  return vi.fn(async (_input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const match = /bytes=(\d+)-(\d+)/.exec(headers.Range ?? "");
    if (!match) return new Response(data);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]) + 1, data.length);
    return new Response(data.slice(start, end));
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  });
}

interface RenderOptions {
  size?: number;
  find?: { text: string; request: number };
  active?: boolean;
  savedState?: unknown;
}

async function render(options: RenderOptions = {}): Promise<void> {
  const size = options.size ?? 64;
  const find = options.find ?? { text: "", request: 0 };
  await act(async () =>
    root?.render(
      <HexView
        info={fileInfo(size)}
        url="http://adpfile.localhost/token/sample.bin"
        active={options.active ?? true}
        savedState={options.savedState ?? null}
        onStateChange={() => undefined}
        onStatus={(status) => statuses.push(status.items)}
        onOpenInWindowsApp={() => undefined}
        find={{ text: find.text, request: find.request, backwards: false }}
        protectedView={false}
      />,
    ),
  );
  await flush();
}

function allStatus(): string {
  return statuses.flat().join(" ");
}

beforeEach(() => {
  statuses.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("hex find", () => {
  it("Enter finds and shows the offset", async () => {
    const data = new Uint8Array(64);
    data.set(bytesOf("FINDME"), 10);
    vi.stubGlobal("fetch", rangeFetch(data));
    await render({ size: 64 });
    await render({ size: 64, find: { text: "FINDME", request: 1 } });
    await flush();
    expect(allStatus()).toContain("Found at 0000000A");
    expect(container!.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it("a match in a later part moves there", async () => {
    const size = 3 * 1024 * 1024;
    const data = new Uint8Array(size);
    data.set(bytesOf("FINDME"), 2_097_150);
    const fetchMock = rangeFetch(data);
    vi.stubGlobal("fetch", fetchMock);
    await render({ size });
    await render({ size, find: { text: "FINDME", request: 1 } });
    await flush();
    expect(allStatus()).toContain("Part 3 of 3");
    expect(allStatus()).toContain("Found at 001FFFFE");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { Range: "bytes=2097152-3145727" },
    });
  });

  it("bad bytes say so without reading", async () => {
    const data = new Uint8Array(64);
    const fetchMock = rangeFetch(data);
    vi.stubGlobal("fetch", fetchMock);
    await render({ size: 64, savedState: { zoom: 1, searchMode: "bytes" } });
    await render({
      size: 64,
      savedState: { zoom: 1, searchMode: "bytes" },
      find: { text: "4", request: 1 },
    });
    await flush();
    expect(allStatus()).toContain("pairs of hex digits");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a read failure doesn't show the view's error", async () => {
    const data = new Uint8Array(64);
    data.set(bytesOf("FINDME"), 10);
    const good = rangeFetch(data);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) return good(input, init);
        throw new Error("files.read_failed");
      }),
    );
    await render({ size: 64 });
    await render({ size: 64, find: { text: "FINDME", request: 1 } });
    await flush();
    expect(allStatus()).toContain("to the end");
    expect(container!.textContent).not.toContain("The bytes of this file");
  });

  it("Ctrl+G goes to the offset", async () => {
    const data = new Uint8Array(64);
    vi.stubGlobal("fetch", rangeFetch(data));
    await render({ size: 64 });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true }));
    });
    const input = container!.querySelector<HTMLInputElement>(".adp-dialog input");
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1F");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const go = [...container!.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Go",
    );
    await act(async () => go?.click());
    await flush();
    expect(container!.querySelector(".adp-dialog")).toBeNull();
    expect(allStatus()).toContain("Found at 0000001F");
  });

  it("a bad offset keeps the window open", async () => {
    const data = new Uint8Array(64);
    vi.stubGlobal("fetch", rangeFetch(data));
    await render({ size: 64 });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true }));
    });
    const input = container!.querySelector<HTMLInputElement>(".adp-dialog input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ZZ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const go = [...container!.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Go",
    );
    await act(async () => go?.click());
    expect(container!.querySelector(".adp-dialog")).not.toBeNull();
    expect(container!.textContent).toContain("Enter an offset between 0 and");
  });

  it("going inactive cancels the search", async () => {
    const data = new Uint8Array(64);
    data.set(bytesOf("FINDME"), 10);
    const good = rangeFetch(data);
    let release: ((response: Response) => void) | null = null;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) return good(input, init);
        return gate;
      }),
    );
    await render({ size: 64 });
    await render({ size: 64, find: { text: "FINDME", request: 1 } });
    await render({ size: 64, find: { text: "FINDME", request: 1 }, active: false });
    await act(async () => release?.(new Response(data.slice(0, 64))));
    await flush();
    expect(allStatus()).not.toContain("Found at");
  });
});
