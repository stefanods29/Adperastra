import { describe, expect, it, vi } from "vitest";

import type { DocumentRef } from "../documents/types";
import type { TransferEnvelope } from "../transfer/types";
import {
  clipsInWindow,
  playheadAfterArrow,
  visibleTrackRange,
} from "../timeline/timelineViewTypes";
import {
  clipsFromTransfer,
  finishGesture,
  TimelineGesture,
} from "../timeline/timelineTransfer";
import type { TimelineOperation } from "../timeline/types";
import { clip, project, source, track, uuid } from "./timelineFixtures";

function envelope(refs: DocumentRef[], sensitive = false): TransferEnvelope {
  return {
    transfer_id: uuid(900),
    source_document_id: undefined,
    source_revision: undefined,
    sensitive,
    payload: { kind: "files", sources: refs },
    expires_unix: 0,
  };
}

const DISK: DocumentRef = { kind: "disk", path: "C:\\media\\clip.mp4" };
const VIRTUAL: DocumentRef = {
  kind: "virtual",
  provider: "locked",
  container_path: "C:\\media\\secret.adp",
  entry_id: uuid(901),
};

describe("step 19a editor behaviour", () => {
  it("10000clips_boundedDOM", () => {
    const tracks = [];
    let id = 200;
    for (let index = 0; index < 10; index += 1) {
      const clips = [];
      for (let item = 0; item < 1_000; item += 1) {
        clips.push(
          clip({
            id: id++,
            start_us: item * 10_000_000,
            source_in_us: 0,
            source_out_us: 1_000_000,
          }),
        );
      }
      tracks.push(track(10 + index, "video", index, clips));
    }
    const big = project({ tracks });
    const visible = clipsInWindow(big, 0, 12_000_000);
    // A 12 s window with the 2 s overscan never builds 10,000 DOM clips.
    expect(visible.length).toBeLessThan(200);
    const range = visibleTrackRange(
      Array.from({ length: 128 }, () => ({ kind: "video" as const })),
      0,
      280,
    );
    expect(range.last - range.first + 1).toBeLessThanOrEqual(7);
  });

  it("drop_authorizedsourceonly", async () => {
    const target = project({ tracks: [track(10, "video", 0, [])] });
    const host = {
      resolveSource: (ref: DocumentRef) =>
        ref.kind === "disk" && ref.path === source().path ? source() : null,
      currentStamp: async () => source().stamp,
    };
    const accepted = await clipsFromTransfer(envelope([DISK]), "add_clips", {
      project: target,
      track_id: uuid(10),
      start_us: 2_000_000,
      host,
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].start_us).toBe(2_000_000);
    expect(accepted[0].source_id).toBe(uuid(1));

    await expect(
      clipsFromTransfer(envelope([VIRTUAL]), "add_clips", {
        project: target,
        track_id: uuid(10),
        start_us: 0,
        host,
      }),
    ).rejects.toMatchObject({ code: "timeline.unsupported" });

    await expect(
      clipsFromTransfer(envelope([DISK], true), "add_clips", {
        project: target,
        track_id: uuid(10),
        start_us: 0,
        host,
      }),
    ).rejects.toMatchObject({ code: "timeline.unsupported" });

    const changed = {
      ...host,
      currentStamp: async () => ({ ...source().stamp, modified_ticks: "133000000000000999" }),
    };
    await expect(
      clipsFromTransfer(envelope([DISK]), "add_clips", {
        project: target,
        track_id: uuid(10),
        start_us: 0,
        host: changed,
      }),
    ).rejects.toMatchObject({ code: "timeline.changed" });

    const unauthorized: DocumentRef = { kind: "disk", path: "C:\\media\\other.mp4" };
    await expect(
      clipsFromTransfer(envelope([unauthorized]), "add_clips", {
        project: target,
        track_id: uuid(10),
        start_us: 0,
        host,
      }),
    ).rejects.toMatchObject({ code: "timeline.missing_source" });
  });

  it("onegesture_oneUndo", async () => {
    const apply = vi.fn(async (_operation: TimelineOperation) => undefined);
    const gesture = new TimelineGesture();
    gesture.begin(uuid(1), uuid(10), 0);
    gesture.preview(1_000_000);
    gesture.preview(2_000_000);
    expect(apply).not.toHaveBeenCalled();
    const applied = await finishGesture(gesture, apply);
    expect(applied).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual({
      kind: "move_clip",
      id: uuid(1),
      track_id: uuid(10),
      start_us: 2_000_000,
    });
    // A second finish after completion cannot record another Undo entry.
    expect(await finishGesture(gesture, apply)).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
    // Escape cancels the gesture without applying anything.
    gesture.begin(uuid(1), uuid(10), 0);
    gesture.preview(5_000_000);
    gesture.cancel();
    expect(await finishGesture(gesture, apply)).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("keyboard_exactframe", () => {
    const rate = { num: 30_000, den: 1_001 };
    expect(playheadAfterArrow(0, "right", false, rate)).toBe(33_366);
    expect(playheadAfterArrow(0, "right", true, rate)).toBe(333_666);
    expect(playheadAfterArrow(1_001_000, "left", false, rate)).toBe(967_633);
    // From a non-boundary, Left goes to the start of the frame containing it.
    expect(playheadAfterArrow(1_000_000, "left", false, rate)).toBe(967_633);
    expect(playheadAfterArrow(0, "left", false, rate)).toBe(0);
  });
});
