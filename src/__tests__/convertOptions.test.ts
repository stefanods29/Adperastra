import { describe, expect, it } from "vitest";
import {
  MAX_COMBINE_IMAGES,
  defaultDestination,
  convertersForInputs,
  documentOptionsFromValues,
  imageOptionsFromValues,
  inputFormats,
  lossesAccepted,
  optionsFromValues,
  retryInputs,
  staticPreviewChanges,
  utcToday,
  valuesFromSpec,
} from "../convert/convertOptions";
import { APP_CONVERTERS, QUICK_CONVERT_CONVERTERS } from "../convert/registry";
import type { ConversionInput, ConversionReport } from "../convert/types";
import { defaultSettings, normalizeSettings } from "../services/settings";

const png = APP_CONVERTERS.find((spec) => spec.id === "image/png")!;
const imagesPdf = QUICK_CONVERT_CONVERTERS.find((spec) => spec.id === "images/pdf")!;

function report(overrides: Partial<ConversionReport> = {}): ConversionReport {
  return {
    report_id: "r",
    items: [],
    outputs: [],
    created_paths: [],
    input_total: 0,
    done_count: 0,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    outputs_created: 0,
    cancelled: false,
    job_finished: true,
    complete: true,
    ...overrides,
  };
}

describe("conversion options", () => {
  it("does not advertise image converters for an unknown input extension", () => {
    expect(convertersForInputs(APP_CONVERTERS, [{ kind: "file", path: "C:\\notes.unknown" }])).toEqual([]);
  });

  it("400x200 with width 100 keeps the 2:1 proportions", () => {
    const values = valuesFromSpec(png);
    values.width = 100;
    const options = imageOptionsFromValues(png, values);
    expect(options.width).toBe(100);
    expect(options.height).toBeUndefined();
    expect(options.keep_aspect).toBe(true);
    expect(options.allow_upscale).toBe(false);
    expect(optionsFromValues(png, values).kind).toBe("image");
  });

  it("maps images/pdf to the document page-size and margin options", () => {
    const values = valuesFromSpec(imagesPdf);
    values.page_size = "letter";
    values.margin_mm = 12;
    expect(optionsFromValues(imagesPdf, values)).toEqual({
      kind: "document",
      value: {
        include_images: true,
        page_size: "letter",
        margin_mm: 12,
        sanitize: true,
        encoding: "utf8",
      },
    });
    expect(documentOptionsFromValues(imagesPdf, { ...values, margin_mm: 99 }).margin_mm).toBe(50);
  });

  it("surfaces the static metadata and animated-GIF acknowledgements", () => {
    const changes = staticPreviewChanges(imagesPdf, [
      { kind: "file", path: "C:\\Pictures\\one.gif" },
    ]);
    expect(changes.warnings).toEqual(["animation_first_frame"]);
    expect(changes.metadata_lost).toContain("exif");
    expect(staticPreviewChanges(imagesPdf, [{ kind: "file", path: "C:\\Pictures\\one.png" }]).warnings).toEqual([]);
    expect(MAX_COMBINE_IMAGES).toBe(256);
  });

  it("keeps metadata unless the user turns it off", () => {
    const values = { ...valuesFromSpec(png), metadata_keep: false };
    expect(imageOptionsFromValues(png, values).metadata_keep).toBe(false);
    expect(imageOptionsFromValues(png, valuesFromSpec(png)).metadata_keep).toBe(true);
  });

  it("names every selected input format once", () => {
    const inputs: ConversionInput[] = [
      { kind: "file", path: "C:\\a\\one.png" },
      { kind: "file", path: "C:\\a\\two.png" },
    ];
    expect(inputFormats(inputs)).toEqual(["png"]);
    const mixed: ConversionInput[] = [
      { kind: "file", path: "C:\\a\\one.png" },
      { kind: "file", path: "C:\\a\\two.jpg" },
    ];
    expect(inputFormats(mixed)).toEqual(["png", "jpeg"]);
  });

  it("defaults one input to its folder and mixed roots to no folder", () => {
    expect(defaultDestination([{ kind: "file", path: "C:\\Pictures\\a.png" }])).toBe(
      "C:\\Pictures",
    );
    expect(
      defaultDestination([
        { kind: "file", path: "C:\\Pictures\\a.png" },
        { kind: "file", path: "D:\\Other\\b.png" },
      ]),
    ).toBe("");
    expect(
      defaultDestination([{ kind: "snapshot", snapshot_id: "s", document_id: "d", revision: 1 }]),
    ).toBe("");
  });

  it("retries only failed or skipped rows", () => {
    const inputs: ConversionInput[] = [
      { kind: "file", path: "C:\\a.png" },
      { kind: "file", path: "C:\\b.png" },
      { kind: "file", path: "C:\\c.png" },
    ];
    const retry = retryInputs(
      report({
        items: [
          { input_index: 0, output_count: 1, status: "done", metadata_lost: [], bytes_written: 1 },
          { input_index: 1, output_count: 0, status: "failed", reason: "bad_request", metadata_lost: [], bytes_written: 0 },
          { input_index: 2, output_count: 0, status: "skipped", reason: "unsupported", metadata_lost: [], bytes_written: 0 },
        ],
      }),
      inputs,
    );
    expect(retry.map((input) => input.kind === "file" ? input.path : null)).toEqual(["C:\\b.png", "C:\\c.png"]);
    expect(retry.some((input) => input.kind === "file" && input.path === "C:\\a.png")).toBe(false);
  });

  it("requires every loss and warning to be accepted", () => {
    expect(lossesAccepted(["transparency_loss"], [], [], [])).toBe(false);
    expect(lossesAccepted(["transparency_loss"], ["transparency_loss"], [], [])).toBe(true);
    expect(lossesAccepted([], [], ["icc"], [])).toBe(false);
    expect(lossesAccepted([], [], ["icc"], ["icc"])).toBe(true);
  });

  it("formats the naming date as a UTC day", () => {
    expect(utcToday(new Date(Date.UTC(2026, 10, 2, 23, 59)))).toBe("2026-11-02");
  });

  it("keeps schema 15 language, theme and templates and adds quality 90", () => {
    const settings = normalizeSettings({
      schema_version: 15,
      language: "es",
      theme: { mode: "dark", accent_source: "design", accent_custom: null, light_theme: "light", dark_theme: "dark" },
      templates: { my_folder: "C:\\Templates" },
    });
    expect(settings.language).toBe("es");
    expect(settings.theme.mode).toBe("dark");
    expect(settings.templates.my_folder).toBe("C:\\Templates");
    expect(settings.conversion.default_quality).toBe(90);
    expect(settings.conversion.default_destination).toBe("source");
    expect(settings.conversion.preserve_metadata).toBe(true);
    expect(settings.conversion.concurrent_jobs).toBe(2);
    expect(defaultSettings().conversion.default_quality).toBe(90);
  });
});
