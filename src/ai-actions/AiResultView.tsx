import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import Skeleton from "../components/Skeleton";
import type { AiActionResult } from "../services/aiActionTypes";
import type { ConversionRequest } from "../convert/types";
import { getAiActionResult, releaseAiActionResult } from "../services/aiActions";
import { aiActionSpec } from "./registry";

/**
 * The `ai_result` tab body (D12, `ai-actions-1` E2).
 *
 * Header 40, model/backend notice 32, scrollable content, footer 48. Nothing
 * here is HTML: blocks are plain text with escaped display, citations are
 * buttons, and Save copy goes through the 08a converter with an owned new
 * file. Closing the tab releases the suggestion; new reads are refused.
 */

export interface AiResultViewProps {
  result_id: string;
  active: boolean;
  onOpenHelp: (slug: string) => void;
  onSaveCopy?: (result: AiActionResult, request: Omit<ConversionRequest, "inputs" | "converter_id" | "options">) => Promise<void>;
  onRetry?: () => void;
  onDiscard?: () => void;
}

export function sourceLabel(index: number): string {
  return `S${index + 1}`;
}

/** Every API text result shows where it went; local results say so too. */
export function backendNoticeKey(backend: "local" | "api"): "assistant.apiNotice" | "speech.local" {
  return backend === "api" ? "assistant.apiNotice" : "speech.local";
}

/** Close/discard revokes new reads; already granted leases finish. */
export function releaseOnClose(resultId: string): Promise<void> {
  return releaseAiActionResult(resultId);
}

export function AiResultView({ result_id, active, onOpenHelp, onSaveCopy, onRetry, onDiscard }: AiResultViewProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<AiActionResult | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "words" | "failed">("loading");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const words = window.setTimeout(() => {
      if (!cancelled) setPhase((current) => (current === "loading" ? "words" : current));
    }, 1000);
    getAiActionResult(result_id)
      .then((value) => {
        if (cancelled) return;
        setResult(value);
        setPhase("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorCode(error instanceof Error ? error.message : "ai_actions.failed");
        setPhase("failed");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(words);
    };
  }, [result_id]);

  useEffect(() => {
    if (!active) return;
    return () => {
      // A tab that is gone releases its suggestion; other leases finish.
      releaseOnClose(result_id).catch(() => undefined);
    };
  }, [active, result_id]);

  const discard = useCallback(() => {
    releaseOnClose(result_id).catch(() => undefined);
    onDiscard?.();
  }, [onDiscard, result_id]);

  const saveCopy = useCallback(async () => {
    if (!result || !onSaveCopy) return;
    await onSaveCopy(result, {
      dest_dir: "",
      keep_original: true,
      accepted_losses: [],
      accepted_warning_codes: [],
      naming: { pattern: "{name}", date_utc: new Date().toISOString(), start_index: 1 },
      request_revision: 1,
    } as never);
  }, [onSaveCopy, result]);

  const citations = result?.citations ?? [];
  const backendNotice = result
    ? result.backend === "api"
      ? t(backendNoticeKey("api"), { provider: result.provider_id ?? "API" })
      : t(backendNoticeKey("local"))
    : t("aiActions.preview");

  return (
    <section className="adp-ai-result" role="region" aria-label={t("aiActions.title")}>
      <header className="adp-ai-result-header">
        <h2>{t("aiActions.title")}</h2>
        <HelpButton
          onOpenHelp={() =>
            onOpenHelp(result ? aiActionSpec(result.action).help_slug : "checking-ai-suggestions")
          }
        />
      </header>

      <div className="adp-ai-result-notice" role="status">
        {result ? backendNotice : t("aiActions.preview")}
      </div>

      <div className="adp-ai-result-content">
        {phase === "loading" ? <Skeleton variant="rows" count={3} /> : null}
        {phase === "words" ? <p role="status">{t("aiActions.preview")}</p> : null}
        {phase === "failed" ? <p role="alert">{t("errors.ai_actions.failed")}</p> : null}
        {result ? <ResultBody result={result} /> : null}
        {result?.warnings.includes("partial") ? <p role="status">{t("aiActions.partial")}</p> : null}
        {result?.sensitive ? <p role="status">{t("assistant.sensitiveApi")}</p> : null}
        {errorCode ? <code>{errorCode}</code> : null}

        {citations.length > 0 ? (
          <div className="adp-ai-result-sources" aria-label={t("aiActions.sources")}>
            <h3>{t("aiActions.sources")}</h3>
            {citations.map((citation, index) => (
              <button key={`${citation.input_id}-${index}`} type="button" className="adp-ai-result-source">
                {sourceLabel(index)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="adp-ai-result-footer">
        <button type="button" onClick={() => void saveCopy()} disabled={!result || !onSaveCopy}>
          {t("aiActions.saveCopy")}
        </button>
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            {t("assistant.retry")}
          </button>
        ) : null}
        <button type="button" onClick={discard}>
          {t("aiActions.discard")}
        </button>
      </footer>
    </section>
  );
}

function ResultBody({ result }: { result: AiActionResult }) {
  const { t } = useTranslation();
  const payload = result.payload;
  switch (payload.kind) {
    case "text":
      return (
        <div className="adp-ai-result-blocks">
          {payload.blocks.length === 0 ? <p>{t("aiActions.noResult")}</p> : null}
          {payload.blocks.map((block) => (
            <p key={block.id} className={`adp-ai-result-${block.kind}`}>
              {block.plain_text}
            </p>
          ))}
        </div>
      );
    case "faq":
      return (
        <dl className="adp-ai-result-faq">
          {payload.pairs.map((pair, index) => (
            <div key={index}>
              <dt>{pair.question}</dt>
              <dd>{pair.answer}</dd>
            </div>
          ))}
        </dl>
      );
    case "translation":
      return (
        <div className="adp-ai-result-translation">
          {payload.pairs.map((pair, index) => (
            <div key={index} className="adp-ai-result-pair">
              <p>{pair.source_text}</p>
              <p>{pair.translated_text}</p>
            </div>
          ))}
        </div>
      );
    case "key_points":
      return (
        <div className="adp-ai-result-keypoints">
          {payload.points.map((point) => (
            <p key={point.id}>{point.plain_text}</p>
          ))}
          <ul>
            {payload.actions.map((action, index) => (
              <li key={index}>{action.text}</li>
            ))}
          </ul>
        </div>
      );
    case "image":
      return <p role="status">{`${payload.image.width} × ${payload.image.height}`}</p>;
    case "transcript":
      return <p role="status">{t("speech.transcript")}</p>;
    case "moments":
      return (
        <ul className="adp-ai-result-moments">
          {payload.items.map((moment) => (
            <li key={moment.id}>{moment.label}</li>
          ))}
        </ul>
      );
    case "comparison":
      return (
        <ul className="adp-ai-result-comparison">
          {payload.points.map((point, index) => (
            <li key={index}>
              <p>{point.left_text}</p>
              <p>{point.right_text}</p>
            </li>
          ))}
        </ul>
      );
    case "folder_summary":
      return (
        <div className="adp-ai-result-folder">
          {payload.names_only ? <p role="status">{t("aiActions.namesOnly")}</p> : null}
          {payload.partial ? <p role="status">{t("aiActions.partial")}</p> : null}
          {payload.blocks.map((block) => (
            <p key={block.id}>{block.plain_text}</p>
          ))}
        </div>
      );
    default:
      return null;
  }
}
