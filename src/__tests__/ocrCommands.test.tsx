import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/ocr", () => ({
  recognizeText: vi.fn(),
  ocrPage: vi.fn(),
  releaseOcr: vi.fn(async () => undefined),
}));

import { ocrPage, recognizeText, releaseOcr, type OcrInput, type OcrPage, type OcrWord } from "../services/ocr";
import { createOcrCommands, useOcrCommands } from "../ocr/useOcrCommands";
import { useOcr, type OcrController } from "../ocr/useOcr";

const recognizeMock = vi.mocked(recognizeText);
const pageMock = vi.mocked(ocrPage);
const releaseMock = vi.mocked(releaseOcr);

function word(text: string, x: number, order: number): OcrWord {
  return { text, x, y: 0, width: 10, height: 10, line: 0, order };
}

function makePage(words: OcrWord[], text: string, next: number | null = null): OcrPage {
  return {
    source: {
      kind: "disk",
      stamp: {
        path_key: "c:\\pictures\\a.png",
        volume_id: "0011aabb",
        file_id: "00112233445566aa",
        modified_ticks: "133000000000000000",
        size_bytes: 1,
      },
    },
    page: 1,
    language: "en-US",
    original_width: 100,
    original_height: 100,
    recognized_width: 100,
    recognized_height: 100,
    words,
    text,
    partial: false,
    next_word: next,
    rotation: 0,
    text_angle: null,
  };
}

function handle<T>(result: T, cancel = vi.fn(async () => undefined)) {
  return { id: "job", cancel, completion: Promise.resolve(result) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: OcrController | null = null;
let commands: ReturnType<typeof useOcrCommands> = [];
const writeText = vi.fn(async () => undefined);

interface ProbeProps {
  input: OcrInput | null;
  clipboardAllowed?: boolean;
}

function Probe({ input, clipboardAllowed = true }: ProbeProps) {
  const controller = useOcr({
    input,
    language: "auto",
    rotation: 0,
    active: true,
    clipboardAllowed,
  });
  const actions = useMemo(
    () => ({
      copyAll: async () => {
        await controller.copyAll();
      },
      search: () => {
        controller.find("Hello");
      },
    }),
    [controller],
  );
  const list = useOcrCommands("image", actions);
  latest = controller;
  commands = list;
  return (
    <div>
      <img data-testid="image" alt="scan" />
      <span data-testid="status">{controller.status}</span>
      <span data-testid="error">{controller.error}</span>
      <pre data-testid="text">{controller.page?.text ?? ""}</pre>
    </div>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 24; index += 1) await Promise.resolve();
  });
}

async function render(props: ProbeProps): Promise<void> {
  await act(async () => {
    root?.render(<Probe {...props} />);
  });
  await flush();
}

async function runCommand(id: string): Promise<void> {
  const command = commands.find((entry) => entry.id === id);
  expect(command).toBeDefined();
  await act(async () => {
    command!.run({ canCopy: true, canSearch: true });
  });
  await flush();
}

const firstInput: OcrInput = { kind: "image", path: "C:\\Pictures\\a.png" };
const secondInput: OcrInput = { kind: "image", path: "C:\\Pictures\\b.png" };

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  recognizeMock.mockResolvedValue(
    handle(makePage([word("Hello", 0, 0)], "Hello ", 1)),
  );
  pageMock.mockResolvedValue(makePage([word("123", 20, 1)], "123", null));
  releaseMock.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  commands = [];
  vi.clearAllMocks();
});

describe("OCR commands and feedback", () => {
  it("recognition completion does not write the clipboard", async () => {
    await render({ input: firstInput });
    await act(async () => {
      await latest!.recognize();
    });
    await flush();
    expect(latest!.page?.text).toBe("Hello 123");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Copy all writes the exact recognised text once", async () => {
    await render({ input: firstInput });
    await act(async () => {
      await latest!.recognize();
    });
    await flush();
    recognizeMock.mockClear();
    await runCommand("image.copyAllText");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Hello 123");
    expect(recognizeMock).not.toHaveBeenCalled();
  });

  it("selecting a new file cancels the old recognition and ignores its result", async () => {
    const pending = deferred<OcrPage>();
    const cancel = vi.fn(async () => undefined);
    recognizeMock.mockResolvedValueOnce({ id: "job", cancel, completion: pending.promise });
    await render({ input: firstInput });
    let running: Promise<OcrPage | null> = Promise.resolve(null);
    await act(async () => {
      running = latest!.recognize();
      await Promise.resolve();
    });
    await render({ input: secondInput });
    expect(cancel).toHaveBeenCalled();
    await act(async () => {
      pending.resolve(makePage([word("Old", 0, 0)], "Old", null));
    });
    await flush();
    await running;
    expect(latest!.page).toBeNull();
    expect(releaseMock).toHaveBeenCalled();
  });

  it("a missing language keeps the image view and asks for help", async () => {
    recognizeMock.mockRejectedValueOnce(new Error("ocr.language_missing"));
    await render({ input: firstInput });
    await act(async () => {
      await latest!.recognize();
    });
    await flush();
    expect(latest!.status).toBe("error");
    expect(latest!.showLanguageHelp).toBe(true);
    expect(container!.querySelector('[data-testid="image"]')).not.toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("sensitive permissions disable the copy command", async () => {
    await render({ input: firstInput, clipboardAllowed: false });
    await act(async () => {
      await latest!.recognize();
    });
    await flush();
    const copy = commands.find((entry) => entry.id === "image.copyAllText")!;
    expect(copy.enabledWhen!({ canCopy: false, canSearch: true })).toBe(false);
    await act(async () => {
      expect(await latest!.copyAll()).toBe(false);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the exact command ids and labels for both viewers", () => {
    const actions = { copyAll: async () => undefined, search: () => undefined };
    const image = createOcrCommands("image", actions);
    const pdf = createOcrCommands("pdf", actions);
    expect(image.map((entry) => entry.id)).toEqual(["image.copyAllText", "image.searchText"]);
    expect(pdf.map((entry) => entry.id)).toEqual(["pdf.copyAllText", "pdf.searchImageText"]);
    expect(image[0].labelKey).toBe("ocr.copyAll");
    expect(image[1].labelKey).toBe("ocr.search");
    expect(image.every((entry) => entry.helpSlug === "copying-text-from-images")).toBe(true);
    expect(image.every((entry) => entry.risk === "read-only")).toBe(true);
  });
});
