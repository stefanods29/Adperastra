import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import { formatSize } from "../services/format";
import type {
  AiCapabilityStatus,
  AiHardwareInfo,
  LocalAiSettings,
} from "../services/localAiTypes";

export interface AiRuntimeCardProps {
  settings: LocalAiSettings;
  hardware: AiHardwareInfo | null;
  capabilities: readonly AiCapabilityStatus[];
  onOpenStorage: () => void;
  onOpenHelp: (slug: string) => void;
  /** Only present after at least three completed tiles. */
  etaMs?: number | null;
}

const TIER_KEYS: Record<string, string> = {
  auto: "ai.auto",
  small: "ai.small",
  default: "ai.default",
  pro: "ai.pro",
};

export default function AiRuntimeCard(props: AiRuntimeCardProps) {
  const { t, i18n } = useTranslation();
  const upscale = props.capabilities.find((entry) => entry.task === "upscale") ?? null;
  const missing = upscale?.reason === "pack_missing" || upscale?.reason === "unverified";
  const hardware = props.hardware;
  const eta =
    props.etaMs && props.etaMs > 0
      ? new Intl.NumberFormat(i18n.language, {
          style: "unit",
          unit: "second",
          unitDisplay: "short",
        }).format(Math.max(1, Math.round(props.etaMs / 1000)))
      : null;

  return (
    <div className="adp-ai-runtime-card" role="status" aria-live="polite">
      <div className="adp-ai-runtime-head">
        <strong>{t("ai.settings")}</strong>
        <HelpButton onOpenHelp={() => props.onOpenHelp("ai-packs-hardware")} />
      </div>
      <p className="adp-ai-note">{t("ai.localOnly")}</p>
      {!props.settings.enabled ? <p>{t("ai.disabled")}</p> : null}
      {hardware ? (
        <dl className="adp-ai-facts">
          <div>
            <dt>{t("ai.memory")}</dt>
            <dd>{formatSize(hardware.ram_bytes, i18n.language)}</dd>
          </div>
          <div>
            <dt>{t("ai.tier")}</dt>
            <dd>{t(TIER_KEYS[hardware.recommended_tier] ?? "ai.default")}</dd>
          </div>
          {hardware.gpu_name ? (
            <div>
              <dt>{t("ai.gpu")}</dt>
              <dd>{hardware.gpu_name}</dd>
            </div>
          ) : (
            <div>
              <dt>{t("ai.device")}</dt>
              <dd>{t("ai.cpu")}</dd>
            </div>
          )}
        </dl>
      ) : null}
      {upscale && !upscale.available ? (
        <p className="adp-ai-note">
          {upscale.reason ? errorText(t, `ai.${upscale.reason}`, "ai") : t("ai.missing")}
        </p>
      ) : null}
      {props.settings.enabled && upscale?.available ? (
        eta ? (
          <p className="adp-ai-note">{t("ai.eta", { time: eta })}</p>
        ) : (
          <p className="adp-ai-note">{t("ai.calculating")}</p>
        )
      ) : null}
      {missing ? (
        <Button variant="primary" data-ai-action="storage" onClick={props.onOpenStorage}>
          {t("ai.storage")}
        </Button>
      ) : null}
    </div>
  );
}
