import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BookOpen, Calendar, Check, Copy,
  FilePlus, FileText, FolderOpen, Hash, Highlighter, Image, IndentDecrease, IndentIncrease,
  Italic, Link, List, ListOrdered, MessageSquare, Mic, Palette, PanelLeft, Printer, Redo2,
  Replace, Save, Scissors, Search, Sparkles, Square, Strikethrough, Subscript, Superscript, Table, Type,
  Underline, Undo2, X, type LucideIcon,
} from "lucide-react";
import i18n from "../../i18n";
import type { Command, CommandRegistry } from "../../commands/registry";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import type {
  DocumentOperation, OfficeCapability, TextFormatPatch,
} from "../types";
import { canOfficeCommand } from "../officeCompatibility";
import { canDocumentMutate } from "./documentController";
import { previewDocumentReview } from "./DocumentReview";
import type { DocumentAiAction } from "./ai/documentAiTypes";
import { documentInsertField } from "./DocumentReferenceDialogs";
import { documentIndent } from "./DocumentParagraphDialog";
import type { DocumentDialogId, DocumentEditorViewState, OfficeCommandContext } from "./documentUiTypes";

/** Host actions owned by the mounted editor and by the application tab host.
 * Commands never touch a path, window or file picker directly. */
export interface DocumentEditorHost {
  canMutate(capability: OfficeCapability): boolean;
  canFile(id: "new" | "open" | "close" | "saveCopy" | "exportPdf" | "print" | "copyPath"): boolean;
  file(id: "new" | "open" | "close" | "saveCopy" | "exportPdf" | "print" | "copyPath"): void;
  updateView(patch: Partial<DocumentEditorViewState>): void;
  openDialog(id: DocumentDialogId): void;
  openHelp(slug: string): void;
  openSpelling(): void;
  openDictation(): void;
  canOpenAi(action: DocumentAiAction): boolean;
  openAi(action: DocumentAiAction): void;
  openText(kind: "footnote" | "citation"): void;
  pickTextColor(target: "foreground" | "highlight"): void;
  focusFormat(kind: "font" | "size"): void;
  canClipboard(action: "paste" | "cut" | "copy"): boolean;
  clipboard(action: "paste" | "cut" | "copy"): void;
  confirm(message: string): boolean;
  fail(error: unknown): void;
  fit(kind: "page" | "width"): void;
  zoom(percent: number): void;
  toggleMode(): void;
}

export interface DocumentEditorAppHost {
  newDocument(): void;
  openDocument(): void;
  closeTab(): void;
  copyPath(): void;
  exportPdf(): void;
  print(): void;
  pickImage(): Promise<ExportSnapshot | null>;
}

let appHost: DocumentEditorAppHost | null = null;
export function setDocumentEditorAppHost(next: DocumentEditorAppHost | null): void { appHost = next; }
export function documentEditorAppHost(): DocumentEditorAppHost | null { return appHost; }

const hosts = new Map<string, DocumentEditorHost>();
export function setDocumentEditorHost(sessionId: string, host: DocumentEditorHost | null): void {
  if (host) hosts.set(sessionId, host); else hosts.delete(sessionId);
}
function hostFor(ctx: OfficeCommandContext): DocumentEditorHost | undefined {
  return hosts.get(ctx.controller.session_id);
}

function documentSelection(ctx: OfficeCommandContext) {
  const selection = ctx.selection;
  return selection?.kind === "document" && selection.span.revision === ctx.state.revision ? selection : null;
}
function blockIds(ctx: OfficeCommandContext): string[] {
  const selection = documentSelection(ctx);
  return selection ? [selection.span.anchor.block_id] : [];
}
function can(ctx: OfficeCommandContext, capability: OfficeCapability = "document_text"): boolean {
  const target = hostFor(ctx);
  return target
    ? target.canMutate(capability)
    : canDocumentMutate(ctx.state, capability).enabled;
}
function canFile(ctx: OfficeCommandContext, id: "new" | "open" | "close" | "saveCopy" | "exportPdf" | "print" | "copyPath"): boolean {
  return hostFor(ctx)?.canFile(id) ?? false;
}
/** Export/print/save-copy read the session; they are never blocked by the
 * current mode, but still require the native capability. */
function canRead(ctx: OfficeCommandContext, capability: OfficeCapability): boolean {
  return canOfficeCommand(ctx.state, capability, false).enabled;
}
function file(ctx: OfficeCommandContext, id: "new" | "open" | "close" | "saveCopy" | "exportPdf" | "print" | "copyPath"): void {
  hostFor(ctx)?.file(id);
}

async function commit(ctx: OfficeCommandContext, operations: DocumentOperation[]): Promise<boolean> {
  if (operations.length === 0) return false;
  try {
    await ctx.controller.transact({
      transaction_id: crypto.randomUUID(), expected_revision: ctx.state.revision,
      operations: operations.map((operation) => ({ family: "document" as const, operation })),
      selection_after: null, label_key: "office.transaction",
    });
    return true;
  } catch (error) {
    hostFor(ctx)?.fail(error);
    return false;
  }
}

async function liveFormatting(ctx: OfficeCommandContext) {
  const selection = documentSelection(ctx);
  if (!selection) return null;
  try { return await ctx.controller.formatting(selection); }
  catch (error) { hostFor(ctx)?.fail(error); return null; }
}

async function toggleText(ctx: OfficeCommandContext, field: "bold" | "italic" | "strike" | "underline") {
  const selection = documentSelection(ctx);
  if (!selection) return;
  const formatting = await liveFormatting(ctx);
  if (!formatting) return;
  const value = field === "underline" ? formatting.text.underline
    : field === "bold" ? formatting.text.bold : field === "italic" ? formatting.text.italic : formatting.text.strike;
  if (value.kind === "unavailable") { hostFor(ctx)?.fail(new Error(value.reason_key)); return; }
  const next = value.kind === "mixed" ? true : !value.value;
  const patch: TextFormatPatch = field === "underline"
    ? { underline: next ? "single" : "none" }
    : field === "bold" ? { bold: next } : field === "italic" ? { italic: next } : { strike: next };
  await commit(ctx, [{ kind: "format_text", span: selection.span, patch }]);
}

async function toggleScript(ctx: OfficeCommandContext, script: "subscript" | "superscript") {
  const selection = documentSelection(ctx);
  if (!selection) return;
  const formatting = await liveFormatting(ctx);
  if (!formatting) return;
  const value = formatting.text.script;
  if (value.kind === "unavailable") { hostFor(ctx)?.fail(new Error(value.reason_key)); return; }
  const next = value.kind === "value" && value.value === script ? "normal" : script;
  await commit(ctx, [{ kind: "format_text", span: selection.span, patch: { script: next } }]);
}

async function setParagraph(ctx: OfficeCommandContext, patch: import("../types").ParagraphFormatPatch) {
  const ids = blockIds(ctx);
  if (ids.length === 0) return;
  try { await commit(ctx, [{ kind: "format_paragraph", block_ids: ids, patch }]); }
  catch (error) { hostFor(ctx)?.fail(error); }
}

async function toggleList(ctx: OfficeCommandContext, list: "disc" | "decimal") {
  const formatting = await liveFormatting(ctx);
  if (!formatting) return;
  const current = formatting.paragraph.list;
  if (current.kind === "unavailable") { hostFor(ctx)?.fail(new Error(current.reason_key)); return; }
  await setParagraph(ctx, { list: current.kind === "value" && current.value === list ? "none" : list });
}

async function changeIndent(ctx: OfficeCommandContext, direction: "indent" | "outdent") {
  const formatting = await liveFormatting(ctx);
  if (!formatting) return;
  const current = formatting.paragraph.indent_left_pt;
  if (current.kind !== "value") { hostFor(ctx)?.fail(new Error("office_edit.unsupported")); return; }
  try { await setParagraph(ctx, documentIndent(current.value, direction)); }
  catch (error) { hostFor(ctx)?.fail(error); }
}

function insertField(ctx: OfficeCommandContext, kind: "page_number" | "page_count" | "date" | "table_of_contents") {
  const selection = documentSelection(ctx);
  if (!selection) return;
  try {
    void commit(ctx, [documentInsertField(selection.span.focus, kind)]);
  } catch (error) { hostFor(ctx)?.fail(error); }
}

async function reviewAll(ctx: OfficeCommandContext, decision: "accept" | "reject") {
  try {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await ctx.controller.items("changes", cursor);
      if (result.kind !== "changes" || result.revision !== ctx.state.revision) throw new Error("office_edit.changed");
      ids.push(...result.items.map((item) => item.id));
      if (result.complete || !result.next_cursor || ids.length > 1000) break;
      cursor = result.next_cursor;
    }
    const preview = previewDocumentReview(ids, decision);
    const host = hostFor(ctx);
    if (!host || !host.confirm(i18n.t("officeDoc.changeConfirm", { count: preview.count }))) return;
    await commit(ctx, preview.operations);
  } catch (error) { hostFor(ctx)?.fail(error); }
}

function view(ctx: OfficeCommandContext, patch: Partial<DocumentEditorViewState>) {
  hostFor(ctx)?.updateView(patch);
}
function dialog(id: DocumentDialogId) {
  return (ctx: OfficeCommandContext) => hostFor(ctx)?.openDialog(id);
}
function help(slug: string) {
  return (ctx: OfficeCommandContext) => hostFor(ctx)?.openHelp(slug);
}

const ICONS: Record<string, LucideIcon> = {
  new: FilePlus, open: FolderOpen, save: Save, saveCopy: Copy, exportPdf: FileText,
  print: Printer, properties: FileText, close: X, paste: Copy, cut: Scissors, copy: Copy,
  font: Type, fontSize: Type, bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough,
  subscript: Subscript, superscript: Superscript, textColor: Palette, highlight: Highlighter,
  alignLeft: AlignLeft, alignCenter: AlignCenter, alignRight: AlignRight, justify: AlignJustify,
  bullets: List, numbering: ListOrdered, indent: IndentIncrease, outdent: IndentDecrease,
  spacing: Type, style: Type, styles: Type, createStyle: Type, find: Search, replace: Replace,
  selectAll: Check, pageBreak: FileText, table: Table, image: Image, link: Link, pageNumber: Hash,
  pageCount: Hash, date: Calendar, pageColor: Palette, compatibility: FileText,
  pageSetup: FileText, margins: FileText, orientation: FileText, columns: FileText,
  paragraph: Type, tableOfContents: BookOpen, updateContents: BookOpen, footnote: Hash,
  citation: BookOpen, bibliography: BookOpen, spelling: Check, addComment: MessageSquare,
  reply: MessageSquare, resolve: Check, deleteComment: X, trackChanges: Check,
  acceptChange: Check, rejectChange: X, acceptAll: Check, rejectAll: X,
  navigation: PanelLeft, ruler: FileText, comments: MessageSquare, zoom: Search,
  fitPage: FileText, fitWidth: FileText, editingMode: FileText, help: BookOpen, limits: BookOpen,
  shortcuts: BookOpen, dictation: Mic, stopDictation: Square,
};

function command(
  suffix: string,
  run: (ctx: OfficeCommandContext) => void,
  options: {
    enabled?: (ctx: OfficeCommandContext) => boolean;
    checked?: (ctx: OfficeCommandContext) => boolean;
    risk?: Command<OfficeCommandContext>["risk"];
    helpSlug?: string;
    icon?: LucideIcon;
  } = {},
): Command<OfficeCommandContext> {
  return {
    id: suffix.startsWith("document.") ? suffix : `doc.${suffix}`,
    labelKey: suffix.startsWith("document.") ? `document.${suffix.slice("document.".length)}` : `officeDoc.${suffix}`,
    icon: options.icon ?? ICONS[suffix] ?? FileText,
    risk: options.risk ?? "change",
    helpSlug: options.helpSlug ?? "editing-documents",
    enabledWhen: options.enabled ?? (() => true),
    checkedWhen: options.checked,
    checkKind: options.checked ? "toggle" : undefined,
    run,
  };
}

/** Review > AI entry. Opening the panel is read-only; the panel's Accept is
 * the only mutation path and needs the native E21/E22 preview + human grant. */
const AI_ACTIONS: Record<string, DocumentAiAction> = {
  aiRewrite: "rewrite", aiShorten: "shorten", aiExpand: "expand", aiSimplify: "simplify",
  aiGrammar: "grammar", aiTone: "tone", aiTranslate: "translate", aiAltText: "alt_text",
  aiDraft: "draft", aiContinue: "continue",
};

function aiCommand(suffix: string, action: DocumentAiAction): Command<OfficeCommandContext> {
  return {
    id: `doc.${suffix}`,
    labelKey: action === "alt_text" ? "documentAi.altText" : `documentAi.${action}`,
    icon: Sparkles,
    risk: "read-only",
    helpSlug: "ai-writing-in-documents",
    enabledWhen: (ctx) => hostFor(ctx)?.canOpenAi(action) === true,
    disabledReasonKey: () => "office.unsupported",
    run: (ctx) => hostFor(ctx)?.openAi(action),
  };
}

/** Every command of the nine tabs. Duplicate ids are refused by the shared
 * registry, which is the intended guard against a second command set. */
export function registerDocumentCommands(registry: CommandRegistry<OfficeCommandContext>): void {
  const add = (entry: Command<OfficeCommandContext>) => registry.register(entry);
  const readable = () => true;

  // File
  add(command("new", (ctx) => file(ctx, "new"), { enabled: (ctx) => canFile(ctx, "new"), risk: "read-only" }));
  add(command("open", (ctx) => file(ctx, "open"), { enabled: (ctx) => canFile(ctx, "open"), risk: "read-only" }));
  add(command("save", (ctx) => { void ctx.controller.document.save().catch((error) => hostFor(ctx)?.fail(error)); },
    { enabled: (ctx) => can(ctx, "save_existing") && ctx.controller.document.getState().can_save_existing }));
  add(command("saveCopy", (ctx) => file(ctx, "saveCopy"), { enabled: (ctx) => canFile(ctx, "saveCopy") && canRead(ctx, "save_copy"), risk: "read-only" }));
  add(command("exportPdf", (ctx) => file(ctx, "exportPdf"), { enabled: (ctx) => canFile(ctx, "exportPdf") && canRead(ctx, "export_pdf"), risk: "read-only" }));
  add(command("print", (ctx) => file(ctx, "print"), { enabled: (ctx) => canFile(ctx, "print") && canRead(ctx, "print"), risk: "read-only" }));
  add(command("properties", dialog("properties"), { risk: "read-only" }));
  add(command("close", (ctx) => file(ctx, "close"), { enabled: (ctx) => canFile(ctx, "close"), risk: "read-only" }));

  // Home
  add(command("paste", (ctx) => hostFor(ctx)?.clipboard("paste"), { enabled: (ctx) => can(ctx) && Boolean(hostFor(ctx)?.canClipboard("paste")) }));
  add(command("cut", (ctx) => hostFor(ctx)?.clipboard("cut"), { enabled: (ctx) => can(ctx) && Boolean(documentSelection(ctx)) && Boolean(hostFor(ctx)?.canClipboard("cut")) }));
  add(command("copy", (ctx) => hostFor(ctx)?.clipboard("copy"), { enabled: (ctx) => Boolean(documentSelection(ctx)) && Boolean(hostFor(ctx)?.canClipboard("copy")), risk: "read-only" }));
  add(command("font", (ctx) => hostFor(ctx)?.focusFormat("font"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("fontSize", (ctx) => hostFor(ctx)?.focusFormat("size"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("bold", (ctx) => { void toggleText(ctx, "bold"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.bold.kind === "value" && ctx.formatting.text.bold.value === true }));
  add(command("italic", (ctx) => { void toggleText(ctx, "italic"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.italic.kind === "value" && ctx.formatting.text.italic.value === true }));
  add(command("underline", (ctx) => { void toggleText(ctx, "underline"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.underline.kind === "value" && ctx.formatting.text.underline.value !== "none" }));
  add(command("strike", (ctx) => { void toggleText(ctx, "strike"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.strike.kind === "value" && ctx.formatting.text.strike.value === true }));
  add(command("subscript", (ctx) => { void toggleScript(ctx, "subscript"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.script.kind === "value" && ctx.formatting.text.script.value === "subscript" }));
  add(command("superscript", (ctx) => { void toggleScript(ctx, "superscript"); }, { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)), checked: (ctx) => ctx.formatting?.text.script.kind === "value" && ctx.formatting.text.script.value === "superscript" }));
  add(command("textColor", (ctx) => hostFor(ctx)?.pickTextColor("foreground"), { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)) && Boolean(hostFor(ctx)) }));
  add(command("highlight", (ctx) => hostFor(ctx)?.pickTextColor("highlight"), { enabled: (ctx) => can(ctx, "document_format") && Boolean(documentSelection(ctx)) && Boolean(hostFor(ctx)) }));
  add(command("alignLeft", (ctx) => { void setParagraph(ctx, { align: "left" }); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("alignCenter", (ctx) => { void setParagraph(ctx, { align: "center" }); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("alignRight", (ctx) => { void setParagraph(ctx, { align: "right" }); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("justify", (ctx) => { void setParagraph(ctx, { align: "justify" }); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("bullets", (ctx) => { void toggleList(ctx, "disc"); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("numbering", (ctx) => { void toggleList(ctx, "decimal"); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("indent", (ctx) => { void changeIndent(ctx, "indent"); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("outdent", (ctx) => { void changeIndent(ctx, "outdent"); }, { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("spacing", dialog("paragraph"), { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("style", dialog("style"), { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("createStyle", dialog("style"), { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));
  add(command("find", dialog("find"), { enabled: readable, risk: "read-only" }));
  add(command("replace", dialog("replace"), { enabled: (ctx) => can(ctx), risk: "read-only" }));
  add(command("selectAll", () => undefined, { enabled: () => false }));
  add(command("document.dictation", (ctx) => hostFor(ctx)?.openDictation(), { enabled: (ctx) => can(ctx) && Boolean(documentSelection(ctx)), icon: Mic }));
  add(command("document.stopDictation", () => undefined, { enabled: () => false, icon: Square }));

  // Insert
  add(command("pageBreak", (ctx) => { const selection = documentSelection(ctx); if (selection) void commit(ctx, [{ kind: "insert_break", position: selection.span.focus, break_kind: "page" }]); }, { enabled: (ctx) => can(ctx) && Boolean(documentSelection(ctx)) }));
  add(command("table", dialog("table"), { enabled: (ctx) => can(ctx, "document_tables") }));
  add(command("image", dialog("image"), { enabled: (ctx) => can(ctx, "document_images") && Boolean(documentSelection(ctx)) }));
  add(command("link", dialog("link"), { enabled: (ctx) => can(ctx) && Boolean(documentSelection(ctx)) }));
  add(command("pageNumber", (ctx) => insertField(ctx, "page_number"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));
  add(command("pageCount", (ctx) => insertField(ctx, "page_count"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));
  add(command("date", (ctx) => insertField(ctx, "date"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));

  // Design
  add(command("styles", dialog("style"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("pageColor", () => undefined, { enabled: () => false }));
  add(command("compatibility", dialog("compatibility"), { risk: "read-only" }));

  // Layout
  add(command("pageSetup", dialog("page"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("margins", dialog("page"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("orientation", dialog("page"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("columns", dialog("page"), { enabled: (ctx) => can(ctx, "document_format") }));
  add(command("paragraph", dialog("paragraph"), { enabled: (ctx) => can(ctx, "document_format") && blockIds(ctx).length > 0 }));

  // References
  add(command("tableOfContents", (ctx) => insertField(ctx, "table_of_contents"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));
  // No typed query exposes the live table-of-contents field ID yet; guessing
  // one from a style or block ID would refresh the wrong field.
  add(command("updateContents", () => undefined, { enabled: () => false }));
  add(command("footnote", (ctx) => hostFor(ctx)?.openText("footnote"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));
  add(command("citation", (ctx) => hostFor(ctx)?.openText("citation"), { enabled: (ctx) => can(ctx, "document_references") && Boolean(documentSelection(ctx)) }));
  add(command("bibliography", (ctx) => hostFor(ctx)?.openText("citation"), { enabled: (ctx) => can(ctx, "document_references") }));

  // Review
  for (const [suffix, action] of Object.entries(AI_ACTIONS)) add(aiCommand(suffix, action));
  add(command("spelling", (ctx) => hostFor(ctx)?.openSpelling(), { enabled: (ctx) => ctx.state.capabilities.includes("spelling") && Boolean(documentSelection(ctx)), risk: "read-only" }));
  add(command("addComment", dialog("comment"), { enabled: (ctx) => can(ctx, "document_comments") && Boolean(documentSelection(ctx)) }));
  add(command("reply", (ctx) => view(ctx, { comments_open: true }), { enabled: (ctx) => can(ctx, "document_comments"), risk: "read-only" }));
  add(command("resolve", (ctx) => view(ctx, { comments_open: true }), { enabled: (ctx) => can(ctx, "document_comments"), risk: "read-only" }));
  add(command("deleteComment", (ctx) => view(ctx, { comments_open: true }), { enabled: (ctx) => can(ctx, "document_comments"), risk: "recycle" }));
  add(command("trackChanges", () => undefined, { enabled: () => false }));
  add(command("acceptChange", () => undefined, { enabled: () => false }));
  add(command("rejectChange", () => undefined, { enabled: () => false }));
  add(command("acceptAll", (ctx) => { void reviewAll(ctx, "accept"); }, { enabled: (ctx) => can(ctx, "document_review") }));
  add(command("rejectAll", (ctx) => { void reviewAll(ctx, "reject"); }, { enabled: (ctx) => can(ctx, "document_review"), risk: "irreversible" }));

  // View
  add(command("navigation", (ctx) => view(ctx, { navigation_open: !ctx.view.navigation_open }), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only", checked: (ctx) => ctx.view.navigation_open }));
  add(command("ruler", (ctx) => view(ctx, { ruler: !ctx.view.ruler }), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only", checked: (ctx) => ctx.view.ruler }));
  add(command("comments", (ctx) => view(ctx, { comments_open: !ctx.view.comments_open }), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only", checked: (ctx) => ctx.view.comments_open }));
  add(command("zoom", (ctx) => hostFor(ctx)?.zoom(ctx.view.viewport.zoom_percent >= 200 ? 100 : ctx.view.viewport.zoom_percent + 25), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only" }));
  add(command("fitPage", (ctx) => hostFor(ctx)?.fit("page"), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only" }));
  add(command("fitWidth", (ctx) => hostFor(ctx)?.fit("width"), { enabled: (ctx) => Boolean(hostFor(ctx)), risk: "read-only" }));
  add(command("editingMode", (ctx) => hostFor(ctx)?.toggleMode(), { enabled: (ctx) => can(ctx, "document_text") || ctx.state.mode !== "viewing", risk: "read-only" }));

  // Help
  add(command("help", help("editing-documents"), { risk: "read-only" }));
  add(command("limits", help("office-compatibility-and-limits"), { risk: "read-only" }));
  add(command("shortcuts", help("editing-menus"), { risk: "read-only" }));
}
