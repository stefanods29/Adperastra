import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronLeft, ChevronRight, Hash, Scan, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import type { Command } from "../../commands/registry";
import { formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { lineNumbers, readOnlyExtensions, runFind } from "./editorSetup";
import { decodeText, detectEncoding, ENCODING_LABELS, ENCODINGS, lineEndingOf, type EncodingName } from "./encoding";
import { languageIdFor, loadLanguage } from "./languages";

/** Files above this size open in parts ("large file mode", read-only). */
export const LARGE_TEXT_BYTES = 10 * 1024 * 1024;
/** Size of one part in large file mode. */
export const PART_BYTES = 1024 * 1024;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3;

interface SavedTextState {
  wrap: boolean;
  numbers: boolean;
  zoom: number;
}

interface TextCtx {
  ready: boolean;
  wrap: boolean;
  numbers: boolean;
  zoom: number;
  paged: boolean;
  part: number;
  parts: number;
}

function readSaved(state: unknown): SavedTextState {
  const value = (state ?? {}) as Partial<SavedTextState>;
  return {
    wrap: typeof value.wrap === "boolean" ? value.wrap : false,
    numbers: typeof value.numbers === "boolean" ? value.numbers : true,
    zoom: typeof value.zoom === "number" ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value.zoom)) : 1,
  };
}

async function fetchBytes(url: string, range?: { start: number; end: number }): Promise<Uint8Array> {
  const response = await fetch(url, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined);
  if (!response.ok) throw new Error(`files.read_failed`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Text and code viewer (Step 04b): CodeMirror, read-only, with syntax
 * colors loaded per type, word wrap, line numbers, zoom, encodings, find,
 * and a large-file mode that shows the file in 1 MB parts. */
export default function TextView({ info, url, active, savedState, onStateChange, onStatus, onOpenInWindowsApp, find }: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartments = useRef({ language: new Compartment(), wrap: new Compartment(), numbers: new Compartment() });
  const [settings, setSettings] = useState<SavedTextState>(() => readSaved(savedState));
  const [encoding, setEncoding] = useState<EncodingName | null>(null);
  const [lineEnding, setLineEnding] = useState<"crlf" | "lf" | "mixed" | "none">("none");
  const [cursor, setCursor] = useState({ line: 1, column: 1, lines: 1 });
  const [failed, setFailed] = useState(false);
  const [part, setPart] = useState(0);
  const [loaded, setLoaded] = useState<Uint8Array | null>(null);
  const paged = info.size > LARGE_TEXT_BYTES;
  const parts = paged ? Math.ceil(info.size / PART_BYTES) : 1;

  const update = useCallback(
    (patch: Partial<SavedTextState>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        onStateChange(next);
        return next;
      });
    },
    [onStateChange],
  );

  // Create the editor once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = compartments.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          readOnlyExtensions({
            phrases: {
              "current match": t("text.cm.currentMatch"),
              "on line": t("text.cm.onLine"),
              "Control character": t("text.cm.controlCharacter"),
            },
          }),
          c.language.of([]),
          c.wrap.of(settings.wrap ? EditorView.lineWrapping : []),
          c.numbers.of(settings.numbers ? lineNumbers() : []),
          EditorView.updateListener.of((change) => {
            if (!change.selectionSet && !change.docChanged) return;
            const head = change.state.selection.main.head;
            const line = change.state.doc.lineAt(head);
            setCursor({ line: line.number, column: head - line.from + 1, lines: change.state.doc.lines });
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; settings are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the bytes: the whole file, or the current part in large file mode.
  useEffect(() => {
    let cancelled = false;
    const start = part * PART_BYTES;
    const request = paged ? fetchBytes(url, { start, end: Math.min(info.size, start + PART_BYTES) - 1 }) : fetchBytes(url);
    request
      .then((bytes) => {
        if (cancelled) return;
        setEncoding((current) => current ?? detectEncoding(bytes.subarray(0, 65536)).encoding);
        setLoaded(bytes);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, paged, part, info.size]);

  // Show the loaded bytes in the chosen encoding.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !loaded || !encoding) return;
    const text = decodeText(loaded, encoding);
    setLineEnding(lineEndingOf(text.slice(0, 65536)));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    view.scrollDOM.scrollTop = 0;
  }, [loaded, encoding]);

  // Syntax colors, loaded once per file type.
  useEffect(() => {
    const id = languageIdFor(info.name);
    if (!id) return;
    let cancelled = false;
    void loadLanguage(id).then((language) => {
      const view = viewRef.current;
      if (!cancelled && view) view.dispatch({ effects: compartments.current.language.reconfigure(language) });
    });
    return () => {
      cancelled = true;
    };
  }, [info.name]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        compartments.current.wrap.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
        compartments.current.numbers.reconfigure(settings.numbers ? lineNumbers() : []),
      ],
    });
  }, [settings.wrap, settings.numbers]);

  // The file tab's search box.
  const lastRequest = useRef(find.request);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const moved = find.request !== lastRequest.current;
    lastRequest.current = find.request;
    runFind(view, find.text, moved ? (find.backwards ? "previous" : "next") : "here");
  }, [find.text, find.request, find.backwards]);

  // Status bar.
  useEffect(() => {
    const items = [t("text.position", { line: cursor.line, column: cursor.column }), t("text.lines", { count: cursor.lines })];
    if (encoding) items.push(ENCODING_LABELS[encoding]);
    if (lineEnding !== "none") items.push(t(`text.lineEnding.${lineEnding}`));
    if (paged) items.push(t("text.part", { part: part + 1, parts }));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [cursor, encoding, lineEnding, paged, part, parts, info.size, i18n.language, onStatus, t]);

  const ctx: TextCtx = { ready: encoding !== null, wrap: settings.wrap, numbers: settings.numbers, zoom: settings.zoom, paged, part, parts };
  const zoomBy = (factor: number) => update({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(settings.zoom * factor * 10) / 10)) });

  const commands = useMemo<Command<TextCtx>[]>(
    () => [
      { id: "text.zoomIn", labelKey: "viewer.zoomIn", icon: ZoomIn, shortcut: "Ctrl+=", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom < ZOOM_MAX, run: () => zoomBy(1.1) },
      { id: "text.zoomOut", labelKey: "viewer.zoomOut", icon: ZoomOut, shortcut: "Ctrl+-", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom > ZOOM_MIN, run: () => zoomBy(1 / 1.1) },
      { id: "text.zoomReset", labelKey: "viewer.zoomReset", icon: Scan, shortcut: "Ctrl+0", risk: "read-only", helpSlug: "viewing-text", enabledWhen: (c) => c.zoom !== 1, run: () => update({ zoom: 1 }) },
      { id: "text.wordWrap", labelKey: "text.wordWrap", icon: WrapText, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.wrap, enabledWhen: () => true, run: (c) => update({ wrap: !c.wrap }) },
      { id: "text.lineNumbers", labelKey: "text.lineNumbers", icon: Hash, risk: "read-only", helpSlug: "viewing-text", checkKind: "toggle", checkedWhen: (c) => c.numbers, enabledWhen: () => true, run: (c) => update({ numbers: !c.numbers }) },
      { id: "text.previousPart", labelKey: "text.previousPart", icon: ChevronLeft, shortcut: "Alt+PageUp", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part > 0, run: () => setPart((value) => Math.max(0, value - 1)) },
      { id: "text.nextPart", labelKey: "text.nextPart", icon: ChevronRight, shortcut: "Alt+PageDown", risk: "read-only", helpSlug: "viewing-text", visibleWhen: (c) => c.paged, enabledWhen: (c) => c.part < c.parts - 1, run: () => setPart((value) => Math.min(parts - 1, value + 1)) },
    ],
    // zoomBy and update only read state through their arguments and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.zoom, parts, update],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "zoom",
            labelKey: "ribbon.zoom",
            controls: [
              { type: "button", command: "text.zoomIn", showLabel: false, keyTip: "I" },
              { type: "button", command: "text.zoomOut", showLabel: false, keyTip: "O" },
              { type: "button", command: "text.zoomReset", showLabel: false, keyTip: "R" },
            ],
          },
          {
            id: "show",
            labelKey: "ribbon.show",
            controls: [
              { type: "toggle", command: "text.wordWrap", keyTip: "W" },
              { type: "toggle", command: "text.lineNumbers", keyTip: "N" },
            ],
          },
          {
            id: "encoding",
            labelKey: "text.encoding",
            controls: [
              {
                type: "custom",
                id: "encoding",
                render: () => (
                  <label className="adp-ribbon-custom">
                    {t("text.encoding")}
                    <select value={encoding ?? "utf-8"} onChange={(event) => setEncoding(event.target.value as EncodingName)}>
                      {ENCODINGS.map((name) => (
                        <option key={name} value={name}>
                          {ENCODING_LABELS[name]}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              },
            ],
          },
          {
            id: "parts",
            labelKey: "text.parts",
            controls: [
              { type: "button", command: "text.previousPart", keyTip: "P" },
              { type: "button", command: "text.nextPart", keyTip: "X" },
            ],
          },
        ],
      },
    ],
  };

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      {paged ? (
        <div className="adp-text-notice" role="note">
          {t("text.largeFileNotice", { size: formatSize(PART_BYTES, i18n.language) })}
        </div>
      ) : null}
      {failed ? (
        <div className="adp-viewer-message" role="alert">
          <p>{t("text.loadError")}</p>
          <Button variant="primary" onClick={onOpenInWindowsApp}>
            {t("fileTab.openInWindowsApp")}
          </Button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="adp-text-host"
        hidden={failed}
        style={{ ["--adp-text-zoom" as string]: String(settings.zoom) }}
      />
    </ViewerFrame>
  );
}
