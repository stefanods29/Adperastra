import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import CreateLockedCopyDialog from "../locked/CreateLockedCopyDialog";
import UnlockDialog from "../locked/UnlockDialog";
import LockedFolderView from "../locked/LockedFolderView";

const session = {
  session_id: "11111111-1111-4111-8111-111111111111",
  container_path: "C:\\Vault\\v.adplock",
  container_id: "33333333-3333-4333-8333-333333333333",
  revision: 1,
  entry_count: 1,
  dirty: false,
  state: "unlocked" as const,
  pending_recovery: false,
  can_save_existing: false as const,
  can_save_copy: true,
};

const fileEntry = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  parent_id: null,
  name: "archive.zip",
  kind: "file" as const,
  mime: "application/zip",
  size: 10,
  modified_unix: 10,
  chunks: [],
  from_internet: false,
  hidden: false,
  system: false,
  read_only: true,
};

const jobs = {
  create: null as null | { completion: Promise<unknown> },
  unlock: null as null | { completion: Promise<unknown> },
};

vi.mock("../services/lockedFolders", () => ({
  createLockedCopy: vi.fn((_request: unknown) => jobs.create),
  unlockLockedFolder: vi.fn((_request: unknown) => jobs.unlock),
  listLockedEntries: vi.fn(async () => ({
    entries: [fileEntry],
    next_cursor: null,
    complete: true,
    session_id: session.session_id,
    revision: 1,
  })),
  saveLockedCopy: vi.fn(),
  lockFolder: vi.fn(),
  pickLockedRecoveryPath: vi.fn(async () => "D:\\Keys\\v.adprecovery"),
  lockedEntryInfo: vi.fn(async () => fileEntry),
  readLockedEntry: vi.fn(async () => new Uint8Array()),
  releaseLockedEntry: vi.fn(async () => undefined),
  touchLockedSession: vi.fn(async () => undefined),
  markLockedDirty: vi.fn(async () => undefined),
  persistLockedSnapshot: vi.fn(),
  listLockedRecovery: vi.fn(async () => []),
  chooseLockedRecovery: vi.fn(),
  exportUnlockedCopy: vi.fn(),
  registerLockedModelPersister: vi.fn(),
}));

vi.mock("../services/textFiles", () => ({
  pickSavePath: vi.fn(async () => "C:\\Vault\\copy.adplock"),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(element: ReactElement): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  jobs.create = { completion: Promise.resolve({ path: "C:\\Vault\\v.adplock", container_id: "33333333-3333-4333-8333-333333333333", recovery_path: "D:\\Keys\\v.adprecovery", original_kept: true, skipped: 0 }) };
  jobs.unlock = { completion: Promise.resolve(session) };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

describe("locked folder dialogs", () => {
  it("keeps password spaces exactly and requires twelve Unicode scalar values", async () => {
    const onCreated = vi.fn();
    render(
      <CreateLockedCopyDialog
        sourceDir="C:\\Docs"
        onCreated={onCreated}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const password = host?.querySelector(`input[aria-label="${i18n.t("locked.password")}"]`) as HTMLInputElement;
    const confirm = host?.querySelector(`input[aria-label="${i18n.t("locked.confirmPassword")}"]`) as HTMLInputElement;
    const destination = host?.querySelector(`input[aria-label="${i18n.t("locked.destination")}"]`) as HTMLInputElement;
    const recovery = host?.querySelector(`input[aria-label="${i18n.t("locked.recoveryKey")}"]`) as HTMLInputElement;
    const checkbox = host?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      setInput(password, "short ");
      setInput(confirm, "short ");
      setInput(destination, "C:\\Vault\\v.adplock");
      setInput(recovery, "D:\\Keys\\v.adprecovery");
      checkbox.click();
    });
    const form = host?.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect((await import("../services/lockedFolders")).createLockedCopy).not.toHaveBeenCalled();

    await act(async () => {
      setInput(password, "twelve chars ");
      setInput(confirm, "twelve chars ");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const call = vi.mocked((await import("../services/lockedFolders")).createLockedCopy).mock.calls[0]?.[0] as
      | { password?: string; confirm_original_unprotected?: boolean }
      | undefined;
    expect(call?.password).toBe("twelve chars ");
    expect(call?.confirm_original_unprotected).toBe(true);
  });

  it("reports a recovery export collision without creating another job", async () => {
    const collision = Promise.reject(new Error("locked.invalid"));
    // The dialog awaits this rejection; mark it handled while it is unused.
    void collision.catch(() => undefined);
    jobs.create = { completion: collision };
    render(
      <CreateLockedCopyDialog
        sourceDir="C:\\Docs"
        onCreated={() => undefined}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const password = host?.querySelector(`input[aria-label="${i18n.t("locked.password")}"]`) as HTMLInputElement;
    const confirm = host?.querySelector(`input[aria-label="${i18n.t("locked.confirmPassword")}"]`) as HTMLInputElement;
    const destination = host?.querySelector(`input[aria-label="${i18n.t("locked.destination")}"]`) as HTMLInputElement;
    const recovery = host?.querySelector(`input[aria-label="${i18n.t("locked.recoveryKey")}"]`) as HTMLInputElement;
    const checkbox = host?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      setInput(password, "twelve chars ");
      setInput(confirm, "twelve chars ");
      setInput(destination, "C:\\Vault\\v.adplock");
      setInput(recovery, "D:\\Keys\\v.adprecovery");
      checkbox.click();
    });
    await act(async () => {
      (host?.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = host?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(i18n.t("locked.recoveryCollision"));
  });

  it("uses the recovery-key credential and keeps the warning readable", async () => {
    render(
      <UnlockDialog
        path="C:\\Vault\\v.adplock"
        onUnlocked={() => undefined}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const recoveryRadio = host?.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement;
    await act(async () => {
      recoveryRadio.click();
    });
    const browse = Array.from(host?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes(i18n.t("locked.browse")),
    );
    await act(async () => {
      browse?.click();
      await Promise.resolve();
    });
    const recovery = host?.querySelector(`input[aria-label="${i18n.t("locked.recoveryKey")}"]`) as HTMLInputElement;
    expect(recovery.value).toBe("D:\\Keys\\v.adprecovery");
    const warning = host?.querySelector(".adp-locked-note");
    expect(warning?.textContent).toBeTruthy();
    await act(async () => {
      (host?.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    const request = vi.mocked((await import("../services/lockedFolders")).unlockLockedFolder).mock.calls[0]?.[0] as
      | { credential?: unknown }
      | undefined;
    expect(request?.credential).toEqual({ kind: "recovery", recovery_path: "D:\\Keys\\v.adprecovery" });
  });
});

describe("locked folder view", () => {
  it("shows an explicit unsupported route and opens with the keyboard", async () => {
    const onOpenEntry = vi.fn(async () => {
      throw new Error("locked.unsupported");
    });
    render(
      <LockedFolderView
        session={session}
        parentId={null}
        active
        onOpenEntry={onOpenEntry}
        onSessionChange={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const row = host?.querySelector('[role="option"]') as HTMLButtonElement;
    await act(async () => {
      row.click();
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("locked.unsupported"));
    expect(onOpenEntry).toHaveBeenCalled();

    onOpenEntry.mockClear();
    await act(async () => {
      row.click();
    });
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(onOpenEntry).toHaveBeenCalledWith(fileEntry.id);
  });
});
