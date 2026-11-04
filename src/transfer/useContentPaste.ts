import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { createTransfer, releaseTransfer } from "../services/contentTransfer";
import type {
  TransferAction,
  TransferBlock,
  TransferEnvelope,
  TransferErrorCode,
  TransferKind,
  TransferLossKey,
  TransferReceipt,
  TransferTarget,
} from "./types";
import { transferError } from "./types";
import type { TransferRegistry } from "./TransferRegistry";

/** Copy/paste glue for content-transfer-1 (Step 09c T3): the text editor is the only existing mutation target. */
const TEXT_KINDS: readonly TransferKind[] = Object.freeze(["text", "rich_text"] as const);
const NO_LOSSES: readonly TransferLossKey[] = Object.freeze([] as TransferLossKey[]);
const FORMATTING_LOSS: readonly TransferLossKey[] = Object.freeze([
  "transfer.lossFormatting",
] as const);
const TEXT_ACTIONS: readonly TransferAction[] = Object.freeze([
  Object.freeze({ id: "insert_text", label_key: "transfer.insertText", losses: NO_LOSSES, mutates: true } as TransferAction),
]);
const RICH_ACTIONS: readonly TransferAction[] = Object.freeze([
  Object.freeze({ id: "insert_rich_text", label_key: "transfer.insertRich", losses: FORMATTING_LOSS, mutates: true } as TransferAction),
]);
const EMPTY_ACTIONS: readonly TransferAction[] = Object.freeze([]);
const MAX_OFFERS = 64;

/** One source selection ready to become a transfer. */
export interface SelectedTextCopy {
  documentId: string | null;
  text: string;
}
export interface PdfPagesCopy {
  documentId: string | null;
  snapshot: ExportSnapshot;
  pages: readonly number[];
}
export async function copySelectedText(source: SelectedTextCopy): Promise<TransferEnvelope> {
  if (typeof source.text !== "string" || source.text.length === 0) {
    throw transferError("transfer.invalid");
  }
  return createTransfer(source.documentId, { kind: "text", text: source.text });
}
/** PDF viewer copy adapter: one snapshot plus sorted 1-based pages. */
export async function copySelectedPdfPages(source: PdfPagesCopy): Promise<TransferEnvelope> {
  if (!Array.isArray(source.pages) || source.pages.length === 0) {
    throw transferError("transfer.invalid");
  }
  return createTransfer(source.documentId, {
    kind: "pdf_pages",
    snapshot: source.snapshot,
    pages: [...source.pages],
  });
}

/** Flatten the allowlisted rich-text tree for a plain text editor. */
export function plainTextFromBlocks(blocks: readonly TransferBlock[]): string {
  return blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n");
}
export interface TextEditorTargetOptions {
  targetId: string;
  documentId?: string;
  view: EditorView | (() => EditorView | null);
  readOnly: () => boolean;
  /** Optional authoritative 09a revision; without it the adapter counts seen documents. */
  revision?: () => number;
  /** Insertion range, captured on the first describe. */
  selection?: () => { from: number; to: number };
}
export interface TextEditorTarget extends TransferTarget { dispose: () => void; }
interface Offer { revision: number; from: number; to: number; }

function scalarLength(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

function newTransactionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The one existing mutation target: one accept is one CodeMirror
 * transaction, so one undo step and one revision. */
export function createTextEditorTarget(options: TextEditorTargetOptions): TextEditorTarget {
  const viewOf = (): EditorView | null =>
    typeof options.view === "function" ? options.view() : options.view;
  const firstView = viewOf();
  const offers = new Map<string, Offer>();
  const local = { revision: 1, doc: firstView?.state.doc ?? null };
  let disposed = false;
  const currentRevision = (): number => {
    if (options.revision) return options.revision();
    const view = viewOf();
    if (view && view.state.doc !== local.doc) {
      local.doc = view.state.doc;
      local.revision += 1;
    }
    return local.revision;
  };
  const currentRange = (): { from: number; to: number } => {
    if (options.selection) return options.selection();
    const view = viewOf();
    return view ? view.state.selection.main : { from: 0, to: 0 };
  };

  const remember = (transferId: string, revision: number, range: { from: number; to: number }) => {
    if (offers.has(transferId)) return;
    if (offers.size >= MAX_OFFERS) {
      const oldest = offers.keys().next().value;
      if (oldest !== undefined) offers.delete(oldest);
    }
    offers.set(transferId, { revision, from: range.from, to: range.to });
  };
  const actionsFor = (envelope: TransferEnvelope): readonly TransferAction[] => {
    if (envelope.payload.kind === "text") {
      return envelope.payload.text.length === 0 ? EMPTY_ACTIONS : TEXT_ACTIONS;
    }
    if (envelope.payload.kind === "rich_text") {
      return plainTextFromBlocks(envelope.payload.blocks).length === 0
        ? EMPTY_ACTIONS
        : RICH_ACTIONS;
    }
    return EMPTY_ACTIONS;
  };

  return {
    target_id: options.targetId,
    ...(options.documentId === undefined ? {} : { document_id: options.documentId }),
    accepted_kinds: TEXT_KINDS,
    describe: (envelope) => {
      if (disposed || viewOf() === null || options.readOnly()) return EMPTY_ACTIONS;
      const actions = actionsFor(envelope);
      if (actions.length === 0) return EMPTY_ACTIONS;
      if (!offers.has(envelope.transfer_id)) {
        remember(envelope.transfer_id, currentRevision(), currentRange());
      }
      return actions;
    },
    accept: async (envelope, actionId) => {
      if (disposed) throw transferError("transfer.failed");
      if (options.readOnly()) throw transferError("transfer.read_only");
      const view = viewOf();
      if (!view) throw transferError("transfer.failed");
      const expected =
        envelope.payload.kind === "text"
          ? "insert_text"
          : envelope.payload.kind === "rich_text"
            ? "insert_rich_text"
            : null;
      if (expected === null || actionId !== expected) throw transferError("transfer.unsupported");
      const content =
        envelope.payload.kind === "text"
          ? envelope.payload.text
          : envelope.payload.kind === "rich_text"
            ? plainTextFromBlocks(envelope.payload.blocks)
            : "";
      if (content.length === 0) throw transferError("transfer.unsupported");
      const offer = offers.get(envelope.transfer_id);
      offers.delete(envelope.transfer_id);
      if (!offer) throw transferError("transfer.failed");
      if (offer.revision !== currentRevision()) throw transferError("transfer.changed");
      if (disposed) throw transferError("transfer.failed");
      const length = view.state.doc.length;
      const from = Math.min(Math.max(offer.from, 0), length);
      const to = Math.min(Math.max(offer.to, from), length);
      const before = view.state.doc;
      view.dispatch({
        changes: { from, to, insert: content },
        selection: { anchor: from + content.length },
        userEvent: "input.paste",
      });
      if (view.state.doc === before) throw transferError("transfer.failed");
      return Object.freeze({
        transaction_id: newTransactionId(),
        ...(options.documentId === undefined
          ? {}
          : { target_document_id: options.documentId, revision: Math.max(1, currentRevision()) }),
        inserted_count: scalarLength(content),
        losses: envelope.payload.kind === "rich_text" ? [...FORMATTING_LOSS] : [],
        complete: true,
      }) as TransferReceipt;
    },
    dispose: () => {
      disposed = true;
      offers.clear();
    },
  };
}

export interface ContentPasteOptions {
  registry: TransferRegistry;
  targetId: string;
  /** Lease release after commit or cancel. Defaults to E1. */
  release?: (transferId: string) => Promise<void>;
}

export interface ContentPasteChoice {
  envelope: TransferEnvelope;
  actions: readonly TransferAction[];
}

export interface ContentPasteSensitive {
  envelope: TransferEnvelope;
  action: TransferAction;
}

export interface ContentPasteResult {
  choice: ContentPasteChoice | null;
  sensitive: ContentPasteSensitive | null;
  busy: boolean;
  /** Stable `transfer.*` code for the caller's translation. */
  error: string | null;
  paste: (envelope: TransferEnvelope) => Promise<TransferReceipt | null>;
  choose: (actionId: string) => Promise<TransferReceipt | null>;
  confirmSensitive: () => Promise<TransferReceipt | null>;
  cancel: () => void;
  cancelSensitive: () => void;
  clearError: () => void;
}

function toTransferError(error: unknown): Error {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = /^transfer\.[a-z_]+$/.test(message)
    ? (message as TransferErrorCode)
    : "transfer.failed";
  return transferError(code);
}

/** Negotiate one envelope: no action means nothing changes; one runs
 * directly; several wait in `choice`. Sensitive mutations wait for the
 * explicit confirmation before accept, whichever path chose the action. */
export function useContentPaste(options: ContentPasteOptions): ContentPasteResult {
  const { registry, targetId } = options;
  const release = options.release ?? releaseTransfer;
  const mounted = useRef(true);
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const pending = useRef<TransferEnvelope | null>(null);
  const busyRef = useRef(false);
  const choiceRef = useRef<ContentPasteChoice | null>(null);
  const sensitiveRef = useRef<ContentPasteSensitive | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoiceState] = useState<ContentPasteChoice | null>(null);
  const [sensitive, setSensitiveState] = useState<ContentPasteSensitive | null>(null);
  const [error, setErrorState] = useState<string | null>(null);

  const clearDialogs = useCallback(() => {
    choiceRef.current = null;
    sensitiveRef.current = null;
    if (mounted.current) {
      setChoiceState(null);
      setSensitiveState(null);
    }
  }, []);

  const releasePending = useCallback(() => {
    const envelope = pending.current;
    pending.current = null;
    if (envelope) void releaseRef.current(envelope.transfer_id).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releasePending();
      choiceRef.current = null;
      sensitiveRef.current = null;
    };
  }, [releasePending]);

  const cancel = useCallback(() => {
    if (busyRef.current) return;
    releasePending();
    clearDialogs();
  }, [clearDialogs, releasePending]);

  const cancelSensitive = useCallback(() => {
    if (busyRef.current) return;
    releasePending();
    clearDialogs();
  }, [clearDialogs, releasePending]);

  const finish = useCallback(
    async (envelope: TransferEnvelope, actionId: string): Promise<TransferReceipt> => {
      if (busyRef.current) throw transferError("transfer.failed");
      busyRef.current = true;
      if (mounted.current) {
        setBusy(true);
        setErrorState(null);
      }
      try {
        const receipt = await registry.accept(targetId, envelope, actionId);
        pending.current = null;
        void releaseRef.current(envelope.transfer_id).catch(() => undefined);
        clearDialogs();
        return receipt;
      } catch (failure) {
        const stable = toTransferError(failure);
        pending.current = null;
        void releaseRef.current(envelope.transfer_id).catch(() => undefined);
        clearDialogs();
        if (mounted.current) setErrorState(stable.message);
        throw stable;
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [clearDialogs, registry, targetId],
  );

  /** Sensitive content may only reach a mutating action after the explicit
   * disclosure. This is the one gate used by both paste paths. */
  const beginAction = useCallback(
    async (envelope: TransferEnvelope, action: TransferAction): Promise<TransferReceipt | null> => {
      if (envelope.sensitive && action.mutates) {
        pending.current = envelope;
        choiceRef.current = null;
        const next = { envelope, action };
        sensitiveRef.current = next;
        if (mounted.current) {
          setChoiceState(null);
          setSensitiveState(next);
        }
        return null;
      }
      return finish(envelope, action.id);
    },
    [finish],
  );

  const paste = useCallback(
    async (envelope: TransferEnvelope): Promise<TransferReceipt | null> => {
      if (busyRef.current || pending.current) throw transferError("transfer.failed");
      if (mounted.current) setErrorState(null);
      const actions = registry.describe(targetId, envelope);
      if (actions.length === 0) {
        if (mounted.current) setErrorState("transfer.unsupported");
        throw transferError("transfer.unsupported");
      }
      if (actions.length === 1) return beginAction(envelope, actions[0]);
      pending.current = envelope;
      const next = { envelope, actions };
      choiceRef.current = next;
      if (mounted.current) {
        sensitiveRef.current = null;
        setSensitiveState(null);
        setChoiceState(next);
      }
      return null;
    },
    [beginAction, registry, targetId],
  );

  const choose = useCallback(
    async (actionId: string): Promise<TransferReceipt | null> => {
      const current = choiceRef.current;
      if (!current) throw transferError("transfer.failed");
      const action = current.actions.find((entry) => entry.id === actionId);
      if (!action) throw transferError("transfer.unsupported");
      return beginAction(current.envelope, action);
    },
    [beginAction],
  );

  const confirmSensitive = useCallback(async (): Promise<TransferReceipt | null> => {
    const current = sensitiveRef.current;
    if (!current) throw transferError("transfer.failed");
    return finish(current.envelope, current.action.id);
  }, [finish]);

  const clearError = useCallback(() => setErrorState(null), []);

  return {
    choice,
    sensitive,
    busy,
    error,
    paste,
    choose,
    confirmSensitive,
    cancel,
    cancelSensitive,
    clearError,
  };
}
