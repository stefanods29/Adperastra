import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { useExtraView } from "../handlers/extraView/useExtraView";
import type { ExtraViewPage, ExtraViewSession } from "../services/extraViews";

const mocks = vi.hoisted(() => {
  const session = {
    session_id: "6f2e6a8e-4a4e-4f56-8f0b-2f3f6f4f7a10",
    source: {
      path_key: "C:\\a.log",
      volume_id: "00000000",
      file_id: "0000000000000000",
      modified_ticks: "1",
      size_bytes: 10,
    },
    kind: "log",
    title: "a.log",
    item_count: 0,
    partial: false,
  };
  const page = {
    session_id: session.session_id,
    kind: "log",
    payload: { kind: "log", lines: [] },
    next_cursor: null,
    complete: true,
    partial: false,
  };
  return {
    session,
    page,
    extraViewPage: vi.fn(async () => page),
    closeExtraView: vi.fn(async () => undefined),
    openExtraView: vi.fn(async () => ({
      id: "job",
      cancel: async () => undefined,
      completion: Promise.resolve(session),
    })),
  };
});

vi.mock("../services/extraViews", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/extraViews")>();
  return {
    ...original,
    extraViewPage: mocks.extraViewPage,
    closeExtraView: mocks.closeExtraView,
    openExtraView: mocks.openExtraView,
  };
});

function Probe({ active }: { active: boolean }) {
  const view = useExtraView("C:\\a.log", "log", active);
  return <span>{view.phase}</span>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.extraViewPage.mockClear();
  mocks.openExtraView.mockClear();
});

async function render(active: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe active={active} />);
  });
}

describe("extra view visibility", () => {
  it("activefalsecancels the automatic first page", async () => {
    await render(false);
    expect(mocks.openExtraView).toHaveBeenCalledTimes(1);
    expect(mocks.extraViewPage).not.toHaveBeenCalled();
    await act(async () => {
      root?.render(<Probe active />);
    });
    expect(mocks.extraViewPage).toHaveBeenCalledTimes(1);
    expect((mocks.session as unknown as ExtraViewSession).kind).toBe("log");
    expect((mocks.page as unknown as ExtraViewPage).kind).toBe("log");
  });
});
