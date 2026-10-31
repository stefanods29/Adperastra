import type { TFunction } from "i18next";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArchivePasswordDialog from "../archive/ArchivePasswordDialog";
import PasswordFields from "../archive/PasswordFields";
import { passwordStrength } from "../archive/passwordStrength";
import {
  useArchivePasswordPrompt,
  type ArchivePasswordPrompt,
} from "../archive/useArchivePasswordPrompt";
import i18n from "../i18n";
import type { ArchiveAuth, ArchiveSummary } from "../services/archive";
import { useArchiveSession } from "../handlers/archive/useArchiveSession";
import { UndoStack } from "../services/undo";
import type { TrackJob, TrackJobOptions } from "../views/explorer/JobsPanel";
import { useArchiveExtract } from "../views/explorer/useArchiveExtract";

vi.mock("../services/archive", () => ({
  archiveOpen: vi.fn(),
  archiveClose: vi.fn().mockResolvedValue(undefined),
  archiveFolder: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
  archiveSearch: vi.fn(),
  archiveExtract: vi.fn(),
  archivePickFolder: vi.fn(),
}));

import {
  archiveExtract,
  archiveFolder,
  archiveOpen,
  type ArchiveExtractReport,
} from "../services/archive";

const t = i18n.t.bind(i18n) as TFunction;
const SECRET = "synthetic secret phrase";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
}

function input(selector: string): HTMLInputElement | null {
  return container?.querySelector<HTMLInputElement>(selector) ?? null;
}

function button(label: string): HTMLButtonElement | null {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  return buttons.find((element) => element.getAttribute("aria-label") === label) ?? null;
}

const summary: ArchiveSummary = {
  session: "arcopen-1-1",
  format: "zip",
  files: 1,
  folders: 0,
  links: 0,
  encrypted_entries: 1,
  hidden_entries: 0,
  total_size: 3,
  packed_size: 3,
  partial: false,
  temporary: false,
};

describe("archive password dialog", () => {
  it("passwords start hidden and remember starts off", async () => {
    await render(<ArchivePasswordDialog name="a.zip" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(input('input[type="password"]')).not.toBeNull();
    expect(input('input[type="text"]')).toBeNull();
    const remember = input('input[type="checkbox"]');
    expect(remember?.checked).toBe(false);
    expect(input('input[type="password"]')?.getAttribute("autocomplete")).toBe("off");
  });

  it("show and hide change both accessible fields", async () => {
    function Probe() {
      return <PasswordFields
        value="one"
        onValueChange={() => undefined}
        confirmation="two"
        onConfirmationChange={() => undefined}
        show={false}
        onShowChange={() => undefined}
      />;
    }
    await render(<Probe />);
    expect(container?.querySelectorAll('input[type="password"]')).toHaveLength(2);
    // The real dialog owns the toggle; check both labels exist.
    await render(<ArchivePasswordDialog name="a.zip" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const show = button(t("archive.showPassword"));
    expect(show).not.toBeNull();
    await act(async () => show?.click());
    expect(input('input[type="password"]')).toBeNull();
    expect(button(t("archive.hidePassword"))).not.toBeNull();
    expect(container?.innerHTML).not.toContain(SECRET);
  });

  it("wrong password keeps a retry dialog without exposing the value", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("archive.bad_password");
    });
    await render(<ArchivePasswordDialog name="a.zip" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const field = input('input[type="password"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, SECRET);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const open = [...(container?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === t("archive.passwordOpen"),
    ) as HTMLButtonElement;
    await act(async () => {
      open.click();
      await Promise.resolve();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input('input[type="password"]')).not.toBeNull();
    expect(container?.textContent).toContain(t("errors.archive.bad_password"));
    expect(container?.textContent).not.toContain(SECRET);
  });

  it("strength classifies the exact examples", () => {
    expect(passwordStrength("")).toBe("weak");
    expect(passwordStrength("aaaa")).toBe("weak");
    expect(passwordStrength("abcdefgh")).toBe("fair");
    expect(passwordStrength("abcdefghijklmnop")).toBe("strong");
    expect(passwordStrength("ñandú-contraseña")).toBe("strong");
    expect(passwordStrength("ññññññññññññññññ")).toBe("weak");
  });
});

describe("archive password prompt", () => {
  it("cancel clears a pending secret and resolves once", async () => {
    let prompt: ArchivePasswordPrompt | null = null;
    function Probe() {
      prompt = useArchivePasswordPrompt();
      return prompt.dialog;
    }
    await render(<Probe />);
    let result: boolean | null = null;
    await act(async () => {
      const pending = prompt!.ask("a.zip", "archive.password_required", async () => undefined);
      pending.then((value) => {
        result = value;
      });
      await Promise.resolve();
    });
    expect(input('input[type="password"]')).not.toBeNull();
    const cancel = [...(container?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === t("common.cancel"),
    ) as HTMLButtonElement | undefined;
    await act(async () => cancel?.click());
    expect(result).toBe(false);
    expect(input('input[type="password"]')).toBeNull();
  });

  it("closing the tab cancels its pending prompt", async () => {
    let prompt: ArchivePasswordPrompt | null = null;
    function Probe() {
      prompt = useArchivePasswordPrompt();
      return prompt.dialog;
    }
    await render(<Probe />);
    let result: boolean | null = null;
    await act(async () => {
      prompt!
        .ask("a.zip", null, async () => undefined)
        .then((value) => {
          result = value;
        });
      await Promise.resolve();
    });
    await act(async () => root?.unmount());
    root = null;
    expect(result).toBe(false);
  });

  it("opening an encrypted entry asks and then opens the verified copy", async () => {
    vi.mocked(archiveOpen).mockRejectedValueOnce(new Error("archive.password_required"));
    vi.mocked(archiveOpen).mockResolvedValueOnce({
      id: "arcopen-1-1",
      cancel: async () => undefined,
      completion: Promise.resolve(summary),
    });
    const auth = { password: SECRET, remember_session: false } satisfies ArchiveAuth;
    const ask = vi.fn(async (_name: string, _code: string | null, attempt: (value: ArchiveAuth) => Promise<void>) => {
      await attempt(auth);
      return true;
    });
    let phase = "loading";
    function Probe() {
      const session = useArchiveSession("C:\\a.zip", ask);
      phase = session.phase.kind;
      return null;
    }
    await render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ask).toHaveBeenCalledOnce();
    expect(vi.mocked(archiveOpen).mock.calls[0]).toHaveLength(3);
    expect(vi.mocked(archiveOpen).mock.calls[1][2]).toEqual(auth);
    expect(phase).toBe("ready");
    expect(vi.mocked(archiveFolder)).toHaveBeenCalled();
  });

  it("partial extraction is not automatically repeated", async () => {
    const report: ArchiveExtractReport = {
      created: ["C:\\D\\a"],
      files_written: 1,
      folders_created: 0,
      skipped: [{ path: "b.txt", reason: "bad_password" }],
      skipped_more: 0,
      cancelled: false,
      opened: null,
      error: "archive.bad_password",
    };
    vi.mocked(archiveExtract).mockResolvedValue({
      id: "arcextract-1",
      cancel: async () => undefined,
      completion: Promise.resolve(report),
    });
    const askPassword = vi.fn(async () => true);
    let api: ReturnType<typeof useArchiveExtract> | null = null;
    function Probe() {
      api = useArchiveExtract({
        t,
        trackJob: (async (options: TrackJobOptions<ArchiveExtractReport>) => {
          const job = await options.start(() => undefined);
          return await job.completion;
        }) as TrackJob,
        undoStack: new UndoStack(),
        touchUndo: vi.fn(),
        notify: vi.fn(),
        notifyAction: vi.fn(),
        notifyError: vi.fn(),
        currentFolder: () => "C:\\D",
        showResult: vi.fn(),
        itemFor: (path) => ({
          path,
          name: path.split("\\").pop() ?? path,
          kind: "file",
          size: 100,
          modified_unix: 10,
          hidden: false,
          system: false,
          is_link: false,
          online_only: false,
          file_id: null,
          file_id_stable: false,
        }),
        askPassword,
      });
      return null;
    }
    await render(<Probe />);
    await act(async () => {
      await api!.extractItems(["C:\\D\\a.zip"], "newFolder");
    });
    expect(archiveExtract).toHaveBeenCalledTimes(1);
    expect(askPassword).not.toHaveBeenCalled();
  });
});
