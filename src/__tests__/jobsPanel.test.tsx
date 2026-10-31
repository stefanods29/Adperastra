import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import JobsPanel, { type JobView } from "../views/explorer/JobsPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const job = (overrides: Partial<JobView> = {}): JobView => ({
  id: "j1",
  verbKey: "extracting",
  count: 1,
  progress: null,
  status: "done",
  skipped: [],
  onCancel: () => undefined,
  ...overrides,
});

async function render(jobs: JobView[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<JobsPanel jobs={jobs} onDismiss={() => undefined} onClose={() => undefined} />);
  });
}

/** Open the skipped items of the first job. */
async function expandSkipped() {
  const button = container!.querySelector<HTMLButtonElement>(".adp-job-meta button")!;
  await act(async () => {
    button.click();
  });
}

describe("the jobs panel", () => {
  it("explains skipped items in the area that ran the job", async () => {
    await render([
      job({
        reasonArea: "archive",
        skipped: [{ path: "C:\\D\\docs\\evil.txt", reason: "unsafe_path" }],
      }),
    ]);
    await expandSkipped();
    const skipped = container!.querySelector(".adp-job-skipped")!;
    expect(skipped.textContent).toContain("evil.txt");
    expect(skipped.textContent).toContain(i18n.t("errors.archive.unsafe_path"));
  });

  it("uses the file-operation reasons when no area is given", async () => {
    await render([job({ skipped: [{ path: "C:\\D\\notes.txt", reason: "in_use" }] })]);
    await expandSkipped();
    const skipped = container!.querySelector(".adp-job-skipped")!;
    expect(skipped.textContent).toContain(i18n.t("errors.ops.in_use"));
  });
});
