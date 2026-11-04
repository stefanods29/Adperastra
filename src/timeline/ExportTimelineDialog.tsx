import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../components/Button";
import Dialog from "../components/Dialog";
import HelpButton from "../components/HelpButton";
import type { EngineCapability } from "../services/engineTypes";
import { capabilityAvailable, capabilityReason, engineCapabilities } from "../services/engines";
import { isTauriRuntime } from "../services/settings";
import { audioClippingRequired } from "./audioMix";
import { timelinePresetOptions, type TimelinePresetId, type TimelinePresetOptions } from "./exportPresets";
import { formatTimecode } from "./format";
import { normalizeTimeline } from "./renderPlan";
import type { TimelineProject } from "./types";

const PRESETS: readonly { id: TimelinePresetId; labelKey: string }[] = [
  { id: "web", labelKey: "timelineEffects.web" },
  { id: "phone", labelKey: "timelineEffects.phone" },
  { id: "high", labelKey: "timelineEffects.high" },
  { id: "audioOnly", labelKey: "timelineEffects.audioOnly" },
];

const ENCODER_CAPABILITY = "media.encode";

/** No native graph executor or publication sink exists in this build, so the
 * dialog can review settings and report capability state but never starts a
 * job or claims a preview. */
const PROVIDER_AVAILABLE = false;

type EncoderState = "checking" | "check_failed" | "pack_missing" | "capability_unavailable" | "engine_unavailable";

function formatLabel(options: TimelinePresetOptions, preset: TimelinePresetId): string {
  const container = options.container.toUpperCase();
  if (preset === "audioOnly") return container;
  return `${container} · ${options.video_codec.toUpperCase()} · ${options.audio_codec.toUpperCase()}`;
}

export interface ExportTimelineDialogProps {
  project: Readonly<TimelineProject>;
  onClose: () => void;
  onOpenHelp?: (slug: string) => void;
}

/** Bounded export review (Step 19b T6). Presets are the fixed D7 set; the
 * dialog validates the current plan and shows the verified encoder pack state.
 * It never fabricates a captured revision, a preview frame or a report. */
export default function ExportTimelineDialog({ project, onClose, onOpenHelp }: ExportTimelineDialogProps) {
  const { t, i18n } = useTranslation();
  const statusId = useId();
  const [preset, setPreset] = useState<TimelinePresetId>("web");
  const [capabilities, setCapabilities] = useState<readonly EngineCapability[] | null>(null);
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const runtime = isTauriRuntime();

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void engineCapabilities()
      .then((list) => {
        // A malformed reply is treated as no verified capability; the dialog
        // then reports a missing pack instead of trusting an unchecked claim.
        if (!cancelled) setCapabilities(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setCapabilityFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  // A project that cannot normalize has no honest preset summary. The native
  // side would refuse it too; this dialog shows the stable timeline error.
  const plan = useMemo(() => {
    try {
      return normalizeTimeline(project);
    } catch {
      return null;
    }
  }, [project]);

  const options = useMemo(() => {
    if (!plan) return null;
    try {
      return timelinePresetOptions(preset, plan);
    } catch {
      return null;
    }
  }, [plan, preset]);

  const clippingWarning = useMemo(() => {
    if (!plan) return false;
    try {
      return audioClippingRequired(plan);
    } catch {
      return false;
    }
  }, [plan]);

  const encoderState: EncoderState = !runtime
    ? "engine_unavailable"
    : capabilityFailed
      ? "check_failed"
      : capabilities === null
        ? "checking"
        : capabilityReason(capabilities, ENCODER_CAPABILITY) === "packs_missing"
          ? "pack_missing"
          : capabilityAvailable(capabilities, ENCODER_CAPABILITY)
            // The verified pack is present, but no native graph executor or
            // publication sink exists in this build.
            ? "engine_unavailable"
            : "capability_unavailable";

  const statusText = encoderState === "pack_missing"
    ? t("errors.timeline_export.pack_missing")
    : encoderState === "check_failed"
      ? t("errors.engines.failed")
      : encoderState === "checking"
        ? null
        : t("errors.engines.unsupported");
  const canStart = PROVIDER_AVAILABLE && capabilities !== null && plan !== null && options !== null &&
    capabilityAvailable(capabilities, ENCODER_CAPABILITY);

  return (
    <Dialog title={t("timelineEffects.export")} onClose={onClose} className="adp-timeline-export-dialog">
      <div className="adp-timeline-export">
        <fieldset className="adp-timeline-export-presets" disabled={!plan}>
          <legend>{t("convert.preset")}</legend>
          <div className="adp-timeline-export-preset-row">
            {PRESETS.map((item) => (
              <label key={item.id}>
                <input
                  type="radio"
                  name="timeline-export-preset"
                  value={item.id}
                  checked={preset === item.id}
                  onChange={() => setPreset(item.id)}
                />
                <span>{t(item.labelKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {plan && options ? (
          <dl className="adp-timeline-export-summary">
            <dt>{t("convert.format")}</dt>
            <dd>{formatLabel(options, preset)}</dd>
            <dt>{t("convert.width")} × {t("convert.height")}</dt>
            <dd>{options.width} × {options.height}</dd>
            <dt>{t("metadata.frameRate")}</dt>
            <dd>{options.frame_rate.num}/{options.frame_rate.den}</dd>
            <dt>{t("metadata.duration")}</dt>
            <dd>{formatTimecode(plan.duration_us, i18n.language)}</dd>
            <dt>{t("convert.keepMetadata")}</dt>
            <dd>
              <input type="checkbox" checked={options.metadata_keep} disabled readOnly aria-label={t("convert.keepMetadata")} />
            </dd>
          </dl>
        ) : (
          <p role="alert">{t("errors.timeline.failed")}</p>
        )}
        {clippingWarning ? <p role="status">{t("timelineEffects.clipping")}</p> : null}
        {statusText ? (
          <p id={statusId} className="adp-timeline-export-status" role="status" data-export-state={encoderState}>
            {statusText}
          </p>
        ) : null}
        <div className="adp-dialog-actions">
          <Button variant="primary" disabled={!canStart} aria-describedby={statusText ? statusId : undefined}>
            {t("common.export")}
          </Button>
          <Button onClick={onClose}>{t("common.close")}</Button>
          {onOpenHelp ? <HelpButton onOpenHelp={() => onOpenHelp("timeline-export")} /> : null}
        </div>
      </div>
    </Dialog>
  );
}
