import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import EmailView, { emailAttachmentsAreMetadata } from "../handlers/email/EmailView";
import { sanitizeMarkup } from "../components/SafeMarkupFrame";
import type { ExtraViewPage } from "../services/extraViews";

const mocks = vi.hoisted(() => {
  const page = {
    session_id: "6f2e6a8e-4a4e-4f56-8f0b-2f3f6f4f7a10",
    kind: "email",
    payload: {
      kind: "email",
      message: {
        subject: "Hello",
        from: [{ name: "Ana", address: "ana@example.com" }],
        to: [{ name: "Bob", address: "bob@example.com" }],
        cc: [],
        date: null,
        plain_text: "Body",
        html: null,
        attachment_count: 1,
      },
      attachments: [
        {
          id: "c7f2f0a2-4f08-4f4e-a4f8-2f0f3f4f5a11",
          name: "report.pdf",
          mime: "application/pdf",
          byte_len: 10,
        },
      ],
    },
    next_cursor: null,
    complete: true,
    partial: false,
  };
  return {
    page,
    openEmailAttachment: vi.fn(async () => ({
      id: "job",
      cancel: async () => undefined,
      completion: Promise.resolve("C:\\opened\\report.pdf"),
    })),
  };
});

vi.mock("../services/extraViews", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/extraViews")>();
  return { ...original, openEmailAttachment: mocks.openEmailAttachment };
});

vi.mock("../handlers/extraView/useExtraView", () => ({
  useExtraView: () => ({
    phase: "ready",
    session: {
      session_id: "6f2e6a8e-4a4e-4f56-8f0b-2f3f6f4f7a10",
      source: {
        path_key: "C:\\mail.eml",
        volume_id: "00000000",
        file_id: "0000000000000000",
        modified_ticks: "1",
        size_bytes: 10,
      },
      kind: "email",
      title: "Hello",
      item_count: 1,
      partial: false,
    },
    page: mocks.page,
    error: null,
    loadingPage: false,
    reload: vi.fn(),
    cancelOpen: vi.fn(),
    request: vi.fn(),
    setPage: vi.fn(),
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.openEmailAttachment.mockClear();
});

async function renderEmail() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <EmailView
        info={{
          path: "C:\\mail.eml",
          name: "mail.eml",
          ext: "eml",
          mime: "message/rfc822",
          size: 10,
          modified_unix: 1,
          online_only: false,
          read_only: false,
          from_internet: false,
        }}
        url="http://adpfile.localhost/token/mail.eml"
        active
        savedState={null}
        onStateChange={() => undefined}
        onStatus={() => undefined}
        onOpenInWindowsApp={() => undefined}
        find={{ text: "", request: 0, backwards: false }}
        protectedView={false}
        onOpenFile={async () => undefined}
      />,
    );
  });
}

describe("email viewer", () => {
  it("email_remote_image_makes_zero_requests", () => {
    const clean = sanitizeMarkup(
      '<img src="https://tracker.example/x.png" alt="x">',
      [],
    );
    expect(clean).not.toContain("https://");
    expect(clean).not.toContain("http://");
  });

  it("malformedCIDcannotescape message", () => {
    const clean = sanitizeMarkup(
      '<img src="cid:../../secret"><img src="cid:ok">',
      [],
    );
    expect(clean).not.toContain("cid:");
    expect(clean).not.toContain("../");
  });

  it("attachment_open_needs_explicit_action", async () => {
    await renderEmail();
    expect(mocks.openEmailAttachment).not.toHaveBeenCalled();
    const button = [...container!.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Open"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.openEmailAttachment).toHaveBeenCalledTimes(1);
  });

  it("rendered attachments are metadata only", () => {
    const page = mocks.page as unknown as ExtraViewPage;
    expect(
      emailAttachmentsAreMetadata(
        page.payload.kind === "email" ? page.payload.attachments : [],
      ),
    ).toBe(true);
  });
});
