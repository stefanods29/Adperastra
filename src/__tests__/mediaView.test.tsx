import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import MediaView from "../handlers/media/MediaView";
import type { FileTypeInfo } from "../services/files";

const info = (name: string, mime: string): FileTypeInfo => ({
  path: `C:\\media\\${name}`,
  name,
  ext: name.split(".").pop() ?? "",
  mime,
  size: 1000,
  modified_unix: 0,
  online_only: false,
  read_only: false,
  from_internet: false,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function render(file: FileTypeInfo) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onStatus = vi.fn();
  await act(async () =>
    root?.render(
      <MediaView
        info={file}
        url="http://adpfile.localhost/0123456789abcdef0123456789abcdef/x"
        active={true}
        savedState={{ speed: 1.5, loop: true }}
        onStateChange={() => undefined}
        onStatus={onStatus}
        onOpenInWindowsApp={() => undefined}
        find={{ text: "", request: 0, backwards: false }}
        protectedView={false}
      />,
    ),
  );
  return onStatus;
}

describe("media player", () => {
  it("shows a video with the ribbon, the saved speed and an empty subtitles list", async () => {
    await render(info("clip.mp4", "video/mp4"));
    expect(container?.querySelector("video")).not.toBeNull();
    const selects = container?.querySelectorAll("select") ?? [];
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("1.5");
    expect((selects[1] as HTMLSelectElement).disabled).toBe(true);
    // Loop is on (saved state); Play is shown, Pause is hidden.
    expect(container?.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(container?.querySelectorAll(".adp-ribbon-btn")).toHaveLength(2);
  });

  it("shows audio with its name and no subtitles list", async () => {
    const onStatus = await render(info("song.mp3", "audio/mpeg"));
    expect(container?.querySelector("audio")).not.toBeNull();
    expect(container?.textContent).toContain("song.mp3");
    expect(container?.querySelectorAll("select")).toHaveLength(1);
    expect(onStatus).toHaveBeenCalled();
  });

  it("offers the Windows app when the format can't be played", async () => {
    await render(info("clip.webm", "video/webm"));
    await act(async () => {
      container?.querySelector("video")?.dispatchEvent(new Event("error"));
    });
    expect(container?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container?.querySelector("video")).toBeNull();
  });
});
