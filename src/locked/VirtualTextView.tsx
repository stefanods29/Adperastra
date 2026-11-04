import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VirtualViewProps } from "../documents/types";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import {
  LOCKED_TEXT_HANDLER_ID,
  commitLockedBytes,
  loadLockedOriginal,
} from "../documents/LockedDocumentProvider";
import {
  editableExtensions,
  readOnlyExtensions,
  runFind,
} from "../handlers/text/editorSetup";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";

const MAX_VIRTUAL_TEXT = 256 * 1024 * 1024;
const MAX_HEX_PREVIEW = 64 * 1024;

function dominantLineEnding(text: string): "\r\n" | "\n" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf >= lf ? "\r\n" : "\n";
}

function decodeText(bytes: Uint8Array): { text: string; bom: boolean } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  return { text: new TextDecoder("utf-8").decode(body), bom };
}

/** Text editing inside a locked container (Step 09k D13). It reuses the 06a
 * CodeMirror presentation and the one 09a shared model; it never receives a
 * path and never writes an ordinary draft or cache. */
export function VirtualTextView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const lineEnding = useRef<"\r\n" | "\n">("\r\n");
  const loading = useRef(true);
  const saveTimer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let handle: { release(): void } | null = null;
    setReady(false);
    setFailed(null);
    loading.current = true;
    void (async () => {
      try {
        handle = await DocumentRegistry.acquireEditor(
          props.document.source,
          LOCKED_TEXT_HANDLER_ID,
        );
        const bytes = await loadLockedOriginal(props.document.id);
        if (!alive || !host.current) return;
        if (bytes.length > MAX_VIRTUAL_TEXT) throw new Error("locked.too_large");
        const decoded = decodeText(bytes);
        lineEnding.current = dominantLineEnding(decoded.text);
        const extensions = props.previewOnly || props.document.info.read_only
          ? readOnlyExtensions({ phrases: {} })
          : editableExtensions({ phrases: {} });
        const saveKey = Prec.highest(
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                setNotice(t("errors.locked.save_copy_required"));
                return true;
              },
            },
          ]),
        );
        const viewInstance = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: decoded.text,
            extensions: [
              saveKey,
              extensions,
              EditorView.updateListener.of((update) => {
                if (!update.docChanged || loading.current) return;
                if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
                saveTimer.current = window.setTimeout(() => {
                  saveTimer.current = null;
                  const current = view.current?.state.doc.toString();
                  if (current === undefined) return;
                  const text = current.replace(/\n/g, lineEnding.current);
                  const encoded = new TextEncoder().encode(text);
                  void commitLockedBytes(props.document.id, encoded).catch((error) => {
                    setNotice(errorText(t, error, "locked"));
                  });
                }, 120);
              }),
            ],
          }),
        });
        view.current = viewInstance;
        loading.current = false;
        setReady(true);
        props.onStatus({ items: [t("locked.inMemory")] });
      } catch (error) {
        if (!alive) return;
        setFailed(errorText(t, error, "locked"));
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const current = view.current?.state.doc.toString();
      view.current?.destroy();
      view.current = null;
      if (current !== undefined) {
        const text = current.replace(/\n/g, lineEnding.current);
        void commitLockedBytes(props.document.id, new TextEncoder().encode(text))
          .catch(() => undefined)
          .finally(() => handle?.release());
      } else {
        handle?.release();
      }
    };
    // The source object is the document identity; the id is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.document.id]);

  useEffect(() => {
    if (!view.current || !props.find.text) return;
    const moved = props.find.request > 0;
    runFind(
      view.current,
      props.find.text,
      moved ? (props.find.backwards ? "previous" : "next") : "here",
      props.find.options,
    );
  }, [props.find.request, props.find.text, props.find.backwards, props.find.options]);

  if (failed) {
    return (
      <div className="adp-locked-view adp-locked-view-error" role="alert">
        {failed}
      </div>
    );
  }
  return (
    <div className="adp-locked-view">
      {!ready && <Skeleton variant="rows" count={8} />}
      <div ref={host} className="adp-locked-editor" aria-label={props.document.info.name} />
      {notice && (
        <div className="adp-locked-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

/** Read-only image presentation from an authorized memory range. */
export function VirtualImageView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const bytes = await loadLockedOriginal(props.document.id);
        if (bytes.length > MAX_VIRTUAL_TEXT) throw new Error("locked.too_large");
        const blob = new Blob([bytes.slice().buffer], {
          type: props.document.info.mime || "application/octet-stream",
        });
        objectUrl = URL.createObjectURL(blob);
        if (alive) setUrl(objectUrl);
      } catch (error) {
        if (alive) setFailed(errorText(t, error, "locked"));
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.document.id, props.document.info.mime, t]);
  if (failed) return <div className="adp-locked-view-error" role="alert">{failed}</div>;
  if (!url) return <Skeleton variant="rows" count={4} />;
  return (
    <div className="adp-locked-view adp-locked-image">
      <img src={url} alt={props.document.info.name} />
      <p className="adp-locked-note">{t("locked.inMemory")}</p>
    </div>
  );
}

/** Bounded read-only hex presentation; bytes never leave memory. */
export function VirtualHexView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const length = Math.min(props.document.info.size, MAX_HEX_PREVIEW);
        const bytes = length === 0
          ? new Uint8Array(0)
          : await props.document.readRange(0, length);
        const limited = bytes.subarray(0, MAX_HEX_PREVIEW);
        const rows: string[] = [];
        for (let offset = 0; offset < limited.length; offset += 16) {
          const row = limited.subarray(offset, offset + 16);
          const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
          const ascii = Array.from(row, (byte) =>
            byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".",
          ).join("");
          rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
        }
        if (alive) setLines(rows);
      } catch (error) {
        if (alive) setFailed(errorText(t, error, "locked"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.document.id, t]);
  if (failed) return <div className="adp-locked-view-error" role="alert">{failed}</div>;
  if (!lines) return <Skeleton variant="rows" count={8} />;
  return (
    <div className="adp-locked-view adp-locked-hex" role="region" aria-label={props.document.info.name}>
      <pre>{lines.join("\n")}</pre>
      <p className="adp-locked-note">{t("locked.limits")}</p>
    </div>
  );
}

/** Choose the presenter allowed for a virtual entry; everything else is
 * explicitly unsupported until its own guide adds a memory-safe adapter. */
export function virtualPresenterFor(info: { mime: string; ext: string }): "text" | "image" | "hex" | null {
  if (
    info.mime.startsWith("text/") ||
    ["txt", "log", "md", "markdown", "csv", "tsv", "json", "xml", "ini", "cfg"].includes(info.ext)
  ) {
    return "text";
  }
  if (info.mime.startsWith("image/") && info.mime !== "image/svg+xml") return "image";
  if (["bin", "dat", "hex"].includes(info.ext) || info.mime === "application/octet-stream") return "hex";
  return null;
}
