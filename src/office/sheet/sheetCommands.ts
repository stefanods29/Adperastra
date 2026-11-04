import {
  AlignCenter, AlignLeft, AlignRight, ArrowUpDown, Bold, Eraser, FileDown, FilePlus,
  FileText, Filter, FolderOpen, Grid3x3, Hash, HelpCircle, Image, Italic, Lock, MessageSquare,
  Minus, Plus, Printer, Save, Search, Sparkles, Table2, Type, Underline, Unlock, WrapText, X,
  ZoomIn, type LucideIcon,
} from "lucide-react";
import type { Command, CommandRegistry } from "../../commands/registry";
import { canOfficeCommand } from "../officeCompatibility";
import type {
  CellFormatPatch, CellInput, CellRange, OfficeCapability, SheetOperation, TextFormatPatch,
} from "../types";
import type { SheetAiAction } from "./ai/sheetAiTypes";
import type { SheetCommandContext, SheetEditorViewState } from "./sheetUiTypes";

/** Nine-tab spreadsheet commands (Step 21a T4 E2).
 *
 * Every action is a typed command from the shared registry. Document changes
 * are typed SheetOperations through the one canonical OfficeController; no
 * command evaluates a formula, writes a file or calls an export directly.
 * Controls whose native route is not approved stay disabled instead of
 * pretending to succeed. */

type Run = (ctx: SheetCommandContext) => void;
type Enabled = (ctx: SheetCommandContext) => boolean;

/** Host actions the mounted editor owns: view state, help and error display.
 * A command never reaches into React state or a second controller. */
export interface SheetHostActions {
  updateView(patch: Partial<SheetEditorViewState>): void;
  openHelp(slug: string): void;
  notify(error: unknown): void;
  openAi(action: SheetAiAction): void;
  canOpenAi(action: SheetAiAction): boolean;
}

let host: SheetHostActions | null = null;

export function setSheetHostActions(next: SheetHostActions | null): void {
  host = next;
}

const ICONS: Record<string, LucideIcon> = {
  alignCenter: AlignCenter, alignLeft: AlignLeft, alignRight: AlignRight, autoSum: FileText,
  bold: Bold, borders: Grid3x3, calculate: FileText, calculationMode: FileText, cellStyle: FileText,
  chart: Image, clear: Eraser, clearFilter: Filter, close: X, comments: MessageSquare,
  compatibility: FileText, conditional: FileText, copy: FileText, cut: FileText,
  deleteColumns: FileText, deleteRows: FileText, exportPdf: FileDown, fewerDecimals: Minus,
  fill: FileText, filter: Filter, find: Search, font: Type, formulaBar: FileText,
  formulaHelp: HelpCircle, freeze: Lock, gridlines: Grid3x3, headings: Hash, help: HelpCircle,
  insertColumns: Plus, insertFunction: FileText, insertRows: Plus, italic: Italic, limits: FileText,
  manageNames: FileText, margins: FileText, merge: Table2, mode: FileText, moreDecimals: Plus,
  nameRange: FileText, new: FilePlus, numberFormat: Hash, open: FolderOpen, orientation: FileText,
  pageSize: FileText, paste: FileText, picture: Image, pivot: Table2, print: Printer,
  printArea: FileText, properties: FileText, protection: Lock, refreshPivot: FileText,
  replace: Search, save: Save, saveCopy: Save, scale: FileText, size: Type, sort: ArrowUpDown,
  tableStyle: Table2, textColor: FileText, unfreeze: Unlock, validation: FileText, zoom: ZoomIn,
};

function command(
  suffix: string,
  config: {
    run: Run;
    enabled?: Enabled;
    risk?: Command<SheetCommandContext>["risk"];
    help?: string;
    checkedWhen?: (ctx: SheetCommandContext) => boolean;
  },
): Command<SheetCommandContext> {
  return {
    id: `sheet.${suffix}`,
    labelKey: `officeSheet.${suffix}`,
    icon: ICONS[suffix] ?? FileText,
    risk: config.risk ?? "change",
    helpSlug: config.help ?? "editing-spreadsheets",
    enabledWhen: config.enabled ?? (() => true),
    checkedWhen: config.checkedWhen,
    run: config.run,
  };
}

/** A control with no approved native route. It draws disabled and reports
 * the canonical unsupported reason instead of faking a local implementation. */
function unavailable(suffix: string, risk: Command<SheetCommandContext>["risk"] = "change"): Command<SheetCommandContext> {
  return {
    ...command(suffix, { run: () => undefined, enabled: () => false, risk }),
    disabledReasonKey: () => "office.unsupported",
  };
}

function ready(ctx: SheetCommandContext): boolean {
  return ctx.state.ready && !ctx.state.busy;
}

function mutable(ctx: SheetCommandContext, capability: OfficeCapability): boolean {
  return ready(ctx) && !ctx.controller.document.info.read_only &&
    canOfficeCommand(ctx.state, capability, true).enabled;
}

/** AI actions need the native context, proposal clone and apply routes. Until
 * the engine reports all three, the commands stay disabled with the canonical
 * unsupported reason instead of opening a panel that cannot generate. */
function aiReady(ctx: SheetCommandContext): boolean {
  return ready(ctx) && !ctx.controller.document.info.read_only &&
    canOfficeCommand(ctx.state, "ai_context", false).enabled &&
    canOfficeCommand(ctx.state, "proposal_clone", false).enabled &&
    canOfficeCommand(ctx.state, "proposal_apply", true).enabled;
}

function aiCommand(action: SheetAiAction, risk: Command<SheetCommandContext>["risk"]): Command<SheetCommandContext> {
  return {
    id: `sheet.ai${action[0].toUpperCase()}${action.slice(1)}`,
    labelKey: `sheetAi.${action}`,
    icon: Sparkles,
    risk,
    helpSlug: "ai-help-in-spreadsheets",
    enabledWhen: (ctx) => aiReady(ctx) && !!singleRange(ctx) && host?.canOpenAi(action) === true,
    disabledReasonKey: () => "office.unsupported",
    run: () => host?.openAi(action),
  };
}

function singleRange(ctx: SheetCommandContext): CellRange | null {
  return ctx.selection?.ranges.length === 1 ? ctx.selection.ranges[0] : null;
}

function notify(error: unknown): void {
  host?.notify(error);
}

function commit(ctx: SheetCommandContext, operations: SheetOperation[]): Promise<void> {
  if (operations.length === 0) return Promise.resolve();
  return ctx.controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: ctx.state.revision,
    operations: operations.slice(0, 32).map((operation) => ({ family: "sheet" as const, operation })),
    selection_after: ctx.selection,
    label_key: "office.transaction",
  }).then(() => undefined);
}

function run(ctx: SheetCommandContext, job: Promise<void>): void {
  void job.catch(notify);
}

function textValue(ctx: SheetCommandContext): TextFormatPatch | null {
  const value = ctx.formatting?.cell.text;
  return value?.kind === "value" ? value.value : null;
}

async function liveText(ctx: SheetCommandContext): Promise<TextFormatPatch> {
  if (!ctx.selection) throw new Error("office_edit.invalid");
  const formatting = await ctx.controller.formatting(ctx.selection);
  return formatting.cell.text.kind === "value" ? formatting.cell.text.value : {};
}

function formatRanges(ctx: SheetCommandContext, patch: CellFormatPatch): Promise<void> {
  const selection = ctx.selection;
  if (!selection) return Promise.resolve();
  return commit(ctx, selection.ranges.map((range) => ({
    kind: "format_cells" as const, range: { ...range }, patch,
  })));
}

function toggleText(ctx: SheetCommandContext, field: "bold" | "italic" | "underline"): void {
  run(ctx, (async () => {
    const value = await liveText(ctx);
    const patch: TextFormatPatch = field === "underline"
      ? { ...value, underline: value.underline === "single" ? "none" : "single" }
      : { ...value, [field]: value[field] !== true };
    await formatRanges(ctx, { text: patch });
  })());
}

function align(ctx: SheetCommandContext, horizontal: CellFormatPatch["horizontal"]): void {
  run(ctx, formatRanges(ctx, { horizontal }));
}

function toggleWrap(ctx: SheetCommandContext): void {
  run(ctx, (async () => {
    if (!ctx.selection) return;
    const formatting = await ctx.controller.formatting(ctx.selection);
    const current = formatting.cell.wrap;
    await formatRanges(ctx, { wrap: current.kind === "value" ? !current.value : true });
  })());
}

function blankRows(range: CellRange): CellInput[][] {
  const rows = range.last_row - range.first_row + 1;
  const columns = range.last_column - range.first_column + 1;
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ kind: "blank" as const })));
}

function clear(ctx: SheetCommandContext): void {
  const ranges = ctx.selection?.ranges ?? [];
  let cells = 0;
  for (const range of ranges) cells += (range.last_row - range.first_row + 1) * (range.last_column - range.first_column + 1);
  if (ranges.length === 0 || ranges.length > 32 || cells > 100_000) {
    notify(new Error("office_edit.too_large"));
    return;
  }
  run(ctx, commit(ctx, ranges.map((range) => ({
    kind: "set_cells" as const, range: { ...range }, values: blankRows(range), mode: "values" as const,
  }))));
}

function insertAxis(ctx: SheetCommandContext, axis: "row" | "column"): void {
  const range = singleRange(ctx);
  if (!range) return;
  const count = axis === "row" ? range.last_row - range.first_row + 1 : range.last_column - range.first_column + 1;
  if (count < 1 || count > 10_000) {
    notify(new Error("office_edit.too_large"));
    return;
  }
  run(ctx, commit(ctx, [{
    kind: "insert_axis", sheet_id: range.sheet_id, axis,
    index: axis === "row" ? range.first_row : range.first_column, count,
  }]));
}

function freeze(ctx: SheetCommandContext, frozen: boolean): void {
  const active = ctx.selection?.active;
  if (!active) return;
  const rows = frozen ? active.row : 0;
  const columns = frozen ? active.column : 0;
  run(ctx, commit(ctx, [{ kind: "freeze", sheet_id: active.sheet_id, rows, columns }])
    .then(() => host?.updateView({ freeze: { rows, columns } })));
}

function zoom(ctx: SheetCommandContext): void {
  const percent = ctx.view.zoom >= 200 ? 100 : ctx.view.zoom + 25;
  host?.updateView({ zoom: percent, viewport: { ...ctx.view.viewport, zoom_percent: percent } });
}

function view(key: "formula_bar" | "gridlines" | "headings"): Run {
  return (ctx) => host?.updateView({ [key]: !ctx.view[key] } as Partial<SheetEditorViewState>);
}

function help(slug: string): Run {
  return () => host?.openHelp(slug);
}

function dialog(id: Parameters<SheetCommandContext["openDialog"]>[0]): Run {
  return (ctx) => ctx.openDialog(id);
}

const isChecked = (field: "bold" | "italic" | "underline") => (ctx: SheetCommandContext) => {
  const value = textValue(ctx);
  return field === "underline" ? value?.underline === "single" : value?.[field] === true;
};

/** Register every command referenced by the nine tabs. The shared registry
 * refuses duplicates, which guards against a second sheet command set. */
export function registerSheetCommands(registry: CommandRegistry<SheetCommandContext>): void {
  const add = (entry: Command<SheetCommandContext>) => registry.register(entry);

  // File. Save existing is never advertised by the canonical controller and
  // native export needs an app-owned publisher, so both stay fail-closed.
  add(unavailable("new", "read-only"));
  add(unavailable("open", "read-only"));
  add(unavailable("save"));
  add(command("saveCopy", {
    risk: "read-only",
    enabled: (ctx) => Boolean(ctx.saveCopy) && canOfficeCommand(ctx.state, "save_copy", false).enabled,
    run: (ctx) => {
      if (canOfficeCommand(ctx.state, "save_copy", false).enabled) ctx.saveCopy?.();
    },
  }));
  add(unavailable("exportPdf", "read-only"));
  add(unavailable("print", "read-only"));
  add(unavailable("properties", "read-only"));
  add(unavailable("close", "read-only"));

  // Home: clipboard, font family/size, colors and borders need an app-owned
  // clipboard or a font/color picker that Step 21a has not approved yet.
  add(unavailable("paste"));
  add(unavailable("cut"));
  add(unavailable("copy", "read-only"));
  add(unavailable("font"));
  add(unavailable("size"));
  add(command("bold", {
    run: (ctx) => toggleText(ctx, "bold"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
    checkedWhen: isChecked("bold"),
  }));
  add(command("italic", {
    run: (ctx) => toggleText(ctx, "italic"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
    checkedWhen: isChecked("italic"),
  }));
  add(command("underline", {
    run: (ctx) => toggleText(ctx, "underline"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
    checkedWhen: isChecked("underline"),
  }));
  add(unavailable("fill"));
  add(unavailable("textColor"));
  add(unavailable("borders"));
  add(command("alignLeft", {
    run: (ctx) => align(ctx, "left"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
  }));
  add(command("alignCenter", {
    run: (ctx) => align(ctx, "center"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
  }));
  add(command("alignRight", {
    run: (ctx) => align(ctx, "right"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
  }));
  add(command("wrap", {
    run: toggleWrap,
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!ctx.selection,
    checkedWhen: (ctx) => {
      const wrap = ctx.formatting?.cell.wrap;
      return wrap?.kind === "value" && wrap.value === true;
    },
  }));
  add(unavailable("merge"));
  add(unavailable("numberFormat"));
  add(unavailable("moreDecimals"));
  add(unavailable("fewerDecimals"));
  add(command("conditional", {
    run: dialog("conditional"),
    enabled: (ctx) => mutable(ctx, "sheet_formats") && !!singleRange(ctx),
  }));
  add(unavailable("tableStyle"));
  add(unavailable("cellStyle"));
  add(command("insertRows", {
    run: (ctx) => insertAxis(ctx, "row"),
    enabled: (ctx) => mutable(ctx, "sheet_structure") && !!singleRange(ctx),
  }));
  add(unavailable("deleteRows"));
  add(command("insertColumns", {
    run: (ctx) => insertAxis(ctx, "column"),
    enabled: (ctx) => mutable(ctx, "sheet_structure") && !!singleRange(ctx),
  }));
  add(unavailable("deleteColumns"));
  add(command("clear", {
    run: clear,
    enabled: (ctx) => mutable(ctx, "sheet_cells") && !!ctx.selection,
  }));
  add(unavailable("autoSum"));
  add(command("sort", {
    run: dialog("sort"),
    enabled: (ctx) => mutable(ctx, "sheet_cells") && !!singleRange(ctx),
  }));
  add(unavailable("filter"));
  add(unavailable("find", "read-only"));
  add(unavailable("replace"));

  // Insert.
  add(unavailable("pivot"));
  add(command("chart", {
    run: dialog("chart"),
    enabled: (ctx) => mutable(ctx, "sheet_charts") && !!singleRange(ctx),
  }));
  add(unavailable("picture"));

  // Page Layout: typed print settings have no approved dialog yet.
  add(unavailable("printArea"));
  add(unavailable("orientation"));
  add(unavailable("pageSize"));
  add(unavailable("margins"));
  add(unavailable("scale"));

  // Formulas: formula parsing/evaluation is engine-owned and fails closed
  // until the native formula route is approved.
  add(unavailable("insertFunction"));
  add(unavailable("nameRange"));
  add(unavailable("manageNames"));
  add(unavailable("calculate"));
  add(unavailable("calculationMode"));

  // Data.
  add(unavailable("clearFilter"));
  add(command("validation", {
    run: dialog("validation"),
    enabled: (ctx) => mutable(ctx, "sheet_validation") && !!singleRange(ctx),
  }));
  add(unavailable("refreshPivot"));

  // Review.
  add(aiCommand("formula", "change"));
  add(aiCommand("explain", "read-only"));
  add(aiCommand("clean", "change"));
  add(aiCommand("chart", "change"));
  add(aiCommand("describe", "read-only"));
  add(unavailable("protection", "read-only"));
  add(unavailable("comments", "read-only"));
  add(command("compatibility", { run: help("office-compatibility-and-limits"), risk: "read-only" }));

  // View.
  add(command("formulaBar", {
    run: view("formula_bar"),
    risk: "read-only",
    checkedWhen: (ctx) => ctx.view.formula_bar,
  }));
  add(command("gridlines", {
    run: view("gridlines"),
    risk: "read-only",
    checkedWhen: (ctx) => ctx.view.gridlines,
  }));
  add(command("headings", {
    run: view("headings"),
    risk: "read-only",
    checkedWhen: (ctx) => ctx.view.headings,
  }));
  add(command("freeze", {
    run: (ctx) => freeze(ctx, true),
    enabled: (ctx) => mutable(ctx, "sheet_structure") && !!ctx.selection,
  }));
  add(command("unfreeze", {
    run: (ctx) => freeze(ctx, false),
    enabled: (ctx) => mutable(ctx, "sheet_structure") && !!ctx.selection,
  }));
  add(command("mode", {
    run: (ctx) => run(ctx, ctx.controller.setEditingEnabled(ctx.state.mode !== "editing")),
    enabled: (ctx) => ready(ctx) && !ctx.controller.document.info.read_only &&
      ctx.state.capabilities.includes("sheet_cells"),
  }));
  add(command("zoom", { run: zoom, risk: "read-only" }));

  // Help.
  add(command("help", { run: help("editing-spreadsheets"), risk: "read-only" }));
  add(command("formulaHelp", { run: help("spreadsheet-formulas"), risk: "read-only" }));
  add(command("limits", { run: help("office-compatibility-and-limits"), risk: "read-only" }));
}
