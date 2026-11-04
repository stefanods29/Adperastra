/** Settings > Local AI (Step 14c, schema 41). Every task is opt-in. */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Switch from "../../components/Switch";
import AiRuntimeCard from "../../ai/AiRuntimeCard";
import { aiCapabilities, aiHardware, shutdownAi } from "../../services/localAiRuntime";
import {
  AI_TASK_KINDS,
  normalizeLocalAiSettings,
  type AiCapabilityStatus,
  type AiDevice,
  type AiHardwareInfo,
  type AiTaskKind,
  type AiTier,
  type LocalAiSettings as LocalAiSettingsValue,
} from "../../services/localAiTypes";
import type { AppSettings } from "../../services/settings";

const DEVICES: readonly AiDevice[] = ["auto", "cpu", "gpu"];
const TIERS: readonly AiTier[] = ["auto", "small", "default", "pro"];

const TASK_KEYS: Record<AiTaskKind, string> = {
  structured_text: "ai.taskStructuredText",
  vision_answer: "ai.taskVisionAnswer",
  embed_text: "ai.taskEmbedText",
  embed_image: "ai.taskEmbedImage",
  transcribe: "ai.taskTranscribe",
  upscale: "ai.taskUpscale",
  foreground_mask: "ai.taskForegroundMask",
  inpaint: "ai.taskInpaint",
};

export interface LocalAiSettingsProps {
  settings: AppSettings & { local_ai: LocalAiSettingsValue };
  onApply: (settings: AppSettings & { local_ai: LocalAiSettingsValue }) => void;
  onOpenHelp: (slug: string) => void;
  onOpenStorage: () => void;
}

export default function LocalAiSettings(props: LocalAiSettingsProps) {
  const { t, i18n } = useTranslation();
  const value = normalizeLocalAiSettings(props.settings.local_ai);
  const seconds = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
  }).format(value.idle_unload_seconds);
  const megabytes = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
  }).format(value.memory_limit_mb);
  const [hardware, setHardware] = useState<AiHardwareInfo | null>(null);
  const [capabilities, setCapabilities] = useState<AiCapabilityStatus[]>([]);

  useEffect(() => {
    let live = true;
    void aiHardware()
      .then((info) => {
        if (live) setHardware(info);
      })
      .catch(() => undefined);
    void aiCapabilities()
      .then((list) => {
        if (live) setCapabilities(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const update = (patch: Partial<LocalAiSettingsValue>) => {
    props.onApply({
      ...props.settings,
      local_ai: { ...value, ...patch, tasks: { ...value.tasks, ...(patch.tasks ?? {}) } },
    });
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!enabled) await shutdownAi().catch(() => undefined);
    update({ enabled });
  };

  return (
    <section className="adp-settings-section" aria-labelledby="adp-ai-title">
      <div className="adp-view-header">
        <h3 id="adp-ai-title" className="adp-heading">
          {t("ai.settings")}
        </h3>
      </div>
      <div className="adp-setting-row">
        <Switch
          checked={value.enabled}
          label={t("ai.enabled")}
          onChange={(enabled) => void toggleEnabled(enabled)}
        />
      </div>
      <AiRuntimeCard
        settings={value}
        hardware={hardware}
        capabilities={capabilities}
        onOpenStorage={props.onOpenStorage}
        onOpenHelp={props.onOpenHelp}
      />
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-ai-device">
          {t("ai.device")}
        </label>
        <select
          id="adp-ai-device"
          className="adp-defaultapps-select"
          value={value.device}
          disabled={!value.enabled}
          onChange={(event) => update({ device: event.target.value as AiDevice })}
        >
          {DEVICES.map((device) => (
            <option key={device} value={device}>
              {t(device === "auto" ? "ai.auto" : device === "cpu" ? "ai.cpu" : "ai.gpu")}
            </option>
          ))}
        </select>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-ai-tier">
          {t("ai.tier")}
        </label>
        <select
          id="adp-ai-tier"
          className="adp-defaultapps-select"
          value={value.tier}
          disabled={!value.enabled}
          onChange={(event) => update({ tier: event.target.value as AiTier })}
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {t(tier === "auto" ? "ai.auto" : tier === "small" ? "ai.small" : tier === "pro" ? "ai.pro" : "ai.default")}
            </option>
          ))}
        </select>
        {hardware && hardware.recommended_tier === value.tier ? (
          <span className="adp-note">{t("ai.recommended")}</span>
        ) : null}
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-ai-idle">
          {t("ai.idle")}
        </label>
        <input
          id="adp-ai-idle"
          type="range"
          min={30}
          max={600}
          step={30}
          value={value.idle_unload_seconds}
          disabled={!value.enabled}
          onChange={(event) => update({ idle_unload_seconds: Number(event.target.value) })}
        />
        <span className="adp-note">{seconds}</span>
      </div>
      <div className="adp-setting-row">
        <label className="adp-setting-label" htmlFor="adp-ai-memory">
          {t("ai.memory")}
        </label>
        <input
          id="adp-ai-memory"
          type="range"
          min={512}
          max={8192}
          step={512}
          value={value.memory_limit_mb}
          disabled={!value.enabled}
          onChange={(event) => update({ memory_limit_mb: Number(event.target.value) })}
        />
        <span className="adp-note">{megabytes}</span>
      </div>
      <fieldset className="adp-ai-task-list">
        <legend>{t("ai.tasks")}</legend>
        {AI_TASK_KINDS.map((kind) => (
          <div key={kind} className="adp-setting-row">
            <Switch
              checked={value.tasks[kind]}
              disabled={!value.enabled}
              label={t(TASK_KEYS[kind])}
              onChange={(checked) => update({ tasks: { ...value.tasks, [kind]: checked } })}
            />
            {kind !== "upscale" ? <span className="adp-note">{t("ai.experimental")}</span> : null}
          </div>
        ))}
      </fieldset>
    </section>
  );
}
