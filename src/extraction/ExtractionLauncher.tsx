import { Scan } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssistantOutboundConsentHost } from "../assistant/AssistantOutboundConsentHost";
import type { AssistantOutboundPreview } from "../assistant/types";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import IconButton from "../components/IconButton";
import {
  extractSources,
  guardExtractionStart,
  prepareExtraction,
  requiresOutboundConsent,
} from "../services/aiExtraction";
import {
  MAX_EXTRACTION_INPUTS,
  type ExtractionKind,
  type ExtractionPreparedRequest,
  type ExtractionRequest,
  type ExtractionReview,
} from "../services/aiExtractionTypes";
import { errorCode } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import { extractionAvailability, type ExtractionAvailability } from "./extractionAvailability";
import { registerExtractionAiAssets } from "./extractionAiRegistration";
import ExtractionReviewHost from "./ExtractionReviewHost";
import {
  leaseCapturedSnapshot,
  leaseDocumentInput,
  leaseFileInput,
  type ExtractionFileItem,
  type ExtractionInputLease,
} from "./extractionInputs";
import type { ExportSnapshot } from "../services/exportSnapshots";

/** The one extraction launcher for the Explorer and a FileTab (Step 17d).
 *
 * It starts only when the provider gate passes; preparation is local, an API
 * send needs the one-shot outbound review and a local send needs none. The
 * review itself is the FileTab child `ExtractionReviewPane` (or an overlay
 * when the Explorer hosts it), and export is wired to `publishExtraction`.
 */

export interface ExtractionLauncherProps {
  items: readonly ExtractionFileItem[];
  /** The open 09a document behind a single file tab, when there is one. */
  documentId?: string | null;
  captureSnapshot?: () => Promise<ExportSnapshot>;
  ocrLanguage?: string;
  onOpenHelp: (slug: string) => void;
  onNotify?: (message: string) => void;
  /** FileTab host: show the review in the tab body. */
  onOpenReview?: (reviewId: string) => void;
  /** The Explorer host opens the published output in a new tab. */
  onOpenFile?: (path: string) => Promise<void>;
  disabled?: boolean;
  trigger?: "icon" | "button";
}

type Stage = "menu" | "preparing" | "sending" | "running";

interface PendingApi {
  request: ExtractionRequest;
  prepared: ExtractionPreparedRequest;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.length > 0 ? stem : "review";
}

function availabilityKey(reason: ExtractionAvailability["reason"]): string {
  if (reason === "disabled") return "errors.ai.disabled";
  if (reason === "api_unavailable") return "errors.assistant.api_unavailable";
  return "errors.ai.pack_missing";
}

function failureText(t: TFunction, reason: unknown): string {
  const code = errorCode(reason);
  if (code === "ai_extract.unavailable") return t("errors.ai.pack_missing");
  if (code.startsWith("assistant.")) {
    const suffix = code.slice("assistant.".length);
    const translated = t(`errors.assistant.${suffix}`, { defaultValue: "" });
    return translated || t("errors.assistant.failed");
  }
  if (code.startsWith("ai_extract.")) {
    const suffix = code.slice("ai_extract.".length);
    const translated = t(`errors.ai_extract.${suffix}`, { defaultValue: "" });
    return translated || t("errors.ai_extract.failed");
  }
  return t("errors.ai_extract.failed");
}

export default function ExtractionLauncher({
  items,
  documentId = null,
  captureSnapshot,
  ocrLanguage,
  onOpenHelp,
  onNotify,
  onOpenReview,
  onOpenFile,
  disabled = false,
  trigger = "icon",
}: ExtractionLauncherProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("menu");
  const [availability, setAvailability] = useState<ExtractionAvailability | null>(null);
  const [preview, setPreview] = useState<AssistantOutboundPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localReviewId, setLocalReviewId] = useState<string | null>(null);
  const held = useRef<ExtractionInputLease[]>([]);
  const pendingApi = useRef<PendingApi | null>(null);
  const job = useRef<JobHandle<ExtractionReview> | null>(null);
  const runId = useRef(0);

  const busy = stage === "preparing" || stage === "sending" || stage === "running";

  useEffect(() => {
    return () => {
      runId.current += 1;
      const running = job.current;
      job.current = null;
      if (running) void running.cancel();
      const leases = held.current;
      held.current = [];
      for (const lease of leases) void lease.release();
    };
  }, []);

  const releaseHeld = () => {
    const leases = held.current;
    held.current = [];
    for (const lease of leases) void lease.release();
  };

  const fail = (reason: unknown) => {
    setError(failureText(t, reason));
    setOpen(true);
    setStage("menu");
  };

  const openMenu = () => {
    if (disabled) return;
    try {
      registerExtractionAiAssets();
    } catch {
      // A duplicate registration is harmless; the native registry is the
      // authority and validates the same IDs independently.
    }
    setOpen(true);
    setStage("menu");
    setError(null);
    setAvailability(null);
    void extractionAvailability()
      .then((next) => setAvailability(next))
      .catch(() =>
        setAvailability({ available: false, backend: "local", reason: "disabled" }),
      );
  };

  const closeAll = () => {
    if (busy) return;
    pendingApi.current = null;
    setPreview(null);
    setOpen(false);
    setStage("menu");
    releaseHeld();
  };

  const run = async (
    request: ExtractionRequest,
    prepared: ExtractionPreparedRequest,
    consentId: string | null,
    id: number,
  ) => {
    setStage("running");
    setError(null);
    try {
      const started = await extractSources(request, prepared.id, consentId);
      if (id !== runId.current) {
        void started.cancel();
        return;
      }
      job.current = started;
      const review = await started.completion;
      if (id !== runId.current) return;
      job.current = null;
      releaseHeld();
      setOpen(false);
      setStage("menu");
      if (onOpenReview) {
        onOpenReview(review.id);
      } else {
        setLocalReviewId(review.id);
      }
      onNotify?.(
        t("aiExtract.partial", {
          done: review.sources.length,
          failed: review.warnings.length,
        }),
      );
    } catch (reason) {
      if (id !== runId.current) return;
      job.current = null;
      releaseHeld();
      fail(reason);
    }
  };

  const start = async (kind: ExtractionKind) => {
    if (busy || !availability?.available) return;
    const id = ++runId.current;
    setStage("preparing");
    setError(null);
    try {
      if (items.length < 1 || items.length > MAX_EXTRACTION_INPUTS) {
        throw new Error("ai_extract.invalid");
      }
      const leases: ExtractionInputLease[] = [];
      held.current = leases;
      if (items.length === 1 && documentId && captureSnapshot) {
        leases.push(await leaseCapturedSnapshot(await captureSnapshot()));
      } else if (items.length === 1 && documentId) {
        leases.push(await leaseDocumentInput(documentId));
      } else {
        for (const item of items) leases.push(await leaseFileInput(item));
      }
      if (id !== runId.current) {
        releaseHeld();
        return;
      }
      const request: ExtractionRequest = {
        inputs: leases.map((lease) => lease.input),
        kind,
        locale: i18n.language.startsWith("es") ? "es" : "en",
        ocr_language: ocrLanguage && ocrLanguage !== "" ? ocrLanguage : "auto",
        request_revision: 1,
      };
      const prepared = await prepareExtraction(request);
      if (id !== runId.current) {
        releaseHeld();
        return;
      }
      const guard = guardExtractionStart(prepared, null, {});
      if (!guard.ok && guard.error !== "assistant.outbound_required") {
        throw new Error(guard.error ?? "ai_extract.unsupported");
      }
      if (requiresOutboundConsent(prepared)) {
        pendingApi.current = { request, prepared };
        setOpen(false);
        setPreview(prepared.outbound_preview);
        setStage("sending");
        return;
      }
      await run(request, prepared, null, id);
    } catch (reason) {
      if (id !== runId.current) return;
      releaseHeld();
      fail(reason);
    }
  };

  const sendOutbound = (consentId: string) => {
    const pendingValue = pendingApi.current;
    if (!pendingValue) return;
    const id = runId.current;
    pendingApi.current = null;
    setPreview(null);
    void run(pendingValue.request, pendingValue.prepared, consentId, id);
  };

  const outboundFailed = (key: string) => {
    pendingApi.current = null;
    setPreview(null);
    releaseHeld();
    setError(t(key));
    setOpen(true);
    setStage("menu");
  };

  const cancel = () => {
    runId.current += 1;
    const running = job.current;
    job.current = null;
    if (running) void running.cancel();
    pendingApi.current = null;
    setPreview(null);
    releaseHeld();
    setOpen(true);
    setStage("menu");
  };

  const ready = availability?.available === true && items.length >= 1 && items.length <= MAX_EXTRACTION_INPUTS;
  const menuError = availability && !availability.available ? t(availabilityKey(availability.reason)) : null;
  const defaultName = stemOf(items[0]?.name ?? "review");

  return (
    <>
      {trigger === "icon" ? (
        <IconButton
          icon={Scan}
          labelKey="aiExtract.review"
          onClick={openMenu}
          disabled={disabled || items.length === 0 || localReviewId !== null}
        />
      ) : (
        <Button
          variant="subtle"
          onClick={openMenu}
          disabled={disabled || items.length === 0 || localReviewId !== null}
          aria-label={t("aiExtract.review")}
        >
          <Scan size={16} aria-hidden="true" />
          {t("aiExtract.review")}
        </Button>
      )}

      {open ? (
        <Dialog title={t("aiExtract.review")} onClose={closeAll}>
          {availability === null ? (
            <p role="status">{t("aiExtract.progress", { page: 1, total: 1 })}</p>
          ) : menuError ? (
            <p className="adp-extraction-warning" role="status">
              {menuError}
            </p>
          ) : null}
          <div className="adp-dialog-actions adp-extraction-menu-actions">
            <Button variant="primary" disabled={!ready || busy} onClick={() => void start("document")}>
              {t("aiExtract.document")}
            </Button>
            <Button disabled={!ready || busy} onClick={() => void start("tables")}>
              {t("aiExtract.tables")}
            </Button>
            <Button disabled={!ready || busy} onClick={() => void start("receipts")}>
              {t("aiExtract.receipts")}
            </Button>
            {busy ? <Button onClick={cancel}>{t("aiExtract.cancel")}</Button> : null}
          </div>
          {busy ? (
            <p role="status">
              {t("aiExtract.progress", {
                page: 1,
                total: Math.max(1, items.length),
              })}
            </p>
          ) : null}
          {error ? (
            <p className="adp-extraction-warning" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      {preview ? (
        <AssistantOutboundConsentHost
          key={preview.preview_id}
          preview={preview}
          onConsent={sendOutbound}
          onCancel={cancel}
          onError={outboundFailed}
        />
      ) : null}

      {localReviewId ? (
        <div
          className="adp-extraction-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("aiExtract.review")}
        >
          <ExtractionReviewHost
            reviewId={localReviewId}
            defaultName={defaultName}
            onClose={() => setLocalReviewId(null)}
            onOpenHelp={onOpenHelp}
            onOpenFile={onOpenFile}
            onNotify={onNotify}
          />
        </div>
      ) : null}
    </>
  );
}

/** The file kinds an extraction action may start from a FileTab. */
export function isExtractionSource(handlerId: string | undefined): boolean {
  return handlerId === "pdf" || handlerId === "image" || handlerId === "image-project";
}
