import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";
import DiagnosticsDialog from "../diagnostics/DiagnosticsDialog";
import RecoveryDialog from "../recovery/RecoveryDialog";
import TabErrorBoundary from "../components/TabErrorBoundary";
import type { DiagnosticEdit, DiagnosticsSession } from "../services/diagnostics";
import type { RecoveryCandidate } from "../services/recovery";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`button ${text} not found`);
  return found as HTMLButtonElement;
}

function item(): RecoveryCandidate {
  return {
    record_id: crypto.randomUUID(),
    name: "notes.txt",
    source_path: "C:\\Work\\notes.txt",
    captured_unix: 1_700_000_000,
    revision: 2,
    byte_len: 20,
    status: "available",
    error_code: null,
  };
}

function session(): DiagnosticsSession {
  return {
    id: crypto.randomUUID(),
    expires_unix: 1_700_000_300,
    include_paths: false,
    include_dumps: true,
    files: [
      {
        id: "file-text",
        relative_name: "app-info.txt",
        kind: "text",
        bytes: 10,
        included: true,
        redacted: true,
        preview: "app_version=0.1.8\n",
      },
      {
        id: "file-dump",
        relative_name: "crash.dmp",
        kind: "dump",
        bytes: 128,
        included: true,
        redacted: false,
        preview: null,
      },
    ],
  };
}

describe("tab failure and review dialogs", () => {
  it("keeps the Explorer usable when one view throws", async () => {
    function Boom(): never {
      throw new Error("private file text that must not be shown");
    }
    await render(
      <div>
        <TabErrorBoundary onReload={() => undefined} onClose={() => undefined}>
          <Boom />
        </TabErrorBoundary>
        <button type="button">Explorer still here</button>
      </div>,
    );
    expect(container!.querySelector("[role='alert']")).not.toBeNull();
    expect(container!.textContent).toContain("Explorer still here");
    expect(container!.textContent).not.toContain("private file text");
  });

  it("Escape keeps recovery records instead of discarding them", async () => {
    const onDiscard = vi.fn(async () => undefined);
    const onLater = vi.fn();
    await render(
      <RecoveryDialog
        items={[item()]}
        loading={false}
        onOpen={async () => undefined}
        onDiscard={onDiscard}
        onLater={onLater}
        onOpenHelp={() => undefined}
      />,
    );
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onLater).toHaveBeenCalled();
  });

  it("sends edited text and an excluded file before Save", async () => {
    const onEdit = vi.fn(async (_edits: readonly DiagnosticEdit[]) => undefined);
    const onSave = vi.fn(async () => undefined);
    await render(
      <DiagnosticsDialog
        session={session()}
        onEdit={onEdit}
        onSave={onSave}
        onOpenIssue={async () => undefined}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const textarea = container!.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "edited report\n");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const dumpCheckbox = container!.querySelector<HTMLInputElement>(
      "input[aria-label='crash.dmp']",
    )!;
    await act(async () => {
      dumpCheckbox.click();
    });
    await act(async () => {
      button("Save diagnostics ZIP").click();
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
    const edits = onEdit.mock.calls[0][0] as { file_id: string; included: boolean; text?: string }[];
    expect(edits).toContainEqual({ file_id: "file-text", included: true, text: "edited report\n" });
    expect(edits).toContainEqual({ file_id: "file-dump", included: false, text: undefined });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("opens the issue page only from the explicit button", async () => {
    const onOpenIssue = vi.fn(async () => undefined);
    await render(
      <DiagnosticsDialog
        session={session()}
        onEdit={async () => undefined}
        onSave={async () => undefined}
        onOpenIssue={onOpenIssue}
        onClose={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    expect(onOpenIssue).not.toHaveBeenCalled();
    await act(async () => {
      button("Open issue page").click();
    });
    expect(onOpenIssue).toHaveBeenCalledTimes(1);
  });

  it("renders long Spanish text without hard-coded English", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    await render(
      <RecoveryDialog
        items={[item()]}
        loading={false}
        onOpen={async () => undefined}
        onDiscard={async () => undefined}
        onLater={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    expect(container!.textContent).toContain("Recuperar trabajo sin guardar");
    expect(container!.querySelector(".adp-recovery-dialog")).not.toBeNull();
  });
});
