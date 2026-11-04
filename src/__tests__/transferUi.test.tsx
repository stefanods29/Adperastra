import { invoke } from "@tauri-apps/api/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import ConflictDialog from "../transfers/ConflictDialog";
import TransferWindow from "../transfers/TransferWindow";
import type { TransferDecisionRequest } from "../services/transferJobs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/settings", () => ({ isTauriRuntime: () => true }));

const invokeMock = vi.mocked(invoke);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type BareState = {
  job_id: string;
  state: string;
  progress: {
    items_done: number;
    items_total: number;
    bytes_done: number;
    bytes_total: number;
    current: string;
  };
  bytes_per_second: number | null;
  eta_seconds: number | null;
  current_item_id: string | null;
  decision: null;
  generation: number;
};

const runningState = (overrides: Partial<BareState> = {}): BareState => ({
  job_id: "job-1",
  state: "running",
  progress: {
    items_done: 1,
    items_total: 4,
    bytes_done: 1024,
    bytes_total: 4096,
    current: "C:\\A\\a.bin",
  },
  bytes_per_second: 1_048_576,
  eta_seconds: 3,
  current_item_id: "item-1",
  decision: null,
  generation: 1,
  ...overrides,
});

const request = (overrides: Partial<TransferDecisionRequest> = {}): TransferDecisionRequest => ({
  decision_id: "11111111-1111-4111-8111-111111111111",
  item_id: "22222222-2222-4222-8222-222222222222",
  kind: "conflict",
  source_path: "C:\\A\\report.txt",
  target_path: "C:\\B\\report.txt",
  source: {
    path_key: "C:\\A\\report.txt",
    volume_id: "1a2b3c4d",
    file_id: "00000000000000ff",
    modified_ticks: "133500000000000000",
    size_bytes: 2048,
  },
  target: {
    path_key: "C:\\B\\report.txt",
    volume_id: "1a2b3c4d",
    file_id: "00000000000000aa",
    modified_ticks: "133500000000000000",
    size_bytes: 1024,
  },
  source_kind: "file",
  target_kind: "file",
  error_code: null,
  attempt: 0,
  allowed: ["skip", "keepBoth", "cancel"],
  replace_available: false,
  ...overrides,
});

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  // Let the first poll promise settle.
  await act(async () => {});
}

async function rerender(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
  await act(async () => {});
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => (button.textContent ?? "").trim() === text,
  );
  if (!found) throw new Error(`no button labelled ${text}`);
  return found;
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.useFakeTimers();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("the transfer window", () => {
  beforeEach(() => {
    let current = runningState();
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "transfer_state") return current;
      if (command === "transfer_control") {
        const action = (args as { control: { action: string } }).control.action;
        current = runningState({
          state: action === "pause" ? "paused" : "running",
          generation: current.generation + 1,
        });
        return current;
      }
      return null;
    });
  });

  it("pauses and resumes from real buttons", async () => {
    await mount(
      <TransferWindow jobId="job-1" onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const pause = buttonByText(i18n.t("transferJobs.pause"));
    expect(pause.type).toBe("button");
    expect(pause.tabIndex).not.toBe(-1);
    expect(pause.disabled).toBe(false);
    await act(async () => {
      pause.click();
    });
    const control = invokeMock.mock.calls.find(([command]) => command === "transfer_control");
    expect(control?.[1]).toEqual({
      jobId: "job-1",
      control: { action: "pause", expected_generation: 1 },
    });

    await act(async () => {});
    const resume = buttonByText(i18n.t("transferJobs.resume"));
    expect(resume.disabled).toBe(false);
    await act(async () => {
      resume.click();
    });
    const actions = invokeMock.mock.calls
      .filter(([command]) => command === "transfer_control")
      .map(([, args]) => (args as { control: { action: string } }).control.action);
    expect(actions).toEqual(["pause", "resume"]);
  });

  it("closing the panel does not cancel the job", async () => {
    await mount(
      <TransferWindow jobId="job-1" onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("job_cancel");
    expect(
      invokeMock.mock.calls.some(
        ([command, args]) =>
          command === "transfer_control" &&
          (args as { control: { action: string } }).control.action === "cancel",
      ),
    ).toBe(false);
  });

  it("shows the speed, the remaining time and the problems section", async () => {
    await mount(
      <TransferWindow jobId="job-1" onClose={() => undefined} onOpenHelp={() => undefined} />,
    );
    const text = container!.textContent ?? "";
    expect(text).toContain(i18n.t("transferJobs.problems"));
    expect(text).toContain(i18n.t("transferJobs.report"));
    expect(text).toContain("1 MB/s");
    expect(text).toContain("3 seconds");
  });
});

describe("the conflict window", () => {
  it("explains why Replace is disabled", async () => {
    await mount(
      <ConflictDialog
        request={request()}
        generation={1}
        onDecision={async () => undefined}
        onClose={() => undefined}
      />,
    );
    const replace = buttonByText(i18n.t("conflicts.replace"));
    const newer = buttonByText(i18n.t("conflicts.replaceNewer"));
    expect(replace.disabled).toBe(true);
    expect(newer.disabled).toBe(true);
    expect(replace.getAttribute("title")).toBe(i18n.t("conflicts.replaceReason"));
    expect(container!.textContent).toContain(i18n.t("conflicts.replaceReason"));
    // Merge is not offered for two files.
    expect(container!.textContent).not.toContain(i18n.t("conflicts.merge"));
  });

  it("ignores an answer that belongs to a previous question", async () => {
    let release: (() => void) | null = null;
    const onDecision = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await mount(
      <ConflictDialog
        request={request()}
        generation={1}
        onDecision={onDecision}
        onClose={() => undefined}
      />,
    );
    await act(async () => {
      buttonByText(i18n.t("conflicts.keepBoth")).click();
    });
    expect(onDecision).toHaveBeenCalledTimes(1);

    // A newer conflict replaces the window while the first answer is in
    // flight; the first acknowledgement must not touch it.
    await rerender(
      <ConflictDialog
        request={request({
          decision_id: "99999999-9999-4999-8999-999999999999",
          source_path: "C:\\A\\other.txt",
          target_path: "C:\\B\\other.txt",
        })}
        generation={2}
        onDecision={onDecision}
        onClose={() => undefined}
      />,
    );
    await act(async () => {
      release?.();
    });
    const keepBoth = buttonByText(i18n.t("conflicts.keepBoth"));
    expect(keepBoth.disabled).toBe(false);
    expect(container!.textContent).not.toContain(i18n.t("errors.ops.decision_stale"));
    expect(container!.textContent).toContain("other.txt");
  });

  it("fits the long Spanish labels in the same dialog", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    await mount(
      <ConflictDialog
        request={request()}
        generation={1}
        onDecision={async () => undefined}
        onClose={() => undefined}
      />,
    );
    const window = container!.querySelector(".adp-conflict-window");
    expect(window).not.toBeNull();
    expect(buttonByText(i18n.t("conflicts.keepBoth"))).toBeTruthy();
    expect(buttonByText(i18n.t("conflicts.replaceNewer"))).toBeTruthy();
    expect(container!.textContent).toContain(i18n.t("conflicts.applyAll"));
    expect(container!.textContent).toContain(i18n.t("conflicts.replaceReason"));
  });
});
