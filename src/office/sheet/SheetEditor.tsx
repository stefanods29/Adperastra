import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../components/Skeleton";
import { CommandRegistry } from "../../commands/registry";
import type { VirtualViewProps } from "../../documents/types";
import Ribbon from "../../ribbon/Ribbon";
import ViewerFrame from "../../ribbon/ViewerFrame";
import { errorText } from "../../services/errors";
import { TransferRegistry } from "../../transfer/TransferRegistry";
import type { OfficeController } from "../OfficeController";
import { canOfficeCommand } from "../officeCompatibility";
import { saveOfficeCopy } from "../saveOfficeCopy";
import type {
  CellAddress, CellRange, OfficeCellWindow, OfficeChart, OfficeDisplayCell, OfficeFormatting,
  OfficeSessionState, OfficeSheetItem, SheetOperation,
} from "../types";
import { SheetAiPanel } from "./ai/SheetAiPanel";
import type { SheetAiAction } from "./ai/sheetAiTypes";
import { displayFormula } from "./formulaLocale";
import FormulaBar from "./FormulaBar";
import NameBox from "./NameBox";
import SheetChartDialog from "./SheetChartDialog";
import SheetConditionalDialog from "./SheetConditionalDialog";
import SheetGrid from "./SheetGrid";
import SheetSortFilter from "./SheetSortFilter";
import SheetStructureDialogs from "./SheetStructureDialogs";
import SheetTabs from "./SheetTabs";
import SheetValidationDialog from "./SheetValidationDialog";
import { acquireSheetController, canEditSheet } from "./sheetController";
import { registerSheetCommands, setSheetHostActions } from "./sheetCommands";
import { sheetRibbon } from "./sheetRibbon";
import { sheetTransferTarget } from "./sheetTransfer";
import type {
  SheetCommandContext, SheetDialogId, SheetEditorProps, SheetEditorViewState,
} from "./sheetUiTypes";
import { clampSheetViewState, normalizeSheetViewState } from "./sheetViewState";
import { loadSheetWindow, SHEET_COLUMN_WIDTH, SHEET_ROW_HEIGHT, sheetVisibleWindow } from "./sheetWindow";
import { useSheetSelection, validSheetAddress } from "./useSheetSelection";

type ConditionalOperation = Extract<SheetOperation, { kind: "set_conditional_rule" }>;
type ValidationOperation = Extract<SheetOperation, { kind: "set_validation" }>;

function cellRange(address: CellAddress): CellRange {
  return {
    sheet_id: address.sheet_id, first_row: address.row, last_row: address.row,
    first_column: address.column, last_column: address.column,
  };
}

function firstCell(sheetId: string): CellAddress {
  return { sheet_id: sheetId, row: 0, column: 0 };
}

function formulaLocale(language: string): "en-US" | "es-419" {
  return language.toLowerCase().startsWith("es") ? "es-419" : "en-US";
}

/** The spreadsheet editor host (Step 21a E1).
 *
 * One source-aware presenter for disk and virtual documents. It mounts the
 * bounded grid, formula bar, name box, sheet tabs and typed dialogs against
 * one canonical OfficeController. Every document change is a typed
 * SheetOperation; the host itself never evaluates a formula, writes a file,
 * exports or generates AI content. When no approved engine exists the
 * existing Step 13 presenter remains the fallback and this host adds nothing.
 */
export default function SheetEditor({
  document,
  active,
  savedState,
  onStateChange,
  onStatus,
  onOpenHelp,
  previewOnly = false,
}: SheetEditorProps) {
  const { t, i18n } = useTranslation();
  const [controller, setController] = useState<OfficeController | null>(null);
  const [state, setState] = useState<OfficeSessionState | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<SheetEditorViewState>(() => normalizeSheetViewState(savedState ?? null));
  const [sheets, setSheets] = useState<OfficeSheetItem[]>([]);
  const [cells, setCells] = useState<OfficeCellWindow | null>(null);
  const [formatting, setFormatting] = useState<OfficeFormatting | null>(null);
  const [dialog, setDialog] = useState<SheetDialogId | null>(null);
  const [editing, setEditing] = useState(false);
  const [editRequest, setEditRequest] = useState<{ initialText?: string }>();
  const [formulaText, setFormulaText] = useState("");
  const [formulaReady, setFormulaReady] = useState(false);
  const [gridSize, setGridSize] = useState({ width: 900, height: 600 });
  const [aiAction, setAiAction] = useState<SheetAiAction | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const restoredScroll = useRef(false);
  const aiReturnFocus = useRef<HTMLElement | null>(null);
  const aiHost = useRef<{
    editing: boolean; selection: SheetEditorViewState["selection"]; activeData: OfficeDisplayCell | null;
  }>({ editing: false, selection: null, activeData: null });

  const locale = formulaLocale(i18n.language);

  useEffect(() => {
    let cancelled = false;
    let acquired: OfficeController | null = null;
    let unsubscribe: () => void = () => undefined;
    setController(null);
    setState(null);
    setFallback(null);
    setError(null);
    setSheets([]);
    setCells(null);
    setAiAction(null);
    aiReturnFocus.current = null;
    void acquireSheetController(document, previewOnly).then((result) => {
      if (cancelled) return;
      if (result.kind === "viewing") {
        setFallback(result.reason_key);
        return;
      }
      acquired = result.controller;
      setController(result.controller);
      setState(result.controller.getState());
      unsubscribe = result.controller.subscribe(setState);
    }).catch((caught) => { if (!cancelled) setError(caught); });
    return () => {
      cancelled = true;
      unsubscribe();
      if (acquired) void acquired.close();
    };
  }, [document.id, previewOnly]);

  useEffect(() => {
    if (!controller) return;
    // One target per document: a second view of the same document shares the
    // already registered target instead of failing the whole editor mount.
    try {
      return TransferRegistry.register(sheetTransferTarget(controller));
    } catch {
      return undefined;
    }
  }, [controller]);

  // One engine-neutral item enumeration; never a second parser or catalogue.
  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    void (async () => {
      const all: OfficeSheetItem[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 8; page += 1) {
        const result = await controller.items("sheets", cursor);
        all.push(...(result.items as OfficeSheetItem[]));
        if (result.complete || !result.next_cursor) break;
        cursor = result.next_cursor;
      }
      if (cancelled) return;
      all.sort((a, b) => a.index - b.index);
      setSheets(all);
      setView((previous) => clampSheetViewState(previous, all));
    })().catch((caught) => { if (!cancelled) setError(caught); });
    return () => { cancelled = true; };
  }, [controller, state?.sheet_count]);

  const sheet = sheets.find((item) => item.id === view.active_sheet_id && !item.hidden) ??
    sheets.find((item) => !item.hidden) ?? null;

  useEffect(() => {
    if (!sheet) return;
    const current = view.selection;
    const valid = !!current && current.active.sheet_id === sheet.id &&
      validSheetAddress(current.active, sheet.rows, sheet.columns) &&
      current.ranges.every((range) => range.sheet_id === sheet.id &&
        range.first_row >= 0 && range.first_column >= 0 &&
        range.last_row >= range.first_row && range.last_column >= range.first_column &&
        range.last_row < sheet.rows && range.last_column < sheet.columns);
    if (view.active_sheet_id === sheet.id && valid) return;
    setView((previous) => {
      if (previous.active_sheet_id !== sheet.id) {
        return {
          ...previous, active_sheet_id: sheet.id, freeze: null,
          selection: { kind: "sheet", active: firstCell(sheet.id), ranges: [cellRange(firstCell(sheet.id))] },
          viewport: { ...previous.viewport, x_px: 0, y_px: 0 },
        };
      }
      return {
        ...previous,
        selection: { kind: "sheet", active: firstCell(sheet.id), ranges: [cellRange(firstCell(sheet.id))] },
      };
    });
  }, [sheet, view.active_sheet_id, view.selection]);

  useEffect(() => {
    onStateChange(view);
  }, [view, onStateChange]);

  useEffect(() => {
    if (!controller || !view.selection) {
      setFormatting(null);
      return;
    }
    let cancelled = false;
    void controller.formatting(view.selection).then((answer) => {
      if (!cancelled) setFormatting(answer);
    }).catch(() => {
      if (!cancelled) setFormatting(null);
    });
    return () => { cancelled = true; };
  }, [controller, state?.revision, view.selection]);

  const visibleRange = useMemo(() => {
    if (!sheet) return null;
    return sheetVisibleWindow(
      sheet.id, sheet.rows, sheet.columns,
      view.viewport.x_px, view.viewport.y_px,
      Math.max(1, gridSize.width), Math.max(1, gridSize.height), view.zoom,
    );
  }, [sheet, view.viewport.x_px, view.viewport.y_px, view.zoom, gridSize.width, gridSize.height]);

  useEffect(() => {
    if (!controller || !state || !visibleRange) {
      setCells(null);
      return;
    }
    let current = true;
    const revision = state.revision;
    const timer = window.setTimeout(() => {
      void loadSheetWindow(controller.session_id, visibleRange, revision, () => current)
        .then((answer) => { if (current) { setCells(answer); setError(null); } })
        .catch((caught) => { if (current) setError(caught); });
    }, 40);
    return () => { current = false; window.clearTimeout(timer); };
  }, [controller, state?.revision, visibleRange]);

  // The host wrapper measures the viewport; the grid never uploads whole rows.
  useEffect(() => {
    const element = hostRef.current?.querySelector(".adp-sheet-grid");
    if (!(element instanceof HTMLElement)) return;
    const measure = () => setGridSize((previous) => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      return previous.width === width && previous.height === height ? previous : { width, height };
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [controller, active]);

  // A saved viewport restores the DOM scroll once; later scrolls own it.
  useEffect(() => {
    if (!controller) {
      restoredScroll.current = false;
      return;
    }
    if (restoredScroll.current) return;
    const element = hostRef.current?.querySelector(".adp-sheet-grid");
    if (!(element instanceof HTMLElement)) return;
    restoredScroll.current = true;
    element.scrollLeft = Math.max(0, view.viewport.x_px);
    element.scrollTop = Math.max(0, view.viewport.y_px);
  }, [controller, view.viewport.x_px, view.viewport.y_px]);

  const activeCell = view.selection?.active ?? null;
  const activeData: OfficeDisplayCell | null = activeCell && cells && cells.revision === state?.revision &&
      cells.range.sheet_id === activeCell.sheet_id
    ? cells.rows.flat().find((cell) => cell.address.row === activeCell.row && cell.address.column === activeCell.column) ?? null
    : null;

  aiHost.current = { editing, selection: view.selection, activeData };

  // AI opens only for one reviewed range and never while the 21a formula
  // buffer owns the keyboard. Explain additionally needs a formula cell.
  const canOpenAi = (action: SheetAiAction): boolean => {
    const current = aiHost.current;
    if (current.editing || !current.selection || current.selection.ranges.length !== 1) return false;
    if (action === "explain") return current.activeData?.input.kind === "formula";
    return true;
  };

  const openAi = (action: SheetAiAction) => {
    if (!canOpenAi(action)) return;
    aiReturnFocus.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    setAiAction(action);
  };

  // The panel restores its own captured element; this fallback keeps focus on
  // the ribbon opener even when the panel was replaced by another action.
  const closeAi = () => {
    setAiAction(null);
    const target = aiReturnFocus.current;
    aiReturnFocus.current = null;
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
      else {
        const grid = hostRef.current?.querySelector(".adp-sheet-grid");
        if (grid instanceof HTMLElement) grid.focus();
      }
    }, 0);
  };

  // Keyboard and name-box navigation move the active cell; the grid follows
  // it without a second scroll store (the DOM scroll position stays canonical).
  useEffect(() => {
    if (!activeCell || !sheet) return;
    const element = hostRef.current?.querySelector(".adp-sheet-grid");
    if (!(element instanceof HTMLElement)) return;
    const scale = view.zoom / 100;
    const top = activeCell.row * SHEET_ROW_HEIGHT * scale + (view.headings ? 26 : 0);
    const left = activeCell.column * SHEET_COLUMN_WIDTH * scale + (view.headings ? 44 : 0);
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + SHEET_ROW_HEIGHT * scale > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + SHEET_ROW_HEIGHT * scale - element.clientHeight;
    }
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + SHEET_COLUMN_WIDTH * scale > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + SHEET_COLUMN_WIDTH * scale - element.clientWidth;
    }
  }, [activeCell?.sheet_id, activeCell?.row, activeCell?.column, sheet?.id, view.zoom, view.headings]);

  useEffect(() => {
    if (!controller || !activeData) {
      setFormulaText("");
      setFormulaReady(false);
      return;
    }
    const input = activeData.input;
    if (input.kind !== "formula") {
      setFormulaText(input.kind === "text" ? input.text : input.kind === "number" ? String(input.value) : input.kind === "boolean" ? (input.value ? "TRUE" : "FALSE") : input.kind === "date" ? input.iso_date : "");
      setFormulaReady(true);
      return;
    }
    let current = true;
    setFormulaReady(false);
    void displayFormula(controller, input.canonical, locale).then((text) => {
      if (current) { setFormulaText(text); setFormulaReady(true); }
    }).catch(() => {
      // A formula the engine cannot display stays visible as its saved value;
      // the bar refuses to edit it rather than inventing canonical text.
      if (current) { setFormulaText(activeData.display); setFormulaReady(false); }
    });
    return () => { current = false; };
  }, [controller, activeData, locale]);

  const selectCell = useSheetSelection(
    sheet?.id ?? "", sheet?.rows ?? 1, sheet?.columns ?? 1, view.selection,
    (selection) => setView((previous) => ({ ...previous, selection })),
  );

  const canEdit = controller ? canEditSheet(controller, previewOnly) && !document.info.read_only : false;
  const canEditCell = canEdit && activeData?.editable === true;
  const activeRange = activeCell ? cellRange(activeCell) : null;
  const fillRange = view.selection?.ranges.length === 1 ? view.selection.ranges[0] : undefined;

  const registry = useMemo(() => {
    const created = new CommandRegistry<SheetCommandContext>();
    registerSheetCommands(created);
    return created;
  }, []);

  useEffect(() => {
    setSheetHostActions({
      updateView: (patch) => setView((previous) => ({ ...previous, ...patch })),
      openHelp: onOpenHelp,
      notify: (caught) => setError(caught),
      openAi,
      canOpenAi,
    });
    return () => setSheetHostActions(null);
  }, [onOpenHelp]);

  useEffect(() => {
    if (!state || !active) return;
    onStatus({
      items: [
        sheet?.name ?? t("office.sheets"),
        t(`office.${state.mode}`),
        state.dirty ? t("office.unsaved") : t("office.saved"),
      ],
      zoom: {
        percent: view.zoom, min: 25, max: 400,
        set: (percent) => setView((previous) => ({
          ...previous, zoom: percent, viewport: { ...previous.viewport, zoom_percent: percent },
        })),
        fit: () => setView((previous) => ({
          ...previous, zoom: 100, viewport: { ...previous.viewport, zoom_percent: 100 },
        })),
      },
    });
  }, [active, onStatus, sheet?.name, state, t, view.zoom]);

  const baseRange = view.selection?.ranges.length === 1 ? view.selection.ranges[0] : null;

  const conditionalBase = useMemo<ConditionalOperation | null>(() => baseRange ? {
    kind: "set_conditional_rule",
    rule: {
      id: crypto.randomUUID(), range: { ...baseRange }, priority: 1, kind: "compare",
      operator: "equal", values: [{ kind: "number", value: 0 }], colors: [], style: {},
      stop_if_true: false,
    },
  } : null, [baseRange]);

  const validationBase = useMemo<ValidationOperation | null>(() => baseRange ? {
    kind: "set_validation",
    range: { ...baseRange },
    rule: {
      kind: "whole", operator: "equal", values: [], list: [], allow_blank: true,
      title: "", message: "", error_style: "stop",
    },
  } : null, [baseRange]);

  const chartBase = useMemo<OfficeChart | null>(() => baseRange ? {
    id: crypto.randomUUID(), kind: "column",
    source: { kind: "range", range: { ...baseRange }, headers: true },
    title: "", legend: false,
    rect: { x_pt: 0, y_pt: 0, width_pt: 480, height_pt: 300, rotation_deg: 0 },
  } : null, [baseRange]);

  if (fallback) {
    return (
      <section role="status" style={{ display: "grid", gap: 8, justifyItems: "start", padding: 16 }}>
        <p>{t(fallback)}</p>
        <button type="button" className="adp-btn" onClick={() => onOpenHelp("editing-spreadsheets")}>
          {t("help.title")}
        </button>
      </section>
    );
  }
  if (!controller || !state) {
    return error
      ? <p className="adp-sheet-formula" role="alert">{errorText(t, error, "office_edit")}</p>
      : <div className="adp-sheet-grid"><Skeleton variant="rows" count={6} /></div>;
  }

  const commit = (operation: SheetOperation): Promise<void> => controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: state.revision,
    operations: [{ family: "sheet" as const, operation }],
    selection_after: view.selection,
    label_key: "office.transaction",
  }).then(() => { setError(null); });

  const openDialog = (id: SheetDialogId) => setDialog(id);
  const ctx: SheetCommandContext = {
    saveCopy: !active || previewOnly ? undefined : () => {
      if (canOfficeCommand(controller.getState(), "save_copy", false).enabled) {
        void saveOfficeCopy(document, t("office.saveCopy"), t("editor.allFiles")).catch(setError);
      }
    },
    controller, state, selection: view.selection, formatting, view, openDialog,
  };
  const commands = registry.list();

  const onScroll = (x: number, y: number, width: number, height: number) => {
    const size = { width: Math.max(1, width), height: Math.max(1, height) };
    setGridSize((previous) => previous.width === size.width && previous.height === size.height ? previous : size);
    setView((previous) => {
      const viewport = previous.viewport;
      if (viewport.x_px === x && viewport.y_px === y &&
          viewport.width_px === size.width && viewport.height_px === size.height) return previous;
      return {
        ...previous,
        viewport: {
          ...viewport, x_px: Math.max(0, x), y_px: Math.max(0, y),
          width_px: size.width, height_px: size.height, zoom_percent: previous.zoom,
        },
      };
    });
  };

  const moveAfterCommit = (direction: "down" | "right" | null) => {
    if (!direction || !activeCell || !sheet) return;
    const next = {
      ...activeCell,
      row: activeCell.row + (direction === "down" ? 1 : 0),
      column: activeCell.column + (direction === "right" ? 1 : 0),
    };
    if (validSheetAddress(next, sheet.rows, sheet.columns)) selectCell(next, false);
    // Return keyboard focus to the grid after Enter/Tab confirmed a cell.
    window.setTimeout(() => {
      const element = hostRef.current?.querySelector(".adp-sheet-grid");
      if (element instanceof HTMLElement) element.focus();
    }, 0);
  };

  const activateSheet = (id: string) => {
    if (editing) return;
    const target = sheets.find((item) => item.id === id);
    if (!target) return;
    const address = firstCell(target.id);
    setView((previous) => ({
      ...previous, active_sheet_id: target.id, freeze: null,
      selection: { kind: "sheet", active: address, ranges: [cellRange(address)] },
      viewport: { ...previous.viewport, x_px: 0, y_px: 0 },
    }));
  };

  const header = (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px" }}>
        <button type="button" className="adp-icon-btn" aria-label={t("office.undo")} title={t("office.undo")}
          disabled={!state.can_undo || state.busy}
          onClick={() => { void controller.undo().catch(setError); }}>
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button type="button" className="adp-icon-btn" aria-label={t("office.redo")} title={t("office.redo")}
          disabled={!state.can_redo || state.busy}
          onClick={() => { void controller.redo().catch(setError); }}>
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <span>{document.info.name}</span>
        <span>{t(`office.${state.mode}`)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="adp-btn"
          disabled={!state.ready || state.mode === "editing" || state.busy || document.info.read_only ||
            !state.capabilities.includes("sheet_cells")}
          onClick={() => { void controller.setEditingEnabled(true).catch(setError); }}>
          {t("office.enableEditing")}
        </button>
        <button type="button" className="adp-btn" onClick={() => onOpenHelp("editing-spreadsheets")}>
          {t("help.title")}
        </button>
      </div>
      <Ribbon
        def={sheetRibbon()}
        ctx={ctx}
        commands={commands}
        accent="excel"
        active={active}
        handlerId="office-sheet"
        initialTabId={view.active_ribbon_tab}
        onTabChange={(id) => {
          if (view.active_ribbon_tab !== id) {
            setView((previous) => ({ ...previous, active_ribbon_tab: id as SheetEditorViewState["active_ribbon_tab"] }));
          }
        }}
      />
    </div>
  );

  return (
    <ViewerFrame ribbon={header}>
      <div ref={hostRef} style={{ display: "flex", flex: 1, minWidth: 0, flexDirection: "column", minHeight: 0, height: "100%" }}>
        {error ? <p className="adp-sheet-formula" role="alert">{errorText(t, error, "office_edit")}</p> : null}
        {view.formula_bar ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px" }}>
            <NameBox
              address={activeCell ?? firstCell(sheet?.id ?? "")}
              rows={sheet?.rows ?? 1}
              columns={sheet?.columns ?? 1}
              disabled={!sheet || editing}
              onAddress={(address) => setView((previous) => ({
                ...previous,
                selection: { kind: "sheet", active: { ...address }, ranges: [cellRange(address)] },
              }))}
              onRange={(range) => setView((previous) => ({
                ...previous,
                selection: {
                  kind: "sheet",
                  active: { sheet_id: range.sheet_id, row: range.first_row, column: range.first_column },
                  ranges: [{ ...range }],
                },
              }))}
              onNamedRange={async () => { throw new Error("office_edit.unsupported"); }}
              onError={setError}
            />
            {activeRange && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <FormulaBar
                  controller={controller}
                  range={activeRange}
                  fillRange={fillRange}
                  value={formulaText}
                  locale={locale}
                  disabled={!canEditCell || !formulaReady}
                  editRequest={editRequest}
                  onCommitted={moveAfterCommit}
                  onEditing={setEditing}
                  onError={setError}
                />
              </div>
            )}
          </div>
        ) : null}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
            <SheetGrid
              window={cells}
              rows={sheet?.rows ?? 1}
              columns={sheet?.columns ?? 1}
              selection={view.selection}
              zoom={view.zoom}
              headings={view.headings}
              gridlines={view.gridlines}
              active={active}
              onSelect={(address, extend) => { if (!editing) selectCell(address, extend); }}
              onEdit={(initialText) => { if (!editing && canEditCell) setEditRequest({ initialText }); }}
              onScroll={onScroll}
            />
            <SheetTabs sheets={sheets} activeId={sheet?.id ?? null} onActivate={activateSheet}
              onRename={(id) => {
                if (editing || !canEdit) return;
                const target = sheets.find((item) => item.id === id);
                if (!target) return;
                const address = firstCell(target.id);
                setView((previous) => ({
                  ...previous, active_sheet_id: target.id, freeze: null,
                  selection: { kind: "sheet", active: address, ranges: [cellRange(address)] },
                }));
                setDialog("sheetName");
              }} />
          </div>
          {aiAction ? (
            <div style={{ display: "flex", flexShrink: 0, minWidth: 0 }}>
              <SheetAiPanel
                key={`${controller.session_id}:${aiAction}`}
                controller={controller}
                selection={view.selection}
                initialAction={aiAction}
                onClose={closeAi}
                onOpenHelp={onOpenHelp}
              />
            </div>
          ) : null}
        </div>

        {dialog === "conditional" && conditionalBase && (
          <SheetConditionalDialog
            operation={conditionalBase}
            onConfirm={(operation) => commit(operation)}
            onClose={() => setDialog(null)}
            onError={setError}
          />
        )}
        {dialog === "validation" && validationBase && (
          <SheetValidationDialog
            operation={validationBase}
            onConfirm={(operation) => commit(operation)}
            onClose={() => setDialog(null)}
            onError={setError}
          />
        )}
        {dialog === "chart" && chartBase && (
          <SheetChartDialog
            chart={chartBase}
            sheetIds={sheets.map((item) => item.id)}
            onConfirm={(chart) => commit({ kind: "upsert_chart", chart })}
            onClose={() => setDialog(null)}
            onError={setError}
          />
        )}
        {dialog === "sort" && baseRange && (
          <SheetSortFilter
            range={baseRange}
            onConfirm={(operation) => commit(operation)}
            onClose={() => setDialog(null)}
            onError={setError}
          />
        )}
        {dialog === "sheetName" && sheet && (
          <SheetStructureDialogs
            name={sheet.name}
            names={sheets.map((item) => item.name)}
            onConfirm={(name) => commit({ kind: "rename_sheet", sheet_id: sheet.id, name })}
            onClose={() => setDialog(null)}
            onError={setError}
          />
        )}
      </div>
    </ViewerFrame>
  );
}

/** Source-aware adapter (09a `VirtualViewProps`): it forwards the actual
 * DocumentHandle; a virtual source never becomes a fabricated disk path. */
export function VirtualSheetEditor(props: VirtualViewProps) {
  return (
    <SheetEditor
      document={props.document}
      active={props.active}
      savedState={normalizeSheetViewState(props.savedState)}
      onStateChange={(state) => props.onStateChange(state as unknown as import("../../documents/types").SerializableViewState)}
      onStatus={props.onStatus}
      onOpenHelp={props.onOpenHelp}
      previewOnly={props.previewOnly}
    />
  );
}
