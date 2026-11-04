import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatSize } from "../services/format";
import type { AiSourceLocation } from "../services/localAiTypes";
import type { AssistantOutboundPreview } from "./types";

export interface AssistantOutboundDialogProps {
  preview: AssistantOutboundPreview;
  onSend(): void;
  onCancel(): void;
  busy?: boolean;
  /** A consent was already created or refused; Send stays disabled. */
  settled?: boolean;
  /** Full translation key for a stable consent error. */
  errorKey?: string | null;
}

function providerLabel(preview: AssistantOutboundPreview, t: TFunction): string {
  if (preview.provider_id === "meta") return "Meta";
  if (preview.provider_id === "custom_compatible") return t("assistant.otherApi");
  return t("assistant.local");
}

function secondsLabel(seconds: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "long",
    maximumFractionDigits: 0,
  }).format(Math.max(1, seconds));
}

function minutesLabel(minutes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "long",
    maximumFractionDigits: 0,
  }).format(minutes);
}

function locationLabel(location: AiSourceLocation, t: TFunction, locale: string): string {
  switch (location.kind) {
    case "text":
      return `${location.start}\u2013${location.end}`;
    case "page":
      return t("assistant.page", { page: location.page });
    case "time":
      return t("assistant.time", {
        time: secondsLabel(Math.round(location.start_us / 1_000_000), locale),
      });
    case "sheet":
      return `${location.sheet_id} \u00b7 ${location.range}`;
    case "slide":
      return location.slide_id;
    case "image":
      return location.region
        ? `${location.region.x},${location.region.y} \u00b7 ${location.region.width}\u00d7${location.region.height}`
        : "\u2014";
    default:
      return "\u2014";
  }
}

/**
 * Native-owned review content. The web view renders the same exact bytes the
 * native gateway will send; only the native Send button creates a consent.
 * Focus starts on Cancel, so Enter cannot send by accident. The Send control
 * operates once, stops working when the preview expires, and never stores a
 * consent in the web view.
 */
export function AssistantOutboundDialog({
  preview,
  onSend,
  onCancel,
  busy,
  settled,
  errorKey,
}: AssistantOutboundDialogProps) {
  const { t, i18n } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const expiresUnix = Number.isFinite(preview.expires_unix) ? preview.expires_unix : 0;
  const remaining = expiresUnix - nowUnix;
  const expired = remaining <= 0;
  const remainingText =
    remaining >= 60
      ? minutesLabel(Math.ceil(remaining / 60), i18n.language)
      : secondsLabel(remaining, i18n.language);
  const provider = providerLabel(preview, t);
  const expiryDate = new Date(expiresUnix * 1000);
  const expiryIso = Number.isNaN(expiryDate.getTime()) ? undefined : expiryDate.toISOString();

  return (
    <div className="adp-assistant-outbound-backdrop">
      <section
        className="adp-assistant-outbound"
        role="dialog"
        aria-modal="true"
        aria-label={t("assistant.outbound")}
      >
        <h2 className="adp-assistant-action-title">{t("assistant.outbound")}</h2>
        {preview.backend === "api" ? (
          <p className="adp-assistant-notice">
            {t("assistant.apiNotice", { provider })}
          </p>
        ) : null}
        {preview.local_server ? (
          <p className="adp-assistant-notice">{t("assistant.serverNotice")}</p>
        ) : null}
        <dl className="adp-assistant-outbound-facts">
          <div>
            <dt>{t("assistant.provider")}</dt>
            <dd>{provider}</dd>
          </div>
          <div>
            <dt>{t("assistant.model")}</dt>
            <dd>
              <code className="adp-assistant-outbound-hash">{preview.model_id}</code>
            </dd>
          </div>
          <div>
            <dt>{t("assistant.source")}</dt>
            <dd>{preview.sources.length}</dd>
          </div>
          {preview.payload_sha256 ? (
            <div>
              <dt>SHA-256</dt>
              <dd>
                <code className="adp-assistant-outbound-hash">{preview.payload_sha256}</code>
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="adp-assistant-meta">
          {t("assistant.outboundBytes", {
            size: formatSize(preview.byte_len, i18n.language),
          })}
        </p>
        {expired ? (
          <p className="adp-assistant-error" role="alert">
            {t("errors.assistant.outbound_expired")}
          </p>
        ) : (
          <p className="adp-assistant-meta">
            <time dateTime={expiryIso}>{t("ai.eta", { time: remainingText })}</time>
          </p>
        )}
        <div className="adp-assistant-outbound-list" role="list">
          {preview.sources.slice(0, 128).map((source, index) => (
            <article
              className="adp-assistant-outbound-source"
              role="listitem"
              key={`${source.input_id}-${source.revision}-${index}`}
            >
              <h3>{source.label}</h3>
              <p className="adp-assistant-meta">
                {source.mime} {"\u00b7"} {formatSize(source.byte_len, i18n.language)}{" "}
                {"\u00b7"} <span>r{source.revision}</span>{" "}
                {"\u00b7"} {locationLabel(source.location, t, i18n.language)}
              </p>
              <pre className="adp-assistant-excerpt">{source.excerpt}</pre>
            </article>
          ))}
        </div>
        {errorKey ? (
          <p className="adp-assistant-error" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
        <div className="adp-assistant-action-buttons">
          <button
            type="button"
            className="adp-button adp-button--primary"
            onClick={onSend}
            disabled={busy || settled || expired}
          >
            {t("assistant.sendContent")}
          </button>
          <button ref={cancelRef} type="button" className="adp-button" onClick={onCancel} disabled={busy}>
            {t("assistant.cancel")}
          </button>
        </div>
      </section>
    </div>
  );
}
