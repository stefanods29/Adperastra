import { redo as redoCommand, redoDepth, undo as undoCommand, undoDepth } from "@codemirror/commands";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { decodeText, detectEncoding, type EncodingName } from "../handlers/text/encoding";
import { editableExtensions, readOnlyExtensions, spellcheckAttributes } from "../handlers/text/editorSetup";
import type { SaveHandle } from "../handlers/types";
import { errorCode, errorText } from "../services/errors";
import { fileDetect, type FileTypeInfo } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import { deleteDraft, readDraft, writeDraft, type Draft } from "../services/recovery";
import { pickSavePath, saveText } from "../services/textFiles";
import {
  canSaveEncoding,
  defaultLineEnding,
  defaultSaveEncoding,
  firstUnmappable,
  joinLines,
  readOnlyReason,
  SAVE_ENCODING_LABELS,
  singleByteTable,
  type LineEndingChoice,
  type ReadOnlyReason,
  type SaveEncodingId,
} from "./saveEncoding";

/** One text document in a tab (Step 06a): loads, edits, saves, keeps
 * recovery copies. Used by the text and Markdown views. */

/** How long after the last change a recovery copy is written. */
export const DRAFT_DELAY_MS = 2000;
const SAMPLE_CHARS = 65_536;
const PART_BYTES = 1024 * 1024;

export interface TextDocumentOptions {
  info: FileTypeInfo;
  /** Where the file's bytes are served. */
  url: string;
  /** The tab is visible. */
  active: boolean;
  protectedView: boolean;
  /** Parts mode and the current part (text viewer only). */
  paged: boolean;
  part: number;
  /** Extra extensions (language, wrap, line numbers) from the caller. */
  extensions?: Extension[];
  phrases: Record<string, string>;
  spellcheck: boolean;
  lang: string;
  onDirtyChange?: (dirty: boolean) => void;
  registerSave?: (handle: SaveHandle | null) => void;
  onPathChange?: (path: string) => void;
  onTextChange?: (text: string) => void;
}

export interface TextDocumentResult {
  hostRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<EditorView | null>;
  encoding: EncodingName | null;
  setReadEncoding: (encoding: EncodingName) => void;
  saveEncoding: SaveEncodingId;
  setSaveEncoding: (encoding: SaveEncodingId) => void;
  lineEnding: LineEndingChoice;
  setLineEnding: (ending: LineEndingChoice) => void;
  readOnly: ReadOnlyReason | null;
  dirty: boolean;
  failed: boolean;
  cursor: { line: number; column: number; lines: number };
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  discard: () => void;
  conflict: boolean;
  resolveConflict: (choice: "overwrite" | "reload" | "cancel") => void;
  notice: string | null;
  clearNotice: () => void;
  draft: Draft | null;
  restoreDraft: () => void;
  discardDraft: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

async function fetchBytes(url: string, range?: { start: number; end: number }): Promise<Uint8Array> {
  const response = await fetch(url, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined);
  if (!response.ok) throw new Error("files.read_failed");
  return new Uint8Array(await response.arrayBuffer());
}

export function useTextDocument(options: TextDocumentOptions): TextDocumentResult {
  const { t } = useTranslation();
  const { info, url, active, protectedView, paged, part, spellcheck, lang } = options;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartment = useRef({ editable: new Compartment(), spellcheck: new Compartment() });
  const bytesRef = useRef<Uint8Array | null>(null);
  const baselineRef = useRef<EditorState["doc"] | null>(null);
  const expectedRef = useRef({ modified_unix: info.modified_unix, size: info.size });
  const saveEncodingRef = useRef<SaveEncodingId>("utf-8");
  const lineEndingRef = useRef<LineEndingChoice>("crlf");
  const savedEncodingRef = useRef<SaveEncodingId>("utf-8");
  const savedEndingRef = useRef<LineEndingChoice>("crlf");
  const encodingRef = useRef<EncodingName | null>(null);
  const readOnlyRef = useRef<ReadOnlyReason | null>(null);
  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const tooLargeRef = useRef(false);
  const draftTimer = useRef<number | null>(null);
  const conflictResolve = useRef<((saved: boolean) => void) | null>(null);

  const [encoding, setEncodingState] = useState<EncodingName | null>(null);
  const [saveEncoding, setSaveEncodingState] = useState<SaveEncodingId>("utf-8");
  const [lineEnding, setLineEndingState] = useState<LineEndingChoice>("crlf");
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, lines: 1 });
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const readOnly: ReadOnlyReason | null =
    !loaded || encoding === null
      ? null
      : readOnlyReason({ paged, protectedView, readOnly: info.read_only, encoding });
  readOnlyRef.current = readOnly;

  // Latest values for the callbacks registered once.
  const live = useRef({ options, t, conflictResolve });
  live.current = { options, t, conflictResolve };

  const applyDirty = useCallback((next: boolean) => {
    if (dirtyRef.current === next) return;
    dirtyRef.current = next;
    setDirty(next);
    live.current.options.onDirtyChange?.(next);
  }, []);

  const computeDirty = useCallback((state: EditorState): boolean => {
    const baseline = baselineRef.current;
    if (!baseline) return false;
    return (
      !state.doc.eq(baseline) ||
      saveEncodingRef.current !== savedEncodingRef.current ||
      lineEndingRef.current !== savedEndingRef.current
    );
  }, []);

  const keepDraft = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !dirtyRef.current) return;
    try {
      await writeDraft(live.current.options.info.path, view.state.doc.toString(), expectedRef.current.modified_unix);
    } catch (error) {
      if (errorCode(error) === "recovery.too_large" && !tooLargeRef.current) {
        tooLargeRef.current = true;
        setNotice(errorText(live.current.t, error, "recovery"));
      }
    }
  }, []);

  const scheduleDraft = useCallback(() => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      void keepDraft();
    }, DRAFT_DELAY_MS);
  }, [keepDraft]);

  // Create the editor once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = compartment.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          c.editable.of(readOnlyExtensions({ phrases: live.current.options.phrases })),
          c.spellcheck.of(spellcheckAttributes(false, "en")),
          ...(live.current.options.extensions ?? []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const loading = update.transactions.some((tr) => tr.annotation(Transaction.userEvent) === "adp.load");
              if (!loading) {
                applyDirty(computeDirty(update.state));
                scheduleDraft();
              }
              live.current.options.onTextChange?.(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setCursor({ line: line.number, column: head - line.from + 1, lines: update.state.doc.lines });
            }
            if (update.docChanged) {
              setCanUndo(undoDepth(update.state) > 0);
              setCanRedo(redoDepth(update.state) > 0);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [applyDirty, computeDirty, scheduleDraft]);

  // Load the bytes: the whole file, or the current part in parts mode.
  useEffect(() => {
    let cancelled = false;
    const start = part * PART_BYTES;
    const request = paged
      ? fetchBytes(url, { start, end: Math.min(info.size, start + PART_BYTES) - 1 })
      : fetchBytes(url);
    request
      .then((bytes) => {
        if (cancelled) return;
        const detected = detectEncoding(bytes.subarray(0, SAMPLE_CHARS));
        const chosen = encodingRef.current ?? detected.encoding;
        encodingRef.current = chosen;
        bytesRef.current = bytes;
        setEncodingState(chosen);
        const text = decodeText(bytes, chosen);
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: 0 },
          userEvent: "adp.load",
        });
        view.scrollDOM.scrollTop = 0;
        baselineRef.current = view.state.doc;
        const saved = defaultSaveEncoding(chosen, detected.bomLength > 0);
        saveEncodingRef.current = saved;
        savedEncodingRef.current = saved;
        setSaveEncodingState(saved);
        const ending = defaultLineEnding(text.slice(0, SAMPLE_CHARS));
        lineEndingRef.current = ending;
        savedEndingRef.current = ending;
        setLineEndingState(ending);
        expectedRef.current = { modified_unix: info.modified_unix, size: info.size };
        loadedRef.current = true;
        setLoaded(true);
        applyDirty(false);
        if (!paged) {
          void readDraft(info.path)
            .then((found) => {
              if (cancelled || !found) return;
              if (found.text !== view.state.doc.toString()) setDraft(found);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, paged, part, info.size, info.path, info.modified_unix, applyDirty]);

  // Editing turns on when the text is loaded and nothing keeps it read-only.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const phrases = live.current.options.phrases;
    const extensions = readOnly === null && loaded ? editableExtensions({ phrases }) : readOnlyExtensions({ phrases });
    view.dispatch({ effects: compartment.current.editable.reconfigure(extensions) });
  }, [readOnly, loaded]);

  // The webview's own spelling checker.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: compartment.current.spellcheck.reconfigure(spellcheckAttributes(spellcheck, lang)) });
  }, [spellcheck, lang]);

  // A hidden tab keeps its unsaved text as a recovery copy at once.
  useEffect(() => {
    if (active || !dirtyRef.current) return;
    void keepDraft();
  }, [active, keepDraft]);

  const setSaveEncoding = (next: SaveEncodingId) => {
    saveEncodingRef.current = next;
    setSaveEncodingState(next);
    const view = viewRef.current;
    if (view) applyDirty(computeDirty(view.state));
  };

  const setLineEnding = (next: LineEndingChoice) => {
    lineEndingRef.current = next;
    setLineEndingState(next);
    const view = viewRef.current;
    if (view) applyDirty(computeDirty(view.state));
  };

  const setReadEncoding = (next: EncodingName) => {
    if (dirtyRef.current) return;
    const view = viewRef.current;
    encodingRef.current = next;
    setEncodingState(next);
    const bytes = bytesRef.current;
    if (!view || !bytes) return;
    const text = decodeText(bytes, next);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: 0 },
      userEvent: "adp.load",
    });
    baselineRef.current = view.state.doc;
    const ending = defaultLineEnding(text.slice(0, SAMPLE_CHARS));
    lineEndingRef.current = ending;
    savedEndingRef.current = ending;
    setLineEndingState(ending);
    applyDirty(false);
  };

  const encodeForSave = (
    doc: EditorState["doc"],
  ): { text: string; encoding: SaveEncodingId; table: string[] | null } | null => {
    const text = joinLines(doc.toJSON(), lineEndingRef.current);
    const encoding = saveEncodingRef.current;
    const table = singleByteTable(encoding);
    if (table) {
      const bad = firstUnmappable(text, table);
      if (bad) {
        setNotice(
          live.current.t("editor.unmappable", {
            char: bad.char,
            line: bad.line,
            column: bad.column,
            encoding: SAVE_ENCODING_LABELS[encoding],
          }),
        );
        return null;
      }
    }
    return { text, encoding, table };
  };

  const performSave = async (force: boolean): Promise<boolean> => {
    const view = viewRef.current;
    if (!view) return false;
    const doc = view.state.doc;
    const encoded = encodeForSave(doc);
    if (!encoded) return false;
    const expected = expectedRef.current;
    try {
      const result = await saveText({
        path: live.current.options.info.path,
        text: encoded.text,
        encoding: encoded.encoding,
        table: encoded.table,
        mode: "save",
        expected_modified_unix: expected.modified_unix,
        expected_size: expected.size,
        force,
      });
      baselineRef.current = doc;
      savedEncodingRef.current = encoded.encoding;
      savedEndingRef.current = lineEndingRef.current;
      expectedRef.current = { modified_unix: result.modified_unix, size: result.size };
      await deleteDraft(live.current.options.info.path).catch(() => undefined);
      applyDirty(computeDirty(view.state));
      return true;
    } catch (error) {
      if (errorCode(error) === "textSave.changed_on_disk") {
        setConflict(true);
        return new Promise<boolean>((resolve) => {
          live.current.conflictResolve.current = resolve;
        });
      }
      setNotice(errorText(live.current.t, error, "textSave"));
      return false;
    }
  };

  const reloadFromDisk = async (): Promise<void> => {
    try {
      const bytes = await fetchBytes(url);
      const view = viewRef.current;
      if (!view) return;
      const chosen = encodingRef.current ?? detectEncoding(bytes.subarray(0, SAMPLE_CHARS)).encoding;
      bytesRef.current = bytes;
      const text = decodeText(bytes, chosen);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        userEvent: "adp.load",
      });
      baselineRef.current = view.state.doc;
      const ending = defaultLineEnding(text.slice(0, SAMPLE_CHARS));
      lineEndingRef.current = ending;
      savedEndingRef.current = ending;
      setLineEndingState(ending);
      if (isTauriRuntime()) {
        const fresh = await fileDetect(live.current.options.info.path).catch(() => null);
        if (fresh) expectedRef.current = { modified_unix: fresh.modified_unix, size: fresh.size };
      }
      applyDirty(false);
    } catch {
      setNotice(errorText(live.current.t, "textSave.other", "textSave"));
    }
  };

  const resolveConflictNow = (choice: "overwrite" | "reload" | "cancel") => {
    setConflict(false);
    const resolve = live.current.conflictResolve.current;
    live.current.conflictResolve.current = null;
    if (choice === "overwrite") {
      void performSave(true).then((saved) => resolve?.(saved));
      return;
    }
    if (choice === "reload") {
      void deleteDraft(live.current.options.info.path).catch(() => undefined);
      void reloadFromDisk().then(() => resolve?.(false));
      return;
    }
    resolve?.(false);
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!loadedRef.current || readOnlyRef.current !== null) return false;
    return performSave(false);
    // performSave and the refs above always read the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAs = useCallback(async (): Promise<boolean> => {
    const view = viewRef.current;
    if (!view || paged || !loadedRef.current) return false;
    const doc = view.state.doc;
    const current = encodingRef.current;
    const chosen = await pickSavePath(
      live.current.t("editor.saveAsTitle"),
      live.current.options.info.name,
      live.current.t("editor.allFiles"),
    );
    if (!chosen) return false;
    const text = joinLines(doc.toJSON(), lineEndingRef.current);
    const encoding: SaveEncodingId =
      current !== null && !canSaveEncoding(current) ? "utf-8" : saveEncodingRef.current;
    const table = singleByteTable(encoding);
    if (table) {
      const bad = firstUnmappable(text, table);
      if (bad) {
        setNotice(
          live.current.t("editor.unmappable", {
            char: bad.char,
            line: bad.line,
            column: bad.column,
            encoding: SAVE_ENCODING_LABELS[encoding],
          }),
        );
        return false;
      }
    }
    try {
      const result = await saveText({
        path: chosen,
        text,
        encoding,
        table,
        mode: "saveAs",
        expected_modified_unix: null,
        expected_size: null,
        force: false,
      });
      baselineRef.current = doc;
      savedEncodingRef.current = encoding;
      savedEndingRef.current = lineEndingRef.current;
      expectedRef.current = { modified_unix: result.modified_unix, size: result.size };
      await deleteDraft(live.current.options.info.path).catch(() => undefined);
      if (result.path !== live.current.options.info.path) {
        live.current.options.onPathChange?.(result.path);
      }
      applyDirty(computeDirty(view.state));
      return true;
    } catch (error) {
      setNotice(errorText(live.current.t, error, "textSave"));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged]);

  const discard = useCallback(() => {
    const view = viewRef.current;
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = null;
    void deleteDraft(live.current.options.info.path).catch(() => undefined);
    if (view) baselineRef.current = view.state.doc;
    applyDirty(false);
  }, [applyDirty]);

  // The tab's close flow gets one stable handle.
  const saveRef = useRef(save);
  saveRef.current = save;
  const discardRef = useRef(discard);
  discardRef.current = discard;
  const stableSave = useCallback(() => saveRef.current(), []);
  const stableDiscard = useCallback(() => discardRef.current(), []);

  useEffect(() => {
    const options = live.current.options;
    options.registerSave?.({ save: stableSave, discard: stableDiscard });
    return () => {
      live.current.options.registerSave?.(null);
      live.current.options.onDirtyChange?.(false);
    };
  }, [stableSave, stableDiscard]);

  const restoreDraft = () => {
    const found = draft;
    const view = viewRef.current;
    if (!found || !view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: found.text },
      selection: { anchor: 0 },
      userEvent: "input",
    });
    applyDirty(computeDirty(view.state));
    setDraft(null);
  };

  const discardDraft = () => {
    void deleteDraft(live.current.options.info.path).catch(() => undefined);
    setDraft(null);
  };

  return {
    hostRef,
    viewRef,
    encoding,
    setReadEncoding,
    saveEncoding,
    setSaveEncoding,
    lineEnding,
    setLineEnding,
    readOnly,
    dirty,
    failed,
    cursor,
    save,
    saveAs,
    discard,
    conflict,
    resolveConflict: resolveConflictNow,
    notice,
    clearNotice: () => setNotice(null),
    draft,
    restoreDraft,
    discardDraft,
    canUndo,
    canRedo,
    undo: () => {
      const view = viewRef.current;
      if (view) undoCommand(view);
    },
    redo: () => {
      const view = viewRef.current;
      if (view) redoCommand(view);
    },
  };
}
