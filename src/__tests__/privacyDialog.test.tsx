import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import i18n from "../i18n";
import PrivacyDialog from "../privacy/PrivacyDialog";
import type { PrivacyClosure, PrivacyInspection, PrivacyResult } from "../services/privacy";
import type { ConversionInput } from "../convert/types";

vi.mock("../services/archive", () => ({
  archivePickFolder: vi.fn().mockResolvedValue("C:\\Pictures"),
}));

vi.mock("../services/privacy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/privacy")>();
  return {
    ...actual,
    inspectPrivacy: vi.fn(),
    privacyInspectionPage: vi.fn(),
    effectivePrivacyCategories: vi.fn(),
    cleanPrivacy: vi.fn(),
    releasePrivacy: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  cleanPrivacy,
  effectivePrivacyCategories,
  inspectPrivacy,
  releasePrivacy,
} from "../services/privacy";

const inspection: PrivacyInspection = {
  inspection_id: "11111111-1111-4111-8111-111111111111",
  input: { kind: "file", path: "C:\\Pictures\\photo.jpg" },
  fields: [
    {
      category: "gps",
      containers: ["exif"],
      related_categories: [],
      field_id: "exif.0002",
      label_key: "privacy.gps",
      preview: "51.5, -0.1",
      count: 1,
      content_affecting: false,
      coverage: "complete",
    },
  ],
  complete: true,
  signatures_present: false,
  effective_categories: ["gps"],
  expires_unix: 300,
};

const cleanClosure: PrivacyClosure = {
  requested_categories: ["gps"],
  effective_categories: ["gps"],
  content_affecting: false,
  appearance_affecting: false,
  signatures_present: false,
};

const result: PrivacyResult = {
  report: {
    report_id: "22222222-2222-4222-8222-222222222222",
    items: [
      {
        input_index: 0,
        source_path: "C:\\Pictures\\photo.jpg",
        output_count: 1,
        status: "done",
        metadata_lost: [],
        bytes_written: 10,
      },
    ],
    outputs: [
      {
        output_id: "33333333-3333-4333-8333-333333333333",
        input_indices: [0],
        output_index: 0,
        path: "C:\\Pictures\\photo - Cleaned.jpg",
        byte_len: 10,
      },
    ],
    created_paths: ["C:\\Pictures\\photo - Cleaned.jpg"],
    input_total: 1,
    done_count: 1,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 1,
    cancelled: false,
    job_finished: true,
    complete: true,
  },
  inspections_before: [{ category: "gps", count: 1, coverage: "complete" }],
  inspections_after: [{ category: "gps", count: 0, coverage: "complete" }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const inputs: ConversionInput[] = [{ kind: "file", path: "C:\\Pictures\\photo.jpg" }];

function job<T>(value: T) {
  return {
    id: "privacy-test",
    cancel: vi.fn().mockResolvedValue(undefined),
    completion: Promise.resolve(value),
  };
}

beforeEach(() => {
  vi.mocked(inspectPrivacy).mockReturnValue(
    job({ items: [inspection], complete: true }) as never,
  );
  vi.mocked(effectivePrivacyCategories).mockResolvedValue(cleanClosure);
  vi.mocked(cleanPrivacy).mockReturnValue(job(result) as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});

async function renderDialog(onCompleted = vi.fn()) {
  await act(async () => {
    root?.render(
      <PrivacyDialog
        inputs={inputs}
        onClose={() => undefined}
        onCompleted={onCompleted}
        onOpenHelp={() => undefined}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return onCompleted;
}

function cleanButton(): HTMLButtonElement {
  const button = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (element) => element.textContent?.includes("Clean copy"),
  );
  return button!;
}

describe("PrivacyDialog", () => {
  it("keeps Clean disabled when no category is selected", async () => {
    await renderDialog();
    expect(cleanButton().disabled).toBe(true);
  });

  it("requires the exact closure and explicit acknowledgements", async () => {
    await renderDialog();
    const gps = container!.querySelector<HTMLInputElement>("input[aria-label='Location']")!;
    await act(async () => gps.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(cleanButton().disabled).toBe(false);
    await act(async () => cleanButton().click());
    expect(vi.mocked(cleanPrivacy)).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted_effective_categories: ["gps"],
        accepted_content_changes: false,
        accepted_signature_change: false,
        accepted_appearance_changes: false,
      }),
    );
  });

  it("requires content, appearance and signature acknowledgements", async () => {
    vi.mocked(effectivePrivacyCategories).mockResolvedValue({
      ...cleanClosure,
      content_affecting: true,
      appearance_affecting: true,
      signatures_present: true,
    });
    await renderDialog();
    await act(async () => {
      container!.querySelector<HTMLInputElement>("input[aria-label='Location']")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(cleanButton().disabled).toBe(true);
    const boxes = [...container!.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];
    for (const box of boxes.slice(-3)) {
      expect(box.checked).toBe(false);
      await act(async () => box.click());
    }
    expect(cleanButton().disabled).toBe(false);
  });

  it("never shows a green clean claim after a failed result", async () => {
    vi.mocked(cleanPrivacy).mockReturnValue(
      job({
        ...result,
        report: {
          ...result.report,
          items: [{ ...result.report.items[0], status: "failed", output_count: 0 }],
          outputs: [],
          created_paths: [],
          outputs_created: 0,
          failed_count: 1,
          done_count: 0,
        },
        inspections_after: [{ category: "gps", count: 1, coverage: "complete" }],
      }) as never,
    );
    const onCompleted = await renderDialog();
    await act(async () => {
      container!.querySelector<HTMLInputElement>("input[aria-label='Location']")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => cleanButton().click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain(
      "Removal could not be verified. No cleaned file was published.",
    );
    expect(onCompleted).not.toHaveBeenCalled();
    expect(releasePrivacy).not.toHaveBeenCalled();
  });

  it("uses the Spanish strings and releases its inspection", async () => {
    await i18n.changeLanguage("es");
    await renderDialog();
    expect(container!.textContent).toContain("Quitar información oculta");
    await act(async () => root?.unmount());
    root = null;
    expect(releasePrivacy).toHaveBeenCalledWith(inspection.inspection_id);
  });
});
