import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import Button from "../components/Button";
import { errorText } from "../services/errors";
import { archivePickFolder } from "../services/archive";
import type { ConversionInput, MetadataCategory } from "../convert/types";
import {
  cleanPrivacy,
  effectivePrivacyCategories,
  inspectPrivacy,
  privacyInspectionPage,
  releasePrivacy,
  supportedPrivacyCategories,
  type PrivacyClosure,
  type PrivacyInspection,
  type PrivacyResult,
  type PrivacyField,
} from "../services/privacy";
import PrivacyFields from "./PrivacyFields";

export interface PrivacyDialogProps {
  inputs: readonly ConversionInput[];
  onClose: () => void;
  onCompleted: (result: PrivacyResult) => void;
  onOpenHelp: (slug: string) => void;
  initiallyselectedcategories?: readonly MetadataCategory[];
}

function parentFolder(path: string): string {
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index > 2 ? normalized.slice(0, index) : normalized.slice(0, 3);
}

function initialDestination(inputs: readonly ConversionInput[]): string {
  const paths = inputs
    .filter((input): input is Extract<ConversionInput, { kind: "file" }> => input.kind === "file")
    .map((input) => parentFolder(input.path));
  if (paths.length === 0) return "";
  return paths.every((path) => path.toLowerCase() === paths[0].toLowerCase()) ? paths[0] : "";
}

function categoryLabel(t: TFunction, category: MetadataCategory): string {
  return t(`privacy.${category}`);
}

function fieldFormat(field: PrivacyField): "image" | "pdf" {
  return field.containers.some(
    (container) => container === "pdf_info" || container === "pdf_structure",
  )
    ? "pdf"
    : "image";
}

/** Only categories the input's own adapter can actually remove are offered. */
function displayedFields(inspections: readonly PrivacyInspection[]): PrivacyField[] {
  return inspections
    .flatMap((inspection) => inspection.fields)
    .filter((field) =>
      supportedPrivacyCategories(fieldFormat(field)).includes(field.category),
    );
}

function selectable(fields: readonly PrivacyField[], category: MetadataCategory): boolean {
  const matching = fields.filter((field) => field.category === category);
  if (!matching.some((field) => field.coverage === "unknown")) return true;
  // Whole-container removal can still prove unknown bytes are gone.
  return category === "exif" || category === "xmp" || category === "iptc";
}

/** A page can repeat one inspection ID when its fields span several pages. */
function mergeInspections(items: readonly PrivacyInspection[]): PrivacyInspection[] {
  const order: string[] = [];
  const byId = new Map<string, PrivacyInspection>();
  for (const item of items) {
    const existing = byId.get(item.inspection_id);
    if (existing) {
      existing.fields = [...existing.fields, ...item.fields];
      existing.complete = item.complete;
    } else {
      byId.set(item.inspection_id, { ...item, fields: [...item.fields] });
      order.push(item.inspection_id);
    }
  }
  return order.map((id) => byId.get(id)!);
}

export default function PrivacyDialog({
  inputs,
  onClose,
  onCompleted,
  onOpenHelp,
  initiallyselectedcategories,
}: PrivacyDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const jobRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const inspectionsRef = useRef<PrivacyInspection[]>([]);
  const [inspections, setInspections] = useState<PrivacyInspection[]>([]);
  const [selected, setSelected] = useState<MetadataCategory[]>([
    ...new Set(initiallyselectedcategories ?? []),
  ]);
  const [closure, setClosure] = useState<PrivacyClosure | null>(null);
  const [ackContent, setAckContent] = useState(false);
  const [ackAppearance, setAckAppearance] = useState(false);
  const [ackSignature, setAckSignature] = useState(false);
  const [destination, setDestination] = useState(initialDestination(inputs));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<PrivacyResult | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const job = await inspectPrivacy(inputs, []);
        jobRef.current = job;
        const first = await job.completion;
        let page = first;
        const all = [...first.items];
        while (page.next_cursor) {
          page = await privacyInspectionPage(page.next_cursor);
          all.push(...page.items);
        }
        if (!alive) return;
        const merged = mergeInspections(all);
        inspectionsRef.current = merged;
        setInspections(merged);
        const fields = displayedFields(merged);
        const detected = new Set<MetadataCategory>();
        for (const field of fields) detected.add(field.category);
        setSelected((current) =>
          current.filter(
            (category) => detected.has(category) && selectable(fields, category),
          ),
        );
      } catch (caught) {
        if (alive) setError(errorText(t, caught, "privacy"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      void jobRef.current?.cancel();
      for (const inspection of inspectionsRef.current) {
        void releasePrivacy(inspection.inspection_id);
      }
    };
    // The dialog owns one inspection batch for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (inspections.length === 0 || selected.length === 0) {
      setClosure(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const next = await effectivePrivacyCategories(
          inspections.map((inspection) => inspection.inspection_id),
          selected,
        );
        if (alive) setClosure(next);
      } catch (caught) {
        if (alive) {
          setClosure(null);
          setError(errorText(t, caught, "privacy"));
        }
      }
    })();
    setAckContent(false);
    setAckAppearance(false);
    setAckSignature(false);
    return () => {
      alive = false;
    };
  }, [inspections, selected, t]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>("input, button, select, [tabindex]");
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...node.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )];
      if (focusable.length === 0) return;
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLElement);
      if (event.shiftKey && (index <= 0 || current === node)) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (category: MetadataCategory, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, category] : current.filter((value) => value !== category),
    );
    // Any category change invalidates the reviewed closure and every
    // acknowledgement that belonged to it.
    setClosure(null);
    setAckContent(false);
    setAckAppearance(false);
    setAckSignature(false);
    setResult(null);
    setError("");
  };

  const chooseFolder = async () => {
    const chosen = await archivePickFolder(t("convert.chooseFolder"));
    if (chosen) setDestination(chosen);
  };

  const cancelWork = async () => {
    if (!busy) {
      onClose();
      return;
    }
    await jobRef.current?.cancel();
  };

  const canClean =
    !loading &&
    !busy &&
    selected.length > 0 &&
    closure !== null &&
    destination.length > 0 &&
    (!closure.content_affecting || ackContent) &&
    (!closure.appearance_affecting || ackAppearance) &&
    (!closure.signatures_present || ackSignature);

  const clean = async () => {
    if (!closure || !canClean) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const job = await cleanPrivacy({
        inspection_ids: inspections.map((inspection) => inspection.inspection_id),
        categories: selected,
        dest_dir: destination,
        replace: false,
        accepted_content_changes: ackContent,
        accepted_signature_change: ackSignature,
        accepted_appearance_changes: ackAppearance,
        accepted_effective_categories: closure.effective_categories,
        cleaned_suffix: t("privacy.cleanedName", { name: "" }),
      });
      jobRef.current = job;
      const completed = await job.completion;
      setResult(completed);
      const failed = completed.report.items.some(
        (item) => item.status === "failed" || item.status === "skipped",
      );
      const cancelled =
        completed.report.cancelled ||
        completed.report.items.some((item) => item.status === "cancelled");
      const residual = completed.inspections_after.some(
        (count) =>
          closure.effective_categories.includes(count.category) &&
          (count.count > 0 || count.coverage !== "complete"),
      );
      if (failed || residual) {
        // Some copies may exist, so never repeat the "nothing was published"
        // sentence in that case.
        setError(
          completed.report.outputs.length > 0
            ? t("errors.privacy.failed")
            : t("privacy.unverified"),
        );
      } else if (cancelled) {
        setError(t("errors.privacy.cancelled"));
      }
      if (completed.report.outputs.length > 0) onCompleted(completed);
    } catch (caught) {
      setError(errorText(t, caught, "privacy"));
    } finally {
      setBusy(false);
    }
  };

  const fields: PrivacyField[] = displayedFields(inspections);
  const additional =
    closure && closure.effective_categories.some((category) => !selected.includes(category));

  return (
    <div
      className="adp-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={dialogRef} className="adp-dialog adp-privacy" role="dialog" aria-modal="true" aria-label={t("privacy.title")}>
        <div className="adp-dialog-header">
          <span className="adp-dialog-title">{t("privacy.title")}</span>
          <button
            type="button"
            className="adp-icon-btn"
            aria-label={t("components.closeDialog")}
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="adp-dialog-body adp-privacy-body">
          <p className="adp-privacy-scope">{t("privacy.scope")}</p>
          <p className="adp-privacy-select">{t("privacy.select")}</p>
          {loading ? <p className="adp-privacy-note">{t("components.loading")}</p> : null}
          {!loading ? (
            <div className="adp-privacy-columns">
              <section className="adp-privacy-panel" aria-label={t("privacy.before")}>
                <h3>{t("privacy.before")}</h3>
                <PrivacyFields
                  fields={fields}
                  selectedCategories={selected}
                  onToggle={toggle}
                  disabled={busy}
                />
              </section>
              <section className="adp-privacy-panel" aria-label={t("privacy.after")}>
                <h3>{t("privacy.after")}</h3>
                {result ? (
                  <ul className="adp-privacy-results">
                    {result.inspections_after.map((count) => (
                      <li key={count.category}>
                        <span>{categoryLabel(t, count.category)}</span>
                        <span>{count.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="adp-privacy-note">{t("privacy.scope")}</p>
                )}
              </section>
            </div>
          ) : null}

          {closure?.content_affecting ? (
            <label className="adp-privacy-ack">
              <input
                type="checkbox"
                checked={ackContent}
                disabled={busy}
                onChange={(event) => setAckContent(event.target.checked)}
              />
              <span>{t("privacy.contentChange")}</span>
            </label>
          ) : null}
          {closure?.appearance_affecting ? (
            <label className="adp-privacy-ack">
              <input
                type="checkbox"
                checked={ackAppearance}
                disabled={busy}
                onChange={(event) => setAckAppearance(event.target.checked)}
              />
              <span>{t("privacy.appearanceChange")}</span>
            </label>
          ) : null}
          {closure?.signatures_present ? (
            <label className="adp-privacy-ack">
              <input
                type="checkbox"
                checked={ackSignature}
                disabled={busy}
                onChange={(event) => setAckSignature(event.target.checked)}
              />
              <span>{t("privacy.signatureChange")}</span>
            </label>
          ) : null}
          {additional && closure ? (
            <p className="adp-privacy-note">
              {t("privacy.additionalCategories")}{" "}
              {closure.effective_categories
                .filter((category) => !selected.includes(category))
                .map((category) => categoryLabel(t, category))
                .join(", ")}
            </p>
          ) : null}
          {error ? (
            <p className="adp-privacy-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="adp-dialog-footer adp-privacy-footer">
          <div className="adp-privacy-destination">
            <span>{t("convert.destination")}</span>
            <span className="adp-privacy-path">{destination || "—"}</span>
            <Button onClick={() => void chooseFolder()} disabled={busy}>
              {t("convert.chooseFolder")}
            </Button>
          </div>
          <div className="adp-privacy-actions">
            <Button
              aria-label={t("help.title")}
              onClick={() => onOpenHelp("removing-hidden-information")}
              disabled={busy}
            >
              <ShieldCheck size={16} aria-hidden="true" />
            </Button>
            <Button onClick={() => void cancelWork()}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void clean()} disabled={!canClean}>
              {t("privacy.cleanCopy")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
