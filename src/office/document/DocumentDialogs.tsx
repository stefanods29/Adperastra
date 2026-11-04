import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import { findOffice } from "../../services/officeEdit";
import type { ExportSnapshot } from "../../services/exportSnapshots";
import type { OfficeController } from "../OfficeController";
import type {
  DocumentOperation, OfficeEditComment, OfficeFindMatch, OfficeFormatting, OfficeSelection,
  OfficeSessionState, OfficeStyleItem,
} from "../types";
import { documentInsertImage, documentInsertLink, documentInsertTable } from "./DocumentInsertDialogs";
import { DocumentParagraphDialog } from "./DocumentParagraphDialog";
import { documentFootnote } from "./DocumentReferenceDialogs";
import { DocumentStyleGallery } from "./DocumentStyleGallery";
import type { DocumentDialogId } from "./documentUiTypes";

function Unsupported({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return <Dialog title={t("office.unsupported")} onClose={onClose}>
    <p>{t("office.unsupported")}</p>
  </Dialog>;
}

function TableDialog({ selection, onApply, onClose }: {
  selection: Extract<OfficeSelection, { kind: "document" }>;
  onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState("");
  const [columns, setColumns] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    setBusy(true); setError(false);
    try {
      const operation = documentInsertTable(selection.span.focus, Number(rows), Number(columns));
      await onApply(operation); onClose();
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.table")} onClose={onClose}>
    <label>{t("officeDoc.table")}<input type="number" min={1} max={100} value={rows} disabled={busy}
      onChange={(event) => setRows(event.target.value)} /></label>
    <label>{t("officeDoc.columns")}<input type="number" min={1} max={100} value={columns} disabled={busy}
      onChange={(event) => setColumns(event.target.value)} /></label>
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || rows === "" || columns === ""} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}

function LinkDialog({ selection, onApply, onClose }: {
  selection: Extract<OfficeSelection, { kind: "document" }>;
  onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    setBusy(true); setError(false);
    try { await onApply(documentInsertLink(selection.span, value)); onClose(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.link")} onClose={onClose}>
    <label>{t("officeDoc.link")}<input type="url" value={value} disabled={busy}
      onChange={(event) => setValue(event.target.value)} /></label>
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || value === ""} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}

function ImageDialog({ selection, pickImage, onApply, onClose }: {
  selection: Extract<OfficeSelection, { kind: "document" }>;
  pickImage?: () => Promise<ExportSnapshot | null>;
  onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!pickImage) return <Unsupported onClose={onClose} />;
  const choose = async () => {
    setBusy(true); setError(false);
    try { const next = await pickImage(); if (next) setSnapshot(next); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!snapshot) return;
    setBusy(true); setError(false);
    try {
      await onApply(documentInsertImage(selection.span.focus, snapshot, Number(width), Number(height), alt));
      onClose();
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.image")} onClose={onClose}>
    <Button disabled={busy} onClick={() => void choose()}>{t("officeDoc.image")}</Button>
    <label>{t("officeDoc.image")}<input type="number" min={1} value={width} disabled={busy}
      onChange={(event) => setWidth(event.target.value)} /></label>
    <label>{t("officeDoc.image")}<input type="number" min={1} value={height} disabled={busy}
      onChange={(event) => setHeight(event.target.value)} /></label>
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || !snapshot || width === "" || height === ""} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}

function CommentDialog({ selection, author, onApply, onClose }: {
  selection: Extract<OfficeSelection, { kind: "document" }>; author: string;
  onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    setBusy(true); setError(false);
    try {
      if (!text.trim() || [...text].length > 16384) throw new Error("office_edit.invalid");
      await onApply({ kind: "comment_add", span: selection.span, text, author });
      onClose();
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.addComment")} onClose={onClose}>
    <textarea aria-label={t("officeDoc.addComment")} value={text} maxLength={16384} disabled={busy}
      onChange={(event) => setText(event.target.value)} />
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || !text.trim()} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}

function FindDialog({ controller, revision, onSelect, onClose }: {
  controller: OfficeController; revision: number;
  onSelect: (selection: OfficeSelection) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<OfficeFindMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const search = async () => {
    setBusy(true); setError(false);
    try {
      if (!query.trim()) throw new Error("office_edit.invalid");
      const page = await findOffice(controller.session_id, {
        query, match_case: false, whole_word: false, scope: "document",
      });
      if (page.revision !== revision) throw new Error("office_edit.changed");
      setMatches(page.items.slice(0, 100));
    } catch { setError(true); setMatches([]); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.find")} onClose={onClose}>
    <input aria-label={t("officeDoc.find")} value={query} disabled={busy}
      onChange={(event) => setQuery(event.target.value)} />
    <Button disabled={busy || !query.trim()} onClick={() => void search()}>{t("officeDoc.find")}</Button>
    {error ? <p role="alert">{t("errors.office_edit.changed")}</p> : null}
    <ul>{matches.map((match) => <li key={match.id}>
      <button type="button" onClick={() => onSelect(match.selection)}>{match.excerpt}</button>
    </li>)}</ul>
  </Dialog>;
}

function PropertiesDialog({ controller, state, onClose }: {
  controller: OfficeController; state: OfficeSessionState; onClose: () => void;
}) {
  const { t } = useTranslation();
  const info = controller.document.info;
  return <Dialog title={t("officeDoc.properties")} onClose={onClose}>
    <ul>
      <li>{info.name}</li>
      <li>{state.format}</li>
      <li>{t(`office.${state.mode}`)}</li>
      <li>{state.dirty ? t("office.unsaved") : t("office.saved")}</li>
      <li>{info.read_only ? t("office.readOnly") : ""}</li>
    </ul>
    <ul>{state.compatibility?.entries?.map((entry) => <li key={entry.feature_id}>
      {entry.feature_id}: {t(entry.message_key)} ({entry.count})
    </li>)}</ul>
  </Dialog>;
}

function FootnoteDialog({ selection, onApply, onClose }: {
  selection: Extract<OfficeSelection, { kind: "document" }>;
  onApply: (operation: DocumentOperation) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const apply = async () => {
    setBusy(true); setError(false);
    try { await onApply(documentFootnote(selection.span.focus, text)); onClose(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <Dialog title={t("officeDoc.footnote")} onClose={onClose}>
    <textarea aria-label={t("officeDoc.footnote")} value={text} maxLength={16384} disabled={busy}
      onChange={(event) => setText(event.target.value)} />
    {error ? <p role="alert">{t("errors.office_edit.invalid")}</p> : null}
    <Button disabled={busy || !text.trim()} onClick={() => void apply()}>{t("officeDoc.apply")}</Button>
  </Dialog>;
}

export interface DocumentDialogsProps {
  controller: OfficeController;
  state: OfficeSessionState;
  selection: OfficeSelection | null;
  formatting: OfficeFormatting | null;
  styles: readonly OfficeStyleItem[];
  comments: readonly OfficeEditComment[];
  dialog: DocumentDialogId | null;
  textKind: "footnote" | "citation" | null;
  onClose: () => void;
  onTextClose: () => void;
  onOperation: (operation: DocumentOperation) => Promise<void>;
  onSelect: (selection: OfficeSelection) => void;
  onPickImage?: () => Promise<ExportSnapshot | null>;
}

export default function DocumentDialogs({
  controller, state, selection, formatting, styles, dialog, textKind,
  onClose, onTextClose, onOperation, onSelect, onPickImage,
}: DocumentDialogsProps) {
  const { t } = useTranslation();
  const live = selection?.kind === "document" && selection.span.revision === state.revision ? selection : null;
  const blocks = live ? [live.span.anchor.block_id] : [];
  if (textKind === "footnote") {
    return live ? <FootnoteDialog selection={live} onApply={onOperation} onClose={onTextClose} /> : null;
  }
  if (textKind === "citation") return <Unsupported onClose={onTextClose} />;
  if (!dialog) return null;
  if (dialog === "paragraph") {
    return <DocumentParagraphDialog blockIds={blocks} onApply={onOperation} onClose={onClose} />;
  }
  if (dialog === "style") {
    return <Dialog title={t("officeDoc.style")} onClose={onClose}>
      <DocumentStyleGallery styles={styles} selectedId={formatting?.style_ids[0] ?? null}
        blockIds={blocks} disabled={blocks.length === 0} onApply={onOperation} />
    </Dialog>;
  }
  if (dialog === "table") {
    return live ? <TableDialog selection={live} onApply={onOperation} onClose={onClose} /> : null;
  }
  if (dialog === "link") {
    return live ? <LinkDialog selection={live} onApply={onOperation} onClose={onClose} /> : null;
  }
  if (dialog === "image") {
    return live ? <ImageDialog selection={live} pickImage={onPickImage} onApply={onOperation} onClose={onClose} /> : null;
  }
  if (dialog === "comment") {
    return live ? <CommentDialog selection={live} author={t("officeDoc.localAuthor")}
      onApply={onOperation} onClose={onClose} /> : null;
  }
  if (dialog === "find") {
    return <FindDialog controller={controller} revision={state.revision} onSelect={onSelect} onClose={onClose} />;
  }
  if (dialog === "properties" || dialog === "compatibility") {
    return <PropertiesDialog controller={controller} state={state} onClose={onClose} />;
  }
  // Page layout, replace, export, print and font reach their typed dialog or
  // host action only when a live engine value exists; never a mock default.
  return <Unsupported onClose={onClose} />;
}
