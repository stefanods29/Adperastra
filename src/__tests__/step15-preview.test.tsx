import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { MediaRecipe, MediaSource } from "../media-edit/types";
import { mediaProxyKey } from "../services/mediaEdit";
import { MediaPreviewGate, PreviewCache } from "../media-edit/useMediaPreview";
import { mediaRecipeDurationUs, outputToSource, removeRange, withSegments } from "../media-edit/timing";
import Waveform from "../media-edit/Waveform";

vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function source(stamp = "100"): MediaSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    path: "C:\\media\\sample.mp4",
    stamp: {
      path_key: "C:\\media\\sample.mp4",
      volume_id: "00000000",
      file_id: "0000000000000001",
      modified_ticks: stamp,
      size_bytes: 4096,
    },
    duration_us: 10_000_000,
    video_rate: { num: 30, den: 1 },
    audio_rate: 48_000,
    sensitive: false,
  };
}

function recipe(): MediaRecipe {
  return {
    schema_version: 1,
    project_id: "22222222-2222-4222-8222-222222222222",
    content_id: "33333333-3333-4333-8333-333333333333",
    sources: [source()],
    segments: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        source_id: "11111111-1111-4111-8111-111111111111",
        start_us: 0,
        end_us: 10_000_000,
        speed: 1,
      },
    ],
    crop: null,
    rotation: 0,
    volume: 1,
    mute: false,
    keep_pitch: true,
    subtitles: [],
    subtitle_mode: "off",
    metadata_keep: true,
  };
}

describe("media preview", () => {
  it("inactive pauses and refuses new preview work", () => {
    const gate = new MediaPreviewGate();
    expect(gate.begin()).toBe(1);
    gate.setActive(false);
    expect(gate.isPaused).toBe(true);
    expect(gate.begin()).toBeNull();
    gate.setActive(true);
    expect(gate.isPaused).toBe(false);
    expect(gate.begin()).not.toBeNull();
  });

  it("stale generations cannot replace a newer preview", () => {
    const gate = new MediaPreviewGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.accept(first)).toBe(false);
    expect(gate.accept(second)).toBe(true);
    gate.setActive(false);
    expect(gate.accept(second)).toBe(false);
  });

  it("a changed source stamp is a different preview identity", () => {
    const cache = new PreviewCache<string>(2);
    const first = mediaProxyKey(source("100"), "512");
    const second = mediaProxyKey(source("101"), "512");
    expect(first).not.toBe(second);
    cache.put(first, "old");
    expect(cache.get(second)).toBeNull();
    cache.put(second, "new");
    expect(cache.get(second)).toBe("new");
  });

  it("output 6s after cutting 2..4s maps to source 8s", () => {
    const cut = withSegments(recipe(), removeRange(recipe(), 2_000_000, 4_000_000));
    expect(mediaRecipeDurationUs(cut)).toBe(8_000_000);
    expect(outputToSource(cut, 6_000_000).source_us).toBe(8_000_000);
  });

  it("an inactive waveform requests no page", async () => {
    const loadPage = vi.fn(async (value: MediaSource) => ({
      source_id: value.id,
      channel: 0,
      first_bucket: 0,
      buckets: [{ min: -0.5, max: 0.5 }],
      total_buckets: 1,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Waveform
          source={source()}
          durationUs={10_000_000}
          positionUs={0}
          active={false}
          onSeek={() => undefined}
          loadPage={loadPage}
        />,
      );
    });
    await act(async () => undefined);
    expect(loadPage).not.toHaveBeenCalled();
  });
});
