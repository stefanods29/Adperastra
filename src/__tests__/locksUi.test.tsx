import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";
import FilesInUseDialog from "../locks/FilesInUseDialog";
import {
  inspectFileLocks,
  requestProcessClose,
  type CloseLockProcessResult,
  type FileLockReport,
  type LockProcess,
} from "../services/fileLocks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("../services/fileLocks", () => ({
  inspectFileLocks: vi.fn(),
  requestProcessClose: vi.fn(),
}));

const inspectMock = vi.mocked(inspectFileLocks);
const closeMock = vi.mocked(requestProcessClose);

function process(canClose: boolean): LockProcess {
  return {
    pid: 321,
    start_ticks: "133000000000000000",
    name: "notepad.exe",
    application: "Notepad",
    can_close: canClose,
    ...(canClose ? {} : { reason: "system" as const }),
    session_id: 1,
  };
}

function report(processes: LockProcess[], folder = false): FileLockReport {
  return {
    paths: ["C:\\Docs\\report.txt"],
    processes,
    complete: true,
    folder_nonrecursive: folder,
  };
}

function job<T>(result: T) {
  return {
    id: "job-1",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: {
  onRetry?: () => Promise<void>;
  onClose?: () => void;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onRetry = props.onRetry ?? vi.fn(async () => undefined);
  const onClose = props.onClose ?? vi.fn();
  await act(async () => {
    root!.render(
      <FilesInUseDialog
        paths={["C:\\Docs\\report.txt"]}
        onRetry={onRetry}
        onClose={onClose}
        onOpenHelp={() => undefined}
      />,
    );
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
  return { onRetry, onClose };
}

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === name,
  );
}

beforeEach(() => {
  inspectMock.mockReset();
  closeMock.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("files in use", () => {
  it("warns before asking a program to close", async () => {
    inspectMock.mockResolvedValue(job(report([process(true)])));
    closeMock.mockResolvedValue(job<CloseLockProcessResult>({ status: "requested" }));
    await render();
    await act(async () => {
      button(i18n.t("locks.close"))?.click();
    });
    expect(document.body.textContent).toContain(
      i18n.t("locks.confirm", { name: "notepad.exe" }),
    );
    expect(closeMock).not.toHaveBeenCalled();
    const confirm = document.querySelector(".adp-locks-confirm");
    const confirmButton = [...(confirm?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent === i18n.t("locks.close"),
    );
    await act(async () => {
      confirmButton?.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(closeMock).toHaveBeenCalledWith({
      pid: 321,
      start_ticks: "133000000000000000",
      confirmed: true,
    });
    expect(document.body.textContent).toContain(i18n.t("locks.requested"));
  });

  it("Escape closes the confirmation, not the program", async () => {
    inspectMock.mockResolvedValue(job(report([process(true)])));
    const { onClose } = await render();
    await act(async () => {
      button(i18n.t("locks.close"))?.click();
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(closeMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(button(i18n.t("locks.close"))).toBeDefined();
  });

  it("a protected program keeps its close button disabled", async () => {
    inspectMock.mockResolvedValue(job(report([process(false)])));
    await render();
    const close = button(i18n.t("locks.close"));
    expect(close?.disabled).toBe(true);
    expect(close?.title).toBe(i18n.t("locks.protected"));
    expect(document.body.textContent).toContain(i18n.t("locks.protected"));
  });

  it("shows the folder note and the empty result", async () => {
    inspectMock.mockResolvedValue(job(report([], true)));
    await render();
    expect(document.body.textContent).toContain(i18n.t("locks.folderNote"));
    expect(document.body.textContent).toContain(i18n.t("locks.none"));
  });

  it("retries the original action only when the user asks", async () => {
    inspectMock.mockResolvedValue(job(report([])));
    const { onRetry, onClose } = await render();
    await act(async () => {
      button(i18n.t("locks.retry"))?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
