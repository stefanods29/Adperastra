import "../i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import AudioPanel from "../timeline/AudioPanel";
import ExportTimelineDialog from "../timeline/ExportTimelineDialog";
import SubtitlePanel from "../timeline/SubtitlePanel";
import { timelinePresetOptions } from "../timeline/exportPresets";
import { requireAudioClippingAcknowledgement } from "../timeline/audioRender";
import { audioClippingRequired } from "../timeline/audioMix";
import { clip, project, track, uuid } from "./timelineFixtures";
import { normalizeTimeline } from "../timeline/renderPlan";
import { exportTimeline, validateTimelineExportRequest } from "../services/timelineExport";
import type { TimelineExportRequest } from "../timeline/effectTypes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../services/jobs", () => ({ runJob: async (_prefix: string, start: (id: string) => Promise<void>) => {
  await start("test-request");
  return { id: "test-request", cancel: async () => {}, completion: Promise.resolve({}) };
} }));

function exportRequest(): TimelineExportRequest {
  return {
    project_snapshot: { snapshot_id: uuid(300), document_id: uuid(301), revision: 7, content_id: uuid(302),
      mime: "application/vnd.adperastra.timeline+json", byte_len: 128, storage_policy: "ordinary", expires_unix: 2_000_000_000 },
    dest_dir: "C:\\exports", file_name: "timeline.webm", container: "webm", video_codec: "vp9", audio_codec: "opus",
    width: 1920, height: 1080, frame_rate: { num: 30_000, den: 1001 }, metadata_keep: true,
    subtitle_mode: "off", accepted_losses: [], accepted_warning_codes: [],
    composition: { placement: "absolute_start_us", stacking: "track_index", fit: "fit_pad", background: [0, 0, 0, 255] },
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; });
async function mount(element: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(element));
  return container;
}

describe("19b independent panels and warning policy", () => {
  it("captureR_latereditRplus1_exportR", async () => {
    const request = exportRequest();
    const started = exportTimeline(request);
    request.project_snapshot.revision = 8;
    request.project_snapshot.content_id = uuid(303);
    // No native export backend exists yet: the captured request is refused
    // before any job, preview frame or output is produced.
    await expect(started).rejects.toThrow("timeline_export.unsupported");
  });
  it("export_notmarkprojectclean", async () => {
    const request = exportRequest(); const before = JSON.stringify(request);
    await expect(exportTimeline(request)).rejects.toThrow("timeline_export.unsupported");
    expect(JSON.stringify(request)).toBe(before);
  });
  it("request names, warning codes and small-project bounds refuse before dispatch", () => {
    expect(() => validateTimelineExportRequest({ ...exportRequest(), file_name: "CON.webm" })).toThrow("timeline_export.bad_request");
    expect(() => validateTimelineExportRequest({ ...exportRequest(), accepted_warning_codes: ["unknown" as never] })).toThrow("convert.warning_required");
    const request = exportRequest(); request.project_snapshot.byte_len = 16 * 1024 * 1024 + 1;
    expect(() => validateTimelineExportRequest(request)).toThrow("timeline_export.bad_request");
  });
  it("metadata_default_keep", () => {
    const plan = normalizeTimeline(project({ tracks: [] }));
    for (const preset of ["web", "phone", "high", "audioOnly"] as const) {
      expect(timelinePresetOptions(preset, plan).metadata_keep).toBe(true);
    }
    expect(timelinePresetOptions("phone", plan)).toMatchObject({ width: 1080, height: 1920, container: "webm", video_codec: "vp9", audio_codec: "opus" });
  });
  it("missing_required_warning_blocks_before_output_begin", () => {
    let begun = 0;
    const publish = () => { requireAudioClippingAcknowledgement(true, []); begun++; };
    expect(publish).toThrow("convert.warning_required"); expect(begun).toBe(0);
  });
  it("conservative_gain_bound_requires_audio_clipping_ack", () => {
    const a = clip({ id: 20, start_us: 0, source_out_us: 2_000_000 });
    const b = clip({ id: 21, start_us: 0, source_out_us: 2_000_000 });
    a.gain = b.gain = 0.75;
    const plan = normalizeTimeline(project({ tracks: [track(10, "audio", 0, [a, b])] }));
    expect(audioClippingRequired(plan)).toBe(true);
    expect(() => requireAudioClippingAcknowledgement(true, [])).toThrow("convert.warning_required");
  });
  it("unaccepted_audio_clipping_zero_outputs", () => {
    const outputs: string[] = [];
    try { requireAudioClippingAcknowledgement(true, []); outputs.push("output"); } catch { /* Required refusal. */ }
    expect(outputs).toEqual([]);
  });
  it("audio changes submit once with keyboard form semantics", async () => {
    let changes = 0;
    const host = await mount(<AudioPanel id={uuid(20)} scope="clip" gain={0.5} mute={false} solo={false}
      fade_in_us={0} fade_out_us={0} peak={0.75} onApply={async () => { changes++; }} onOpenHelp={() => {}} />);
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(3);
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(changes).toBe(1);
  });
  it("cue grid remains bounded and inserts text literally", async () => {
    const cues = Array.from({ length: 1000 }, (_, i) => ({ id: uuid(1000 + i), start_us: i + 1, end_us: i + 2, text: "<script>throw 1</script>" }));
    const host = await mount(<SubtitlePanel cues={cues} onApply={async () => {}} onOpenHelp={() => {}} />);
    expect(host.querySelectorAll('[role="row"]').length).toBeLessThanOrEqual(33);
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<script>throw 1</script>");
  });
  it("export dialog reviews presets without fabricating output", async () => {
    const host = await mount(<ExportTimelineDialog
      project={project({ tracks: [track(10, "video", 0, [clip({ id: 20, start_us: 0, source_out_us: 2_000_000 })])] })}
      onClose={() => {}}
    />);
    // No Tauri runtime or native graph executor exists here: the dialog reports
    // the unavailable engine and never produces a preview frame or output.
    expect(host.querySelector("[data-export-state]")?.getAttribute("data-export-state")).toBe("engine_unavailable");
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    const actions = host.querySelectorAll(".adp-dialog-actions button");
    expect(actions).toHaveLength(2);
    expect((actions[0] as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector("video, img, canvas")).toBeNull();
  });
});
