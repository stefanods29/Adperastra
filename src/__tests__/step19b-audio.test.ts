import { describe, expect, it } from "vitest";
import { clip, project, track, uuid } from "./timelineFixtures";
import { normalizeTimeline } from "../timeline/renderPlan";
import { resolveAudioMix, audioClippingRequired } from "../timeline/audioMix";
import { mixAudioBlock, requireAudioClippingAcknowledgement } from "../timeline/audioRender";

function plan() {
  const first = clip({ id: 20, start_us: 0, source_out_us: 2_000_000 });
  const second = clip({ id: 21, start_us: 0, source_out_us: 2_000_000 });
  return normalizeTimeline(project({ tracks: [track(10, "audio", 0, [first]), track(11, "audio", 1, [second])] }));
}
describe("19b exact audio", () => {
  it("mute_overrides_solo", () => {
    const p = structuredClone(plan());
    p.tracks[0].solo = true;
    p.tracks[0].mute = true;
    const mix = resolveAudioMix(p, 1_000_000);
    expect(mix[0].gain).toBe(0);
    expect(mix[0].enabled).toBe(false);
    expect(mix[1].enabled).toBe(true);
  });
  it("solo_track_gatesothers", () => {
    const p = structuredClone(plan());
    p.tracks[0].solo = true;
    expect(resolveAudioMix(p, 1_000_000).map((c) => c.enabled)).toEqual([true, false]);
  });
  it("gain0.5xtrack0.5=>0.25", () => {
    const p = structuredClone(plan());
    p.tracks[0].gain = 0.5;
    p.tracks[0].clips[0].gain = 0.5;
    expect(resolveAudioMix(p, 1_000_000)[0].gain).toBe(0.25);
  });
  it("fade_midpoint0.5", () => {
    const p = structuredClone(plan());
    p.tracks[0].clips[0].fade_in_us = 1_000_000;
    expect(resolveAudioMix(p, 500_000)[0].gain).toBe(0.5);
    expect(resolveAudioMix(p, 2_000_000)).toEqual([]);
    expect(resolveAudioMix(p, 1)[0].source_sample).toBe(1);
  });
  it("mix2signals0.75=>clippingwarning", () => {
    const rendered = mixAudioBlock([new Float32Array([0.75, -0.75]), new Float32Array([0.75, -0.75])], [1, 1]);
    expect([...rendered.samples]).toEqual([1, -1]);
    expect(rendered.peak).toBe(1.5);
    expect(rendered.warnings).toEqual(["audio_clipping"]);
  });
  it("conservative bound includes fades with upper bound one", () => {
    const p = structuredClone(plan());
    p.tracks[0].gain = 0.75;
    p.tracks[1].gain = 0.75;
    p.tracks[0].clips[0].fade_in_us = 2_000_000;
    p.tracks[1].clips[0].fade_out_us = 2_000_000;
    expect(audioClippingRequired(p)).toBe(true);
    p.tracks[1].clips[0].start_us = 2_000_000;
    expect(audioClippingRequired(p)).toBe(false);
  });
  it("muted solo clip does not gate eligible clips", () => {
    const p = structuredClone(plan());
    Object.assign(p.tracks[0].clips[0], { solo: true, mute: true });
    expect(resolveAudioMix(p, 500_000).find((c) => c.clip_id === uuid(21))?.enabled).toBe(true);
  });
  it("unaccepted clipping is refused", () => {
    expect(() => requireAudioClippingAcknowledgement(true, [])).toThrow("convert.warning_required");
    expect(() => requireAudioClippingAcknowledgement(true, ["audio_clipping"])).not.toThrow();
  });
});
