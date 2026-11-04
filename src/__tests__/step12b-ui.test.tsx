import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  capabilityAvailable,
  capabilityReason,
  findCapability,
} from "../services/engines";
import {
  defaultMediaOptions,
  isOfficeOutputFormat,
  isRenderableOfficeFormat,
  OFFICE_TEMPLATE_FORMATS,
  reduceFrameRate,
  validTimeRange,
  type EngineCapability,
} from "../services/engineTypes";
import { isCurrentGeneration, PreviewGenerations } from "../services/mediaEngine";
import {
  getConverters,
  getUnavailableConverters,
  MEDIA_CONVERTER_SPECS,
  registerAppConverters,
  registerEngineConverters,
  resetConverters,
} from "../convert/registry";
import { mediaOptionsFromValues } from "../convert/convertOptions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CAPABILITIES: EngineCapability[] = [
  { id: "media.probe", available: true, version: "9.0.2", reason: null },
  {
    id: "media.encode",
    available: false,
    version: "",
    reason: "packs_missing",
  },
  { id: "office.convert", available: true, version: "26.8.2", reason: null },
];

describe("step 12b engines", () => {
  it("media_missing_pack_card", () => {
    // A missing engine capability is "missing pack", never a silent failure.
    expect(capabilityAvailable(CAPABILITIES, "media.encode")).toBe(false);
    expect(capabilityReason(CAPABILITIES, "media.encode")).toBe("packs_missing");
    expect(capabilityAvailable(CAPABILITIES, "media.probe")).toBe(true);
    expect(capabilityReason(CAPABILITIES, "media.probe")).toBeNull();
    // An engine that never listed the capability is treated as missing too.
    expect(capabilityReason(CAPABILITIES, "media.preview")).toBe("packs_missing");
    expect(findCapability(CAPABILITIES, "office.convert")?.version).toBe("26.8.2");
    // A capability that is available carries no reason.
    for (const capability of CAPABILITIES) {
      if (capability.available) expect(capability.reason).toBeNull();
    }
  });

  it("conversion_uses_shared_registry", () => {
    // The media converters registered here must be exactly the ones the pure
    // adapter names, so the dialog cannot offer a converter no engine runs.
    const adapter = readFileSync(
      join(root, "crates", "convert", "src", "media_adapter.rs"),
      "utf8",
    );
    const registry = readFileSync(
      join(root, "src", "services", "engineTypes.ts"),
      "utf8",
    );
    for (const id of ["media/video", "media/audio", "media/gif"]) {
      expect(adapter).toContain(`"${id}"`);
      expect(registry).toContain(`"${id}"`);
    }
    // No file of this step starts a conversion itself: the shared 08a runner
    // owns the request, the sink and publication.
    const services = readdirSync(join(root, "src", "services"));
    for (const file of ["engineTypes.ts", "engines.ts", "mediaEngine.ts"]) {
      expect(services).toContain(file);
      const text = readFileSync(join(root, "src", "services", file), "utf8");
      expect(text).not.toContain('invoke("convert_start"');
      expect(text).not.toContain("publish");
    }
    // Engines are never called from a component: only the service modules
    // cross IPC; `engineTypes.ts` is the pure shared type module.
    const engineFiles = ["engines.ts", "mediaEngine.ts"].map((file) =>
      readFileSync(join(root, "src", "services", file), "utf8"),
    );
    for (const text of engineFiles) {
      expect(text).toContain("invoke(");
    }
    expect(readFileSync(join(root, "src", "services", "engineTypes.ts"), "utf8")).not.toContain(
      "invoke(",
    );
  });

  it("media_converters_are_capability_gated_and_options_map_exactly", () => {
    resetConverters();
    registerAppConverters();
    // Without the verified pack they stay declared but unavailable: the
    // dialog must show the missing-pack state, not offer a broken adapter.
    expect(getConverters(["mp4"]).filter((spec) => spec.engine_id === "media")).toHaveLength(0);
    expect(getUnavailableConverters(["mp4"]).map((spec) => spec.id)).toEqual(
      expect.arrayContaining(["media/video", "media/audio", "media/gif"]),
    );
    registerEngineConverters([
      { id: "media.encode", available: true, version: "9.0.2", reason: null },
    ]);
    const enabled = getConverters(["mp4"]).filter((spec) => spec.engine_id === "media");
    expect(enabled.map((spec) => spec.id)).toEqual(
      expect.arrayContaining(["media/video", "media/audio", "media/gif"]),
    );
    const video = enabled.find((spec) => spec.id === "media/video")!;
    expect(video.output).toBe("webm");
    expect(video.options.map((option) => option.id)).toEqual([
      "start_ms",
      "end_ms",
      "width",
      "height",
      "bitrate_kbps",
      "sample_rate",
      "keep_metadata",
    ]);
    expect(
      mediaOptionsFromValues({
        start_ms: 0,
        end_ms: 2500,
        width: 1280,
        height: 0,
        bitrate_kbps: 0,
        sample_rate: 0,
        keep_metadata: true,
      }),
    ).toMatchObject({
      start_ms: null,
      end_ms: 2500,
      width: 1280,
      height: null,
      video_codec: "auto",
      audio_codec: "auto",
      keep_metadata: true,
      burn_subtitles: false,
    });
    // A later probe without the pack withdraws them again.
    registerEngineConverters([
      { id: "media.encode", available: false, version: "", reason: "packs_missing" },
    ]);
    expect(getConverters(["mp4"]).filter((spec) => spec.engine_id === "media")).toHaveLength(0);
    expect(MEDIA_CONVERTER_SPECS.every((spec) => !spec.available)).toBe(true);
  });

  it("review_roundtrip_and_network_denial_corpus", () => {
    // Both languages carry the three pages, and every page states the two
    // promises the review roundtrip depends on.
    const english = readdirSync(join(root, "help", "en"));
    const spanish = readdirSync(join(root, "help", "es"));
    for (const page of [
      "converting-media.md",
      "converting-documents.md",
      "privacy-office-media.md",
    ]) {
      expect(english).toContain(page);
      expect(spanish).toContain(page);
    }
    const media = readFileSync(
      join(root, "help", "en", "converting-media.md"),
      "utf8",
    );
    expect(media).toMatch(/Originals are kept/);
    expect(media).toMatch(/Media tools pack/);
    expect(media).not.toMatch(/https?:\/\//);

    const documents = readFileSync(
      join(root, "help", "en", "converting-documents.md"),
      "utf8",
    );
    expect(documents).toMatch(/Macros and external links never run/);
    expect(documents).toMatch(/App storage/);

    const privacyPage = readFileSync(
      join(root, "help", "en", "privacy-office-media.md"),
      "utf8",
    );
    expect(privacyPage).toMatch(/Unlisted information is not claimed removed/);
    expect(privacyPage).toMatch(/Originals remain unchanged/);

    const spanishDocuments = readFileSync(
      join(root, "help", "es", "converting-documents.md"),
      "utf8",
    );
    expect(spanishDocuments).toMatch(/Nunca se ejecutan macros ni vínculos externos/);
  });

  it("frame rates and time ranges stay exact integers", () => {
    expect(reduceFrameRate(60, 2)).toEqual({ num: 30, den: 1 });
    expect(reduceFrameRate(33_333, 1_000)).toEqual({ num: 33_333, den: 1_000 });
    expect(reduceFrameRate(0, 1)).toBeNull();
    expect(reduceFrameRate(1, 100_001)).toBeNull();
    expect(validTimeRange(0, 1_000_000)).toBe(true);
    expect(validTimeRange(5, 5)).toBe(false);
    expect(validTimeRange(-1, null)).toBe(false);
  });

  it("a slower earlier preview never replaces a newer one", () => {
    const generations = new PreviewGenerations();
    const first = generations.begin();
    const second = generations.begin();
    expect(generations.isCurrent(second)).toBe(true);
    expect(generations.isCurrent(first)).toBe(false);
    expect(isCurrentGeneration(second, first)).toBe(false);
    generations.reset();
    expect(generations.isCurrent(second)).toBe(false);
  });

  it("templates are inspection inputs only", () => {
    expect(isRenderableOfficeFormat("docx")).toBe(true);
    expect(isRenderableOfficeFormat("potx")).toBe(false);
    expect(isRenderableOfficeFormat("otp")).toBe(false);
    expect(OFFICE_TEMPLATE_FORMATS).toEqual(["potx", "otp"]);
    expect(isOfficeOutputFormat("pdf")).toBe(true);
    expect(isOfficeOutputFormat("docx")).toBe(false);
    // Media metadata stays by default.
    expect(defaultMediaOptions().keep_metadata).toBe(true);
    expect(defaultMediaOptions().burn_subtitles).toBe(false);
  });
});
