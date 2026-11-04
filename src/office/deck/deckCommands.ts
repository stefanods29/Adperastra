import type { Command, CommandRegistry } from "../../commands/registry";
import type { OfficeController } from "../OfficeController";
import type {
  DeckAnimation, DeckOperation, DeckTransition, OfficeCapability, OfficeTransactionResult,
  ParagraphFormatPatch, TextFormatPatch,
} from "../types";
import { canOfficeCommand } from "../officeCompatibility";
import { DECK_ICONS } from "./deckCommandIcons";
import { canDeckMutate, canSaveDeckExisting } from "./deckController";
import { fitZoomPercent } from "./deckCoordinates";
import type { DeckCommandContext, DeckDialogId, DeckEditorViewState } from "./deckUiTypes";

/** Ten-tab slide commands (Step 22a T3 E2). Every user action is a typed
 * command from the shared registry; commands only use typed DeckOperations
 * and never send an engine command string. */

type Run = (ctx: DeckCommandContext) => void;
type Enabled = (ctx: DeckCommandContext) => boolean;

const SLIDE_MUTATION: OfficeCapability = "deck_slides";
const SHAPE_MUTATION: OfficeCapability = "deck_shapes";

/** Host actions the editor owns. A command asking for a dialog, a file
 * picker or a view change goes through this small bridge; nothing here is a
 * second app framework and every field has one caller (DeckEditor). */
export interface DeckHostActions {
  updateView(patch: Partial<DeckEditorViewState>): void;
  openHelp(slug: string): void;
  fileAction(id: "new" | "open" | "saveCopy" | "close"): void;
  clipboard(id: "paste" | "cut" | "copy"): void;
  deleteSlides(slideIds: readonly string[]): void;
  insertShape(kind: "text" | "rectangle" | "ellipse" | "line" | "arrow" | "triangle"): void;
  pickTextColor(): void;
  focusFormat(control: "font" | "size"): void;
}

let host: DeckHostActions | null = null;

export function setDeckHostActions(next: DeckHostActions | null): void {
  host = next;
}

/** File/tab actions belong to the app host, not to a mounted editor. The
 * coordinator registers this bridge once with the tab host. Until it is
 * registered those buttons stay inert instead of guessing a path or window. */
export interface DeckEditorHost {
  newDeck(): void;
  openDeck(): void;
  closeTab(): void;
  saveCopy(): void;
  copyPath(): void;
  /** An app-owned picker returning an immutable authorized image snapshot. */
  pickImage(): Promise<import("../../services/exportSnapshots").ExportSnapshot | null>;
  /** App-owned pickers for the 22b style exchange. Until the host registers
   * them the library's import buttons stay disabled instead of guessing a
   * path or synthesizing a template inspection. */
  pickDeckStyleInput?(
    kind: "template" | "file",
  ): Promise<import("../../convert/types").ConversionInput | null>;
}

let editorHost: DeckEditorHost | null = null;

export function setDeckEditorHost(next: DeckEditorHost | null): void {
  editorHost = next;
}

export function deckEditorHost(): DeckEditorHost | null {
  return editorHost;
}

/** Slide/layout facts gathered from the 20a item pages. They are render-time
 * data, not persisted view state and not a duplicate controller. */
export interface DeckLayoutContext {
  defaultLayoutId: string | null;
  slideLayouts: Record<string, string>;
  slideHidden: Record<string, boolean>;
  slideIds: readonly string[];
  transition: DeckTransition | null;
  animationIds: Record<string, string>;
}

let layoutContext: DeckLayoutContext = {
  defaultLayoutId: null,
  slideLayouts: {},
  slideHidden: {},
  slideIds: [],
  transition: null,
  animationIds: {},
};

export function setDeckLayoutContext(next: Partial<DeckLayoutContext>): void {
  layoutContext = { ...layoutContext, ...next };
}

export function deckLayoutContext(): DeckLayoutContext {
  return layoutContext;
}

function mutate(ctx: DeckCommandContext, capability: OfficeCapability): boolean {
  return canDeckMutate(ctx.controller.document, ctx.state, capability).enabled;
}

function commit(ctx: DeckCommandContext, operations: DeckOperation[]): Promise<OfficeTransactionResult> | null {
  if (operations.length === 0) return null;
  return ctx.controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: ctx.state.revision,
    operations: operations.map((operation) => ({ family: "deck" as const, operation })),
    selection_after: null,
    label_key: "office.transaction",
  });
}

function selectedSlides(ctx: DeckCommandContext): string[] {
  const ids = ctx.selection?.slide_ids ?? (ctx.view.slide_id ? [ctx.view.slide_id] : []);
  return [...new Set(ids)];
}

function dialog(id: DeckDialogId) {
  return (ctx: DeckCommandContext) => ctx.openDialog(id);
}

function view(patch: Partial<DeckEditorViewState>) {
  return () => host?.updateView(patch);
}

function help(slug: string) {
  return () => host?.openHelp(slug);
}

function file(id: "new" | "open" | "saveCopy" | "close") {
  return () => host?.fileAction(id);
}

/** Wire the file commands to the coordinator-registered app host. */
export function deckFileAction(id: "new" | "open" | "saveCopy" | "close"): void {
  const target = deckEditorHost();
  if (!target) return;
  if (id === "new") target.newDeck();
  else if (id === "open") target.openDeck();
  else if (id === "saveCopy") target.saveCopy();
  else target.closeTab();
}

/** Toggle one run-level property from the live formatting query. A mixed or
 * unavailable value is not silently coerced: an explicit patch is sent. */
async function toggleTextFormat(
  ctx: DeckCommandContext,
  field: "bold" | "italic" | "underline",
): Promise<void> {
  const selection = ctx.selection;
  if (!selection || selection.shape_ids.length === 0) return;
  const formatting = await ctx.controller.formatting(selection);
  const value = (formatting.text as unknown as Record<string, { kind?: string; value?: boolean }>)?.[field];
  const next = value?.kind === "value" ? !value.value : true;
  const patch: TextFormatPatch =
    field === "bold" ? { bold: next } : field === "italic" ? { italic: next } : { underline: next ? "single" : "none" };
  const spans = selection.text_span ? [selection.text_span] : [];
  if (spans.length === 0) return;
  await commit(ctx, spans.map((span) => ({
    kind: "format_text", slide_id: selection.slide_ids[0], shape_id: selection.shape_ids[0], span, patch,
  })));
}

/** Paragraph alignment/list patches accept the live text span's block as the
 * one explicitly selected block; no selection means the console is disabled. */
async function setParagraph(
  ctx: DeckCommandContext,
  patch: ParagraphFormatPatch,
): Promise<void> {
  const selection = ctx.selection;
  if (!selection?.text_span || selection.shape_ids.length === 0) return;
  const block = selection.text_span.anchor.block_id;
  await commit(ctx, [{
    kind: "format_paragraph", slide_id: selection.slide_ids[0], shape_id: selection.shape_ids[0],
    block_ids: [block], patch,
  }]);
}

async function toggleList(ctx: DeckCommandContext, list: "disc" | "decimal"): Promise<void> {
  const selection = ctx.selection;
  if (!selection) return;
  const formatting = await ctx.controller.formatting(selection);
  const current = (formatting.paragraph as unknown as Record<string, { kind?: string; value?: string }>)?.list;
  await setParagraph(ctx, { list: current?.kind === "value" && current.value === list ? "none" : list });
}

function command(
  suffix: string,
  config: {
    run: Run; enabled?: Enabled; risk?: Command<DeckCommandContext>["risk"]; help?: string;
    pending?: boolean; labelKey?: string;
  },
): Command<DeckCommandContext> {
  return {
    id: `deck.${suffix}`,
    // `officeDeck.group.*` is the group-caption namespace, so the Group
    // command needs its own label key to avoid a JSON string/object clash.
    labelKey: config.labelKey ?? `officeDeck.${suffix}`,
    icon: DECK_ICONS[suffix] ?? DECK_ICONS.normal,
    risk: config.risk ?? "change",
    helpSlug: config.help ?? "editing-presentations",
    pending: config.pending,
    enabledWhen: config.enabled ?? (() => true),
    run: config.run,
  };
}

const always = () => true;
const hasSlides = (ctx: DeckCommandContext) => selectedSlides(ctx).length > 0;
const hasShapes = (ctx: DeckCommandContext) => (ctx.selection?.shape_ids.length ?? 0) > 0;

/** Register every command of the ten tabs. Duplicate ids are refused by the
 * shared registry, which is the intended guard against a second command set. */
export function registerDeckCommands(registry: CommandRegistry<DeckCommandContext>): void {
  const add = (entry: Command<DeckCommandContext>) => registry.register(entry);

  // File
  add(command("new", { run: file("new"), risk: "read-only", help: "editing-presentations" }));
  add(command("open", { run: file("open"), risk: "read-only", help: "editing-presentations" }));
  add(command("save", { run: (ctx) => { if (canSaveDeckExisting(ctx.controller)) void ctx.controller.document.save(); }, enabled: (ctx) => canSaveDeckExisting(ctx.controller) }));
  add(command("saveCopy", {
    run: file("saveCopy"),
    enabled: (ctx) => canOfficeCommand(ctx.state, "save_copy", false).enabled,
    risk: "read-only",
  }));
  add(command("exportPdf", { run: dialog("export"), enabled: (ctx) => canOfficeCommand(ctx.state, "export_pdf", false).enabled, risk: "read-only" }));
  add(command("exportImages", { run: dialog("export"), enabled: (ctx) => canOfficeCommand(ctx.state, "export_images", false).enabled, risk: "read-only" }));
  add(command("print", { run: dialog("print"), enabled: (ctx) => canOfficeCommand(ctx.state, "print", false).enabled, risk: "read-only" }));
  add(command("properties", { run: dialog("properties"), risk: "read-only" }));
  add(command("close", { run: file("close"), risk: "read-only" }));

  // Home
  add(command("paste", { run: () => host?.clipboard("paste"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("cut", { run: () => host?.clipboard("cut"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("copy", { run: () => host?.clipboard("copy"), enabled: hasShapes, risk: "read-only" }));
  add(command("newSlide", {
    run: (ctx) => {
      const layout = layoutContext.defaultLayoutId;
      if (layout) void commit(ctx, [{ kind: "add_slide", after_id: selectedSlides(ctx)[0] ?? null, layout_id: layout }]);
    },
    enabled: (ctx) => mutate(ctx, SLIDE_MUTATION) && layoutContext.defaultLayoutId !== null,
  }));
  add(command("duplicateSlide", {
    run: (ctx) => { const id = selectedSlides(ctx)[0]; if (id) void commit(ctx, [{ kind: "duplicate_slide", slide_id: id }]); },
    enabled: (ctx) => mutate(ctx, SLIDE_MUTATION) && selectedSlides(ctx).length === 1,
  }));
  add(command("deleteSlide", {
    run: (ctx) => host?.deleteSlides(selectedSlides(ctx)),
    enabled: (ctx) => mutate(ctx, SLIDE_MUTATION) && hasSlides(ctx) && layoutContext.slideIds.length > selectedSlides(ctx).length,
    risk: "recycle",
  }));
  add(command("layout", { run: dialog("layout"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasSlides(ctx) }));
  add(command("resetLayout", {
    run: (ctx) => {
      const slide = selectedSlides(ctx)[0];
      const layout = slide ? layoutContext.slideLayouts[slide] ?? layoutContext.defaultLayoutId : null;
      if (slide && layout) void commit(ctx, [{ kind: "apply_layout", slide_ids: [slide], layout_id: layout, preserve_content: true }]);
    },
    enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasSlides(ctx),
  }));
  add(command("font", { run: () => host?.focusFormat("font"), enabled: (ctx) => hasShapes(ctx) }));
  add(command("size", { run: () => host?.focusFormat("size"), enabled: (ctx) => hasShapes(ctx) }));
  add(command("bold", { run: (ctx) => { void toggleTextFormat(ctx, "bold"); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("italic", { run: (ctx) => { void toggleTextFormat(ctx, "italic"); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("underline", { run: (ctx) => { void toggleTextFormat(ctx, "underline"); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("textColor", { run: () => host?.pickTextColor(), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("alignLeft", { run: (ctx) => { void setParagraph(ctx, { align: "left" }); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("alignCenter", { run: (ctx) => { void setParagraph(ctx, { align: "center" }); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("alignRight", { run: (ctx) => { void setParagraph(ctx, { align: "right" }); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("bullets", { run: (ctx) => { void toggleList(ctx, "disc"); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("numbering", { run: (ctx) => { void toggleList(ctx, "decimal"); }, enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("arrange", { run: dialog("shape"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx) }));
  add(command("group", {
    labelKey: "officeDeck.groupShape",
    run: (ctx) => { const ids = ctx.selection?.shape_ids ?? []; if (ids.length >= 2) void commit(ctx, [{ kind: "group_shapes", slide_id: ctx.selection!.slide_ids[0], shape_ids: ids }]); },
    enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && (ctx.selection?.shape_ids.length ?? 0) >= 2,
  }));
  add(command("ungroup", {
    run: (ctx) => { const id = ctx.selection?.shape_ids[0]; if (id) void commit(ctx, [{ kind: "ungroup_shapes", slide_id: ctx.selection!.slide_ids[0], group_id: id }]); },
    enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx),
  }));
  add(command("bringFront", {
    run: (ctx) => { if (ctx.selection) void commit(ctx, [{ kind: "arrange_shapes", slide_id: ctx.selection.slide_ids[0], shape_ids: ctx.selection.shape_ids, action: "front" }]); },
    enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx),
  }));
  add(command("sendBack", {
    run: (ctx) => { if (ctx.selection) void commit(ctx, [{ kind: "arrange_shapes", slide_id: ctx.selection.slide_ids[0], shape_ids: ctx.selection.shape_ids, action: "back" }]); },
    enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) && hasShapes(ctx),
  }));

  // Insert / Design
  add(command("textBox", { run: () => host?.insertShape("text"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("picture", { run: dialog("image"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("shape", { run: dialog("shape"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("table", { run: dialog("table"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("chart", { run: dialog("chart"), enabled: (ctx) => mutate(ctx, SHAPE_MUTATION) }));
  add(command("theme", { run: dialog("theme"), enabled: (ctx) => mutate(ctx, "deck_themes") }));
  add(command("master", { run: dialog("theme"), enabled: (ctx) => mutate(ctx, "deck_masters") }));
  add(command("slideSize", { run: dialog("pageSetup"), enabled: (ctx) => mutate(ctx, "deck_themes") }));
  add(command("styleLibrary", {
    run: dialog("styleLibrary"),
    labelKey: "deckStyle.title",
    help: "deck-style-library",
    enabled: (ctx) => canOfficeCommand(ctx.state, "deck_themes", false).enabled,
  }));
  add(command("importStyle", {
    run: dialog("styleLibrary"),
    labelKey: "deckStyle.import",
    help: "deck-importing-styles",
    enabled: (ctx) => canOfficeCommand(ctx.state, "deck_themes", false).enabled,
  }));
  add(command("exportStyle", {
    run: dialog("styleLibrary"),
    labelKey: "deckStyle.export",
    help: "deck-importing-styles",
    enabled: (ctx) => canOfficeCommand(ctx.state, "deck_themes", false).enabled,
  }));

  // Transitions / Animations
  add(command("transition", { run: dialog("transition"), enabled: (ctx) => mutate(ctx, "deck_transitions") }));
  add(command("transitionDuration", { run: dialog("transition"), enabled: (ctx) => mutate(ctx, "deck_transitions") }));
  add(command("advanceClick", { run: dialog("transition"), enabled: (ctx) => mutate(ctx, "deck_transitions") }));
  add(command("advanceAfter", { run: dialog("transition"), enabled: (ctx) => mutate(ctx, "deck_transitions") }));
  add(command("applyTransitionAll", {
    run: (ctx) => {
      const transition = layoutContext.transition;
      const ids = [...layoutContext.slideIds];
      if (transition && ids.length > 0) void commit(ctx, [{ kind: "set_transition", slide_ids: ids, transition }]);
    },
    enabled: (ctx) => mutate(ctx, "deck_transitions") && layoutContext.transition !== null,
  }));
  add(command("animation", { run: dialog("animation"), enabled: (ctx) => mutate(ctx, "deck_animations") && hasShapes(ctx) }));
  add(command("animationPane", { run: view({ comments_open: true }), risk: "read-only" }));
  add(command("animationStart", { run: dialog("animation"), enabled: (ctx) => mutate(ctx, "deck_animations") && hasShapes(ctx) }));
  add(command("animationDuration", { run: dialog("animation"), enabled: (ctx) => mutate(ctx, "deck_animations") && hasShapes(ctx) }));
  add(command("animationDelay", { run: dialog("animation"), enabled: (ctx) => mutate(ctx, "deck_animations") && hasShapes(ctx) }));
  add(command("removeAnimation", {
    run: (ctx) => {
      const shape = ctx.selection?.shape_ids[0];
      const animation = shape ? layoutContext.animationIds[shape] : undefined;
      if (shape && animation && ctx.selection) void commit(ctx, [{ kind: "remove_animation", slide_id: ctx.selection.slide_ids[0], animation_id: animation }]);
    },
    enabled: (ctx) => mutate(ctx, "deck_animations") && hasShapes(ctx),
  }));

  // Slide Show
  const present = (mode: "first" | "current" | "presenter" | "display") => {
    host?.updateView({ active_ribbon_tab: "deck.slideShow" });
    setPresentMode(mode);
    hostOpenPresent();
  };
  add(command("fromBeginning", { run: () => present("first"), enabled: (ctx) => canOfficeCommand(ctx.state, "deck_present", false).enabled, risk: "read-only", help: "presenting-slides" }));
  add(command("fromCurrent", { run: () => present("current"), enabled: (ctx) => canOfficeCommand(ctx.state, "deck_present", false).enabled && hasSlides(ctx), risk: "read-only", help: "presenting-slides" }));
  add(command("presenterView", { run: () => present("presenter"), enabled: (ctx) => canOfficeCommand(ctx.state, "deck_present", false).enabled, risk: "read-only", help: "presenting-slides" }));
  add(command("chooseDisplay", { run: () => present("display"), enabled: (ctx) => canOfficeCommand(ctx.state, "deck_present", false).enabled, risk: "read-only", help: "presenting-slides" }));
  add(command("hideSlide", {
    run: (ctx) => {
      const ids = selectedSlides(ctx);
      if (ids.length === 0) return;
      const hidden = !ids.every((id) => layoutContext.slideHidden[id] === true);
      void commit(ctx, [{ kind: "hide_slides", slide_ids: ids, hidden }]);
    },
    enabled: (ctx) => mutate(ctx, SLIDE_MUTATION) && hasSlides(ctx),
  }));

  // Review / View / Help
  add(command("comment", { run: dialog("comment"), enabled: (ctx) => mutate(ctx, "deck_comments") && hasSlides(ctx) }));
  add(command("reply", { run: dialog("comment"), enabled: (ctx) => mutate(ctx, "deck_comments") }));
  add(command("resolve", { run: dialog("comment"), enabled: (ctx) => mutate(ctx, "deck_comments") }));
  add(command("deleteComment", { run: dialog("comment"), enabled: (ctx) => mutate(ctx, "deck_comments"), risk: "recycle" }));
  add(command("compatibility", { run: dialog("compatibility"), risk: "read-only" }));
  add(command("normal", { run: view({ notes_open: true }), risk: "read-only" }));
  add(command("slideSorter", { run: view({ slides_open: true }), risk: "read-only" }));
  add(command("notes", { run: (ctx) => host?.updateView({ notes_open: !ctx.view.notes_open }), risk: "read-only" }));
  add(command("masterView", { run: dialog("theme"), enabled: (ctx) => mutate(ctx, "deck_masters"), risk: "read-only" }));
  add(command("slidesPane", { run: (ctx) => host?.updateView({ slides_open: !ctx.view.slides_open }), risk: "read-only" }));
  add(command("snap", { run: (ctx) => host?.updateView({ snap: !ctx.view.snap }), risk: "read-only" }));
  add(command("zoom", {
    run: (ctx) => {
      const zoom = ctx.view.viewport.zoom_percent >= 200 ? 100 : ctx.view.viewport.zoom_percent + 25;
      host?.updateView({ viewport: { ...ctx.view.viewport, zoom_percent: zoom } });
    },
    risk: "read-only",
  }));
  add(command("fit", {
    run: (ctx) => host?.updateView({ viewport: { ...ctx.view.viewport, zoom_percent: fitZoomPercent(720, 405, ctx.view.viewport.width_px - 32, ctx.view.viewport.height_px - 32) } }),
    risk: "read-only",
  }));
  add(command("help", { run: help("editing-presentations"), risk: "read-only" }));
  add(command("limits", { run: help("office-compatibility-and-limits"), risk: "read-only" }));
  add(command("shortcuts", { run: help("presenting-slides"), risk: "read-only" }));

  // Keep the shared `always` predicate referenced for readability of the
  // default; it documents that a view-only command has no capability gate.
  void always;
}

// The present commands and the toggle views need a small module bridge to the
// editor without widening the canonical DeckCommandContext.
let presentMode: "first" | "current" | "presenter" | "display" = "first";
let openPresent: (() => void) | null = null;

export function setPresentMode(mode: "first" | "current" | "presenter" | "display"): void {
  presentMode = mode;
}

export function presentModeValue(): typeof presentMode {
  return presentMode;
}

export function setOpenPresent(next: (() => void) | null): void {
  openPresent = next;
}

function hostOpenPresent(): void {
  openPresent?.();
}

// Re-exported for tests and for the editor's own status line; not a second
// implementation of any operation.
export type DeckCommandAnimation = DeckAnimation;
export type { OfficeController };
