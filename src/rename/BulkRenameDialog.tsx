import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import Button from "../components/Button";
import Skeleton from "../components/Skeleton";
import HelpButton from "../components/HelpButton";
import { errorText } from "../services/errors";
import type { JobHandle } from "../services/jobs";
import { executeRename, previewRename, releaseRenamePlan, renamePreviewPage, renameReportPage, listRenamePresets, writeRenamePreset, removeRenamePreset, type RenameOperation, type RenamePlanPage, type RenamePreviewRow, type RenameReport, type RenameEffect, type RenamePreset } from "../services/bulkRename";
import { presetForStorage } from "../services/renamePresets";
import type { AiNameSuggestion, AiNamingPattern } from "../services/aiSearchTypes";
import AiNameReview from "./AiNameReview";
import RenameOperations from "./RenameOperations";
import RenamePreview from "./RenamePreview";

export interface BulkRenameDialogProps {
  paths: readonly string[];
  onClose: () => void;
  onCompleted: (report: RenameReport) => void;
  onOpenHelp: (slug: string) => void;
  /** Step 17c: reviewed AI stems replace the ordinary editor until closed. */
  aiReview?: {
    suggestions: readonly AiNameSuggestion[];
    pattern: AiNamingPattern;
  } | null;
  /** False while the native handle adapter and receipt replay (T3/T4) are
   * missing: preview and presets stay usable, Rename is disabled. */
  executeAvailable?: boolean;
}

export default function BulkRenameDialog({ paths, onClose, onCompleted, onOpenHelp, executeAvailable = true, aiReview = null }: BulkRenameDialogProps) {
  const { t } = useTranslation();
  const [operations, setOperations] = useState<RenameOperation[]>([{ kind: "prefix", text: "" }]);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [includeExtension, setIncludeExtension] = useState(false);
  const [dateZone, setDateZone] = useState<"utc" | "local">("utc");
  const [presets, setPresets] = useState<RenamePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetName, setPresetName] = useState("");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [removePresetOpen, setRemovePresetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetError, setPresetError] = useState<unknown>(null);
  const [plan, setPlan] = useState<RenamePlanPage | null>(null);
  const [planKey, setPlanKey] = useState("");
  const [rows, setRows] = useState<RenamePreviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<RenameReport | null>(null);
  const [effects, setEffects] = useState<RenameEffect[]>([]);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const running = useRef<JobHandle<RenameReport> | null>(null);
  const submitting = useRef(false);
  const countValid = paths.length > 0 && paths.length <= 1000;
  const requestKey = JSON.stringify({ paths, operations, include_extension: includeExtension, excluded_indices: excluded, date_zone: dateZone });
  const stale = loading || requestKey !== planKey;
  // The host passes false until the native handle adapter and receipt
  // replay exist; the dialog still previews and reads/saves presets.
  const executeUnavailable = !executeAvailable;
  const canRun = countValid && !busy && !report && !stale && !executeUnavailable && !!plan?.all_rows_valid && plan.ready > 0 && rows.length === plan.total;
  const chosenPreset = presets.find(preset => preset.id === selectedPreset) ?? null;

  const close = useCallback(() => {
    if (submitting.current) setConfirmCancel(true);
    else onClose();
  }, [onClose]);

  useEffect(() => {
    mounted.current = true;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = content.current?.closest<HTMLElement>("[role=dialog]");
    dialog?.querySelector<HTMLElement>("input,button,select")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex='0']")].filter(el => !el.closest("fieldset:disabled") && !el.hidden);
      const first = controls[0], last = controls[controls.length - 1];
      if (first && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      mounted.current = false;
      document.removeEventListener("keydown", trap);
      void running.current?.cancel();
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void listRenamePresets().then(c => { if (alive) { setPresets(c.presets); setCatalogRevision(c.revision); setPresetsLoaded(true); } }).catch(e => { if (alive) setPresetError(e); });
    return () => { alive = false; };
  }, []);

  const savePreset = async () => {
    if (saving || busy || !presetsLoaded) return;
    setSaving(true); setPresetError(null);
    try {
      const preset = presetForStorage({
        id: crypto.randomUUID(),
        name: presetName.trim(),
        operations,
        include_extension: includeExtension,
        date_zone: dateZone,
        version: 1,
      });
      const next = await writeRenamePreset(preset, catalogRevision);
      setPresets(next.presets); setCatalogRevision(next.revision);
      setSelectedPreset(preset.id); setPresetName(""); setSavePresetOpen(false);
    } catch (e) { setPresetError(e); }
    finally { setSaving(false); }
  };
  const removePreset = async () => {
    if (!chosenPreset || saving || busy) return;
    setSaving(true); setPresetError(null);
    try {
      const next = await removeRenamePreset(chosenPreset.id, catalogRevision);
      setPresets(next.presets); setCatalogRevision(next.revision);
      setSelectedPreset(""); setRemovePresetOpen(false);
    } catch (e) { setPresetError(e); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    const revision = ++generation.current;
    let disposed = false;
    let handle: JobHandle<RenamePlanPage> | null = null;
    let planId: string | null = null;
    setLoading(true);
    const release = () => { if (planId) void releaseRenamePlan(planId).catch(() => undefined); };
    const timer = window.setTimeout(() => {
      if (!countValid) { setError("rename.too_large"); setLoading(false); return; }
      void (async () => {
        try {
          handle = await previewRename({ ...JSON.parse(requestKey), request_revision: revision });
          if (disposed) await handle.cancel();
          const first = await handle.completion;
          planId = first.plan_id;
          if (disposed || generation.current !== revision || first.request_revision !== revision) { release(); return; }
          const allRows = [...first.rows];
          let cursor = first.next_cursor;
          while (cursor) {
            const page = await renamePreviewPage(cursor);
            if (disposed || generation.current !== revision) { release(); return; }
            if (page.plan_id !== planId || page.request_revision !== revision || page.total !== first.total) throw new Error("rename.changed");
            allRows.push(...page.rows);
            if (allRows.length > 1000 || page.rows.length === 0) throw new Error("rename.too_large");
            cursor = page.next_cursor;
          }
          if (new Set(allRows.map(r => r.input_index)).size !== allRows.length || allRows.length !== first.total) throw new Error("rename.changed");
          setPlan(first); setRows(allRows); setPlanKey(requestKey); setError(null); setLoading(false);
        } catch (e) {
          if (!disposed && generation.current === revision) { setError(e); setLoading(false); }
        }
      })();
    }, 150);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      void handle?.cancel();
      release();
    };
  }, [requestKey, countValid, refreshRevision]);

  const run = async () => {
    if (!canRun || !plan || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      running.current = await executeRename(plan.plan_id, plan.request_revision);
      if (!mounted.current) await running.current.cancel();
      const first = await running.current.completion;
      if (!mounted.current) return;
      setReport(first); setEffects(first.effects); setReportCursor(first.next_cursor ?? null);
      onCompleted(first);
    } catch (e) { if (mounted.current) { setError(e); setPlanKey(""); } }
    finally { submitting.current = false; running.current = null; if (mounted.current) { setBusy(false); setConfirmCancel(false); } }
  };
  const loadReport = async () => {
    if (!reportCursor || paging) return;
    setPaging(true);
    try {
      const page = await renameReportPage(reportCursor);
      if (!mounted.current) return;
      if (page.receipt_id !== report?.receipt_id) throw new Error("rename.changed");
      if (effects.length + page.effects.length > 1000 || page.effects.length === 0 && page.next_cursor) throw new Error("rename.too_large");
      setEffects(old => [...old, ...page.effects]); setReportCursor(page.next_cursor ?? null);
    } catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setPaging(false); }
  };
  if (aiReview) {
    return <Dialog title={t("rename.title")} onClose={onClose} className="adp-rename-dialog">
      <AiNameReview
        suggestions={aiReview.suggestions}
        pattern={aiReview.pattern}
        onClose={onClose}
        onCompleted={(report) => {
          onCompleted(report);
          onClose();
        }}
        onOpenHelp={onOpenHelp}
        executeAvailable={executeAvailable}
      />
    </Dialog>;
  }
  return <Dialog title={t("rename.title")} onClose={close} className="adp-rename-dialog">
    <div ref={content}>
      {error !== null && <p role="alert">{errorText(t, error, "rename")}</p>}
      {error !== null && !report && <Button disabled={busy} onClick={() => { setPlanKey(""); setRefreshRevision(old => old + 1); }}>{t("rename.refreshPreview")}</Button>}
      {!countValid && <p role="alert">{t("errors.rename.too_large")}</p>}
      {!report && <>
        <label>{t("rename.preset")}<select disabled={busy || saving || !presetsLoaded} value={chosenPreset ? selectedPreset : ""} onChange={e => {
          setSelectedPreset(e.target.value);
          const preset = presets.find(p => p.id === e.target.value);
          if (preset) { setOperations(preset.operations); setIncludeExtension(preset.include_extension); setDateZone(preset.date_zone); }
        }}><option value="">{t("rename.preset")}</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <Button disabled={busy || saving || !presetsLoaded || operations.length < 1 || operations.length > 32} onClick={() => { setPresetName(""); setSavePresetOpen(true); }}>{t("rename.savePreset")}</Button>
        <Button disabled={busy || saving || !presetsLoaded || !chosenPreset} onClick={() => setRemovePresetOpen(true)}>{t("rename.removePreset")}</Button>
        {presetError !== null && <p role="alert">{errorText(t, presetError, "rename")}</p>}
        {savePresetOpen && <div role="group" aria-label={t("rename.savePreset")} className="adp-rename-preset-editor">
          <label>{t("rename.preset")}<input autoFocus value={presetName} maxLength={60} disabled={saving} onChange={e => setPresetName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && presetName.trim()) void savePreset(); }} /></label>
          <Button disabled={saving || !presetName.trim()} onClick={() => void savePreset()}>{t("common.save")}</Button>
          <Button disabled={saving} onClick={() => setSavePresetOpen(false)}>{t("common.cancel")}</Button>
        </div>}
        {removePresetOpen && chosenPreset && <div role="alert" className="adp-rename-preset-editor">
          <p>{chosenPreset.name}</p>
          <Button disabled={saving} onClick={() => void removePreset()}>{t("rename.removePreset")}</Button>
          <Button disabled={saving} onClick={() => setRemovePresetOpen(false)}>{t("common.cancel")}</Button>
        </div>}
        <label><input type="checkbox" disabled={busy || saving} checked={includeExtension} onChange={e => setIncludeExtension(e.target.checked)} />{t("rename.includeExtension")}</label>
        <label>{t("rename.dateZone")}<select disabled={busy || saving} value={dateZone} onChange={e => setDateZone(e.target.value as "utc" | "local")}><option value="utc">{t("rename.utc")}</option><option value="local">{t("rename.local")}</option></select></label>
        <div className="adp-rename-layout">
          <RenameOperations value={operations} onChange={setOperations} disabled={busy || saving} />
          <div>{loading && <p role="status">{t("rename.previewing")}</p>}{loading && rows.length === 0 ? <Skeleton /> : <RenamePreview rows={rows} excluded={excluded} disabled={busy} stale={stale} onExclude={(index, exclude) => setExcluded(old => exclude ? [...new Set([...old, index])] : old.filter(i => i !== index))} />}</div>
        </div>
        {plan && <p aria-live="polite">{t("rename.previewSummary", { total: plan.total, ready: plan.ready, invalid: plan.invalid, conflicts: plan.conflicts })}</p>}
      </>}
      {report && <>
        <p role="status">{t("rename.summary", { ...report })}</p>
        {report.recovery_required && <p role="alert">{t("rename.recovery")}</p>}
        <ul className="adp-rename-results">{effects.map((e, index) => <li key={index}><span>{e.original_path}</span><span>{e.current_path}</span>{e.reason && <span>{errorText(t, e.reason, "rename")}</span>}</li>)}</ul>
        {reportCursor && <Button disabled={paging} onClick={() => void loadReport()}>{t("common.loadMore")}</Button>}
      </>}
      {confirmCancel && <div role="alert"><p>{t("rename.cancelRunning")}</p><Button onClick={() => { void running.current?.cancel(); setConfirmCancel(false); }}>{t("rename.cancelJob")}</Button><Button onClick={() => setConfirmCancel(false)}>{t("rename.keepRunning")}</Button></div>}
      <div className="adp-dialog-actions">
        <HelpButton onOpenHelp={() => onOpenHelp("bulk-rename")} />
        <Button onClick={close}>{t(report ? "common.close" : "common.cancel")}</Button>
        {!report && <Button variant="primary" disabled={!canRun} onClick={() => void run()}>{t("rename.action")}</Button>}
      </div>
    </div>
  </Dialog>;
}
