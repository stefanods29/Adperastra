import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import ProgressBar from "../components/ProgressBar";
import TextInput from "../components/TextInput";
import { displayPath } from "../services/explorer";
import { fileUrl } from "../services/files";
import { previewGrant, previewRevoke } from "../services/previewAccess";
import { loadSettings } from "../services/settings";
import { templatesPickFolder } from "../services/templates";
import { UndoStack } from "../services/undo";
import type { TrackJob, TrackJobOptions } from "../views/explorer/JobsPanel";
import type { ConversionEnvironment } from "./ConversionContext";
import { useConversionEnvironment } from "./ConversionContext";
import ConversionOptions from "./ConversionOptions";
import ConversionPreview from "./ConversionPreview";
import {
  MAX_COMBINE_IMAGES,
  convertersForInputs,
  defaultDestination,
  inputLabel,
  optionsFromValues,
  staticPreviewChanges,
  utcToday,
  valuesFromSpec,
} from "./convertOptions";
import { QUICK_CONVERT_CONVERTERS } from "./registry";
import type { ConversionPreset } from "../services/conversionPresets";
import type {
  ConversionDialogProps,
  ConversionInput,
  ConversionReport,
  ConverterSpec,
} from "./types";
import { useConversionActions } from "./useConversionActions";
import { useConversionPreview } from "./useConversionPreview";
import { useConversionQueue } from "./useConversionQueue";

const FALLBACK_TRACK_JOB = (async (options: TrackJobOptions<unknown>) => {
  const job = await options.start(() => undefined);
  const result = await job.completion;
  options.outcome(result);
  return result;
}) as unknown as TrackJob;

const FALLBACK_ENVIRONMENT: ConversionEnvironment = {
  trackJob: FALLBACK_TRACK_JOB,
  notify: () => undefined,
  notifyAction: () => undefined,
  notifyError: () => undefined,
  undoStack: new UndoStack(),
  touchUndo: () => undefined,
  currentFolder: () => null,
  showResult: () => undefined,
};

function outputLabel(spec: ConverterSpec): string {
  return spec.output === "jpeg" ? "JPEG" : spec.output.toUpperCase();
}

export interface QuickConvertDialogProps extends ConversionDialogProps {
  /** Step 09e batch actions: start from a saved conversion preset. */
  initialPreset?: ConversionPreset;
}

function initialValues(spec: ConverterSpec | null, preset: ConversionPreset | undefined): Record<string, boolean | number | string> {
  const base = spec ? valuesFromSpec(spec) : {};
  if (!preset) return base;
  const saved = preset.options.value as unknown as Record<string, unknown> | undefined;
  if (!saved) return base;
  for (const key of Object.keys(base)) {
    const value = saved[key];
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") base[key] = value;
  }
  return base;
}

export default function QuickConvertDialog({
  inputs,
  onClose,
  onCompleted,
  onOpenHelp,
  initialConverter,
  initialPreset,
}: QuickConvertDialogProps) {
  const { t } = useTranslation();
  const environment = useConversionEnvironment() ?? FALLBACK_ENVIRONMENT;
  const available = useMemo(
    () => convertersForInputs(QUICK_CONVERT_CONVERTERS, inputs),
    [inputs],
  );
  const requestedConverter = initialPreset?.converter_id ?? initialConverter;
  const initialSpec = available.find((spec) => spec.id === requestedConverter) ?? available[0] ?? null;
  const [converterId, setConverterId] = useState(initialSpec?.id ?? "");
  const spec = available.find((candidate) => candidate.id === converterId) ?? available[0] ?? null;
  const [values, setValues] = useState<Record<string, boolean | number | string>>(
    () => initialValues(initialSpec, initialPreset),
  );
  const [metadataKeep, setMetadataKeep] = useState(() => {
    const saved = initialPreset?.options.value as unknown as Record<string, unknown> | undefined;
    return saved?.metadata_keep !== false;
  });
  const [pattern] = useState(initialPreset?.name_pattern ?? "{stem}.{ext}");
  const [destination, setDestination] = useState(() =>
    initialPreset?.destination_mode === "ask" ? "" : defaultDestination(inputs),
  );
  const [accepted, setAccepted] = useState(false);
  const [replaceNotice, setReplaceNotice] = useState(false);
  const [original, setOriginal] = useState<{ url: string; token: string } | null>(null);
  const requestRevision = useRef(0);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;
  const firstKey =
    inputs[0]?.kind === "file"
      ? inputs[0].path
      : inputs[0]?.document_id ?? "";

  const options = useMemo(
    () =>
      spec
        ? optionsFromValues(spec, { ...values, metadata_keep: metadataKeep })
        : null,
    [spec, values, metadataKeep],
  );
  const preview = useConversionPreview({
    inputs,
    converter: spec,
    options,
    enabled: !spec ? false : true,
  });
  const actions = useConversionActions(environment, t);
  const completed = useCallback(
    (report: ConversionReport) => {
      // One grouped Undo entry for the actual created paths (T7), then the
      // caller's completion signal for its own refresh.
      void actions
        .record(report, destinationRef.current)
        .catch((error) => environment.notifyError(error, "convert"));
      onCompleted(report);
    },
    [actions, environment, onCompleted],
  );
  const queue = useConversionQueue(environment, completed);

  useEffect(() => {
    let active = true;
    let token: string | null = null;
    const first = inputs[0];
    setOriginal(null);
    if (first?.kind === "file") {
      void previewGrant(first.path, true)
        .then((grant) => {
          const granted = grant.token;
          if (!active) {
            void previewRevoke(granted).catch(() => undefined);
            return;
          }
          token = granted;
          setOriginal({
            url: fileUrl(granted, first.path.split("\\").filter(Boolean).pop() ?? "original"),
            token: granted,
          });
        })
        .catch(() => { if (active) setOriginal(null); });
    }
    return () => {
      active = false;
      if (token) void previewRevoke(token).catch(() => undefined);
    };
  }, [firstKey]);

  useEffect(() => {
    setAccepted(false);
  }, [spec?.id, values, metadataKeep, preview.state.revision]);

  // The saved defaults apply once, before the user changes anything; a
  // batch preset already carries the exact reviewed values.
  useEffect(() => {
    if (initialPreset) return;
    let active = true;
    void loadSettings().then((saved) => {
      if (!active) return;
      setValues((current) => {
        if (!spec?.options.some((option) => option.id === "quality")) return current;
        if (current.quality === saved.conversion.default_quality) return current;
        return { ...current, quality: saved.conversion.default_quality };
      });
      setMetadataKeep((current) =>
        current === saved.conversion.preserve_metadata
          ? current
          : saved.conversion.preserve_metadata,
      );
      if (saved.conversion.default_destination === "ask") {
        setDestination((current) => (current === "" ? current : ""));
      } else {
        setDestination((current) => {
          const next = current || defaultDestination(inputs);
          return next === current ? current : next;
        });
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!spec) {
    return (
      <Dialog title={t("convert.title")} onClose={onClose} className="adp-convert-dialog">
        <p className="adp-convert-note">{t("errors.convert.unsupported")}</p>
      </Dialog>
    );
  }

  const staticChanges = staticPreviewChanges(spec, inputs);
  const previewAvailable =
    preview.state.status === "ready" || preview.state.status === "unsupported";
  const requiredWarnings =
    preview.state.preview?.warnings ??
    (preview.state.status === "unsupported" ? staticChanges.warnings : []);
  const requiredLosses =
    preview.state.preview?.metadata_lost ??
    (preview.state.status === "unsupported" ? staticChanges.metadata_lost : []);
  const needsAcceptance = requiredWarnings.length > 0 || requiredLosses.length > 0;
  const combineOverLimit =
    spec.input_mode === "combine" && inputs.length > MAX_COMBINE_IMAGES;
  const running = queue.state.status === "running";
  const canConvert =
    !!destination &&
    !running &&
    previewAvailable &&
    !combineOverLimit &&
    (!needsAcceptance || accepted);

  const changeConverter = (id: string) => {
    const next = available.find((candidate) => candidate.id === id);
    if (!next) return;
    setConverterId(id);
    setValues(valuesFromSpec(next));
    setAccepted(false);
  };

  const start = async () => {
    if (!canConvert) return;
    requestRevision.current += 1;
    await queue.start({
      inputs: [...inputs],
      converter_id: spec.id,
      options: options ?? {
        kind: "image",
        value: {
          quality: 90,
          keep_aspect: true,
          allow_upscale: false,
          background_rgba: [255, 255, 255, 255] as [number, number, number, number],
          first_frame: false,
          metadata_keep: true,
        },
      },
      dest_dir: destination,
      keep_original: true,
      accepted_losses: accepted ? requiredLosses : [],
      accepted_warning_codes: accepted ? requiredWarnings : [],
      request_revision: requestRevision.current,
      naming: { pattern, date_utc: utcToday(), start_index: 1 },
    });
  };

  return (
    <Dialog title={t("convert.title")} onClose={() => { if (!running) onClose(); }} className="adp-convert-dialog">
      <p>{t("convert.undoUnavailable")}</p>
      <div className="adp-convert-format">
        <label className="adp-convert-label" htmlFor="adp-convert-format">
          {t("convert.format")}
        </label>
        <select
          id="adp-convert-format"
          className="adp-input"
          value={spec.id}
          disabled={running}
          onChange={(event) => changeConverter(event.target.value)}
        >
          {available.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {outputLabel(candidate)}
            </option>
          ))}
        </select>
        <HelpButton onOpenHelp={() => onOpenHelp(spec.help_slug)} />
      </div>
      {combineOverLimit ? (
        <p className="adp-convert-note" role="alert">
          {t("errors.convert.too_large")}
        </p>
      ) : null}

      <ConversionPreview
        originalUrl={original?.url ?? null}
        originalName={inputs[0] ? inputLabel(inputs[0]) : ""}
        preview={preview.state}
        onRetry={preview.retry}
      />

      <div className="adp-convert-destination">
        <span className="adp-convert-label">{t("convert.destination")}</span>
        <TextInput
          value={destination}
          onChange={setDestination}
          ariaLabel={t("convert.destination")}
          disabled={running}
        />
        <button
          type="button"
          className="adp-btn adp-btn--subtle"
          disabled={running}
          onClick={() => {
            void templatesPickFolder(t("convert.destination")).then((folder) => {
              if (folder) setDestination(displayPath(folder));
            });
          }}
        >
          {t("convert.chooseFolder")}
        </button>
      </div>

      <div className="adp-convert-row">
        <span className="adp-convert-label">{t("convert.keepOriginal")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={true}
          aria-label={t("convert.keepOriginal")}
          className="adp-switch-wrap"
          onClick={() => setReplaceNotice(true)}
        >
          <span className="adp-switch adp-switch--on">
            <span className="adp-switch-knob" />
          </span>
        </button>
      </div>

      <ConversionOptions
        spec={spec}
        values={values}
        onChange={(id, value) => {
          setValues((current) => ({ ...current, [id]: value }));
          setAccepted(false);
        }}
        metadataKeep={metadataKeep}
        onMetadataKeep={(value) => {
          setMetadataKeep(value);
          setAccepted(false);
        }}
        requiredWarnings={requiredWarnings}
        requiredLosses={requiredLosses}
        accepted={accepted}
        onAccepted={setAccepted}
        replaceNotice={replaceNotice}
        disabled={running}
      />

      <BatchList inputs={inputs} queue={queue.state.items} />

      <div className="adp-convert-footer">
        {running ? (
          <ProgressBar
            value={undefined}
            label={t("jobs.converting", { count: inputs.length })}
          />
        ) : null}
        {queue.canRetry ? (
          <button type="button" className="adp-btn adp-btn--subtle" onClick={() => void queue.retry()}>
            {t("convert.retry")}
          </button>
        ) : null}
        <span className="adp-convert-spacer" />
        <button
          type="button"
          className="adp-btn adp-btn--subtle"
          onClick={() => (running ? void queue.cancel() : onClose())}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="adp-btn adp-btn--primary"
          disabled={!canConvert}
          onClick={() => void start()}
        >
          {t("convert.action")}
        </button>
      </div>
    </Dialog>
  );
}

function BatchList({
  inputs,
  queue,
}: {
  inputs: readonly ConversionInput[];
  queue: { index: number; status: string; reason?: string; outputs: number }[];
}) {
  const { t } = useTranslation();
  const parent = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: inputs.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 28,
    overscan: 4,
  });
  return (
    <div className="adp-convert-batch" ref={parent} role="list" aria-label={t("convert.title")}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const input = inputs[virtual.index];
          const row = queue.find((item) => item.index === virtual.index);
          return (
            <div
              key={virtual.index}
              role="listitem"
              className="adp-convert-batch-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtual.size,
                transform: `translateY(${virtual.start}px)`,
              }}
            >
              <span className="adp-convert-batch-name">{inputLabel(input)}</span>
              {row && row.status !== "pending" ? (
                <span className="adp-convert-batch-status">
                  {row.status === "done"
                    ? t("jobs.done")
                    : row.status === "cancelled"
                      ? t("jobs.cancelled")
                      : row.reason
                        ? t(`errors.convert.${row.reason}`, {
                            defaultValue: t("errors.convert.other"),
                          })
                        : t("jobs.done")}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
