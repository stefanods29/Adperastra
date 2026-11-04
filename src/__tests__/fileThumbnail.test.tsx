import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/thumbnails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/thumbnails")>();
  return {
    ...actual,
    requestThumbnail: vi.fn(),
    releaseThumbnail: vi.fn(),
  };
});

vi.mock("../services/background", () => ({
  subscribeBackgroundEligible: vi.fn(),
}));

import FileThumbnail from "../components/FileThumbnail";
import { subscribeBackgroundEligible } from "../services/background";
import type { JobHandle } from "../services/jobs";
import {
  releaseThumbnail,
  requestThumbnail,
  type ThumbnailReply,
} from "../services/thumbnails";

const lease = {
  lease_id: "11111111-1111-4111-8111-111111111111",
  token: "b".repeat(32),
  name: "thumbnail.png",
  mime: "image/png",
  byte_len: 120,
};

const otherLease = {
  ...lease,
  lease_id: "22222222-2222-4222-8222-222222222222",
  token: "c".repeat(32),
};

function handle(reply: ThumbnailReply): JobHandle<ThumbnailReply> {
  return {
    id: "thumb",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(reply),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
}

async function rerender(element: ReactElement) {
  await act(async () => {
    root?.render(element);
  });
}

beforeEach(() => {
  vi.mocked(requestThumbnail).mockReset();
  vi.mocked(releaseThumbnail).mockReset();
  vi.mocked(releaseThumbnail).mockResolvedValue(undefined);
  vi.mocked(subscribeBackgroundEligible).mockReset();
  vi.mocked(subscribeBackgroundEligible).mockReturnValue(vi.fn());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("FileThumbnail", () => {
  it("retries paused work when the shared policy becomes eligible and stops watching on hide", async () => {
    let resume = () => {};
    const stop = vi.fn();
    vi.mocked(subscribeBackgroundEligible).mockImplementation((callback) => {
      resume = callback;
      return stop;
    });
    vi.mocked(requestThumbnail)
      .mockResolvedValueOnce(handle({ state: "paused" }))
      .mockResolvedValueOnce(handle({ state: "ready", lease }));
    const props = { path: "C:\\Pictures\\a.png", edge: 128 as const,
      fallback: <span>{"icon"}</span> };
    await render(<FileThumbnail {...props} active />);
    expect(subscribeBackgroundEligible).toHaveBeenCalledTimes(1);
    await act(async () => resume());
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(container!.querySelector("img")?.getAttribute("src")).toContain(lease.token);
    await rerender(<FileThumbnail {...props} active={false} />);
    expect(releaseThumbnail).toHaveBeenCalledTimes(2);
  });
  it("shows a ready lease as an inert, hidden image over the existing tile", async () => {
    vi.mocked(requestThumbnail).mockResolvedValue(
      handle({ state: "ready", lease }),
    );
    await render(
      <FileThumbnail
        path="C:\\Pictures\\a.png"
        edge={128}
        active
        fallback={<span>{"file icon"}</span>}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const image = container!.querySelector("img.adp-file-thumbnail")!;
    expect(image.getAttribute("src")).toBe(
      `http://adpfile.localhost/${lease.token}/thumbnail.png`,
    );
    expect(image.getAttribute("aria-hidden")).toBe("true");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.hasAttribute("tabindex")).toBe(false);
    expect(image.getAttribute("role")).toBeNull();
    expect(container!.textContent).not.toContain("file icon");
  });

  it("keeps the grid fallback for online-only and unsupported pictures", async () => {
    vi.mocked(requestThumbnail).mockResolvedValue(handle({ state: "online_only" }));
    await render(
      <FileThumbnail
        path="C:\\Pictures\\cloud.png"
        edge={64}
        active
        fallback={<span>{"cloud icon"}</span>}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.textContent).toContain("cloud icon");
  });

  it("a late reply for an old path cannot replace the newer picture", async () => {
    const first = deferred<JobHandle<ThumbnailReply>>();
    const second = deferred<JobHandle<ThumbnailReply>>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render(
      <FileThumbnail
        path="C:\\Pictures\\a.png"
        edge={128}
        active
        fallback={<span>{"first fallback"}</span>}
      />,
    );
    await rerender(
      <FileThumbnail
        path="C:\\Pictures\\b.png"
        edge={128}
        active
        fallback={<span>{"second fallback"}</span>}
      />,
    );
    await act(async () => {
      second.resolve(handle({ state: "ready", lease: otherLease }));
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve(handle({ state: "ready", lease }));
      await Promise.resolve();
    });
    const image = container!.querySelector("img.adp-file-thumbnail")!;
    expect(image.getAttribute("src")).toContain(otherLease.token);
    expect(image.getAttribute("src")).not.toContain(lease.token);
  });

  it("unmount releases the pending consumer exactly once", async () => {
    const pending = deferred<JobHandle<ThumbnailReply>>();
    vi.mocked(requestThumbnail).mockReturnValue(pending.promise);
    await render(
      <FileThumbnail
        path="C:\\Pictures\\pending.png"
        edge={256}
        active
        fallback={<span>{"icon"}</span>}
      />,
    );
    const request = vi.mocked(requestThumbnail).mock.calls[0][0];
    await act(async () => root?.unmount());
    root = null;
    expect(releaseThumbnail).toHaveBeenCalledTimes(1);
    expect(releaseThumbnail).toHaveBeenCalledWith(request.consumer_id);
  });

  it("refreshes the same path after its listing entry changes", async () => {
    vi.mocked(requestThumbnail)
      .mockResolvedValueOnce(handle({ state: "ready", lease }))
      .mockResolvedValueOnce(handle({ state: "ready", lease: otherLease }));
    const props = { path: "C:\\Pictures\\a.png", edge: 128 as const, active: true,
      fallback: <span>{"icon"}</span> };
    await render(<FileThumbnail {...props} sourceRevision={{}} />);
    await rerender(<FileThumbnail {...props} sourceRevision={{}} />);
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(releaseThumbnail).toHaveBeenCalledTimes(1);
    expect(container!.querySelector("img")?.getAttribute("src")).toContain(otherLease.token);
  });

  it("does nothing while inactive", async () => {
    await render(
      <FileThumbnail
        path="C:\\Pictures\\a.png"
        edge={128}
        active={false}
        fallback={<span>{"icon"}</span>}
      />,
    );
    expect(requestThumbnail).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("icon");
  });
});
