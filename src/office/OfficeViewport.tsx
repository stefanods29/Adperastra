import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../components/Skeleton";
import { errorText } from "../services/errors";
import { fileUrl } from "../services/files";
import { releaseOfficeLease, renderOffice } from "../services/officeEdit";
import type { OfficeController } from "./OfficeController";
import type {
  OfficeAccessibleNode, OfficeRenderPage, OfficeSelection, OfficeViewport,
} from "./types";

/** Accessible editing surface (20a E9).
 *
 * Only trusted raster tiles and plain accessibility records enter the app
 * DOM. Engine HTML/scripts are never inserted. A stale render revision or a
 * lease from a replaced page is released; a failed render stays an honest
 * error instead of an empty editor. */

export interface OfficeViewportViewProps {
  controller: OfficeController;
  active: boolean;
  revision: number;
  canEditText: boolean;
  selection: OfficeSelection | null;
  onSelection: (selection: OfficeSelection) => void;
  viewport: OfficeViewport;
  onViewport: (viewport: OfficeViewport) => void;
  onOpenHelp: (slug: string) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function nodeSelectable(node: OfficeAccessibleNode): boolean {
  return node.editable && UUID.test(node.id);
}

export function OfficeViewportView({
  controller,
  active,
  revision,
  canEditText,
  selection,
  onSelection,
  viewport,
  onViewport,
  onOpenHelp,
}: OfficeViewportViewProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<OfficeRenderPage[]>([]);
  const [renderedRevision, setRenderedRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<{
    target: NonNullable<OfficeAccessibleNode["document_text"]>;
    value: string;
  } | null>(null);
  const [editError, setEditError] = useState<unknown>(null);
  const [applying, setApplying] = useState(false);
  const leases = useRef<string[]>([]);
  const generation = useRef(0);

  useEffect(() => {
    if (!active) {
      setPages([]);
      return;
    }
    const current = ++generation.current;
    let cancelled = false;
    let job: { cancel: () => Promise<void> } | null = null;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const started = await renderOffice(controller.session_id, viewport);
        job = started;
        if (cancelled) void started.cancel().catch(() => undefined);
        const result = await started.completion;
        if (cancelled || current !== generation.current || result.revision !== revision ||
            result.revision !== controller.getState().revision) {
          for (const page of result.items) {
            void releaseOfficeLease(page.image.lease_id).catch(() => undefined);
          }
          return;
        }
        for (const lease of leases.current) {
          void releaseOfficeLease(lease).catch(() => undefined);
        }
        leases.current = result.items.map((page) => page.image.lease_id);
        setPages(result.items);
        setRenderedRevision(result.revision);
      } catch (caught) {
        if (!cancelled && current === generation.current) setError(caught);
      } finally {
        if (!cancelled && current === generation.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      generation.current += 1;
      void job?.cancel().catch(() => undefined);
      for (const lease of leases.current) {
        void releaseOfficeLease(lease).catch(() => undefined);
      }
      leases.current = [];
      setPages([]);
    };
  }, [
    active, controller, revision, viewport.x_px, viewport.y_px, viewport.width_px,
    viewport.height_px, viewport.zoom_percent, viewport.device_scale, viewport.view_revision,
  ]);

  if (!active) return null;
  if (loading && pages.length === 0) {
    return <div className="adp-office-viewport-loading"><Skeleton variant="tiles" count={2} /></div>;
  }
  if (error) {
    return <p className="adp-office-error" role="alert">{errorText(t, error, "office_edit")}</p>;
  }
  if (pages.length === 0) {
    return <p className="adp-office-viewport-empty">{t("office.unsupported")}</p>;
  }

  const scale = viewport.zoom_percent / 100;
  const selected = selection?.kind === "document" ? selection : null;
  const applyText = async () => {
    if (!draft || applying || !canEditText || draft.value === draft.target.text) return;
    const current = controller.getState();
    if (current.revision !== draft.target.span.revision) {
      setEditError(new Error("office_edit.changed"));
      return;
    }
    setApplying(true);
    setEditError(null);
    try {
      await controller.transact({
        transaction_id: crypto.randomUUID(), expected_revision: current.revision,
        operations: [{ family: "document", operation: {
          kind: "replace_match", span: draft.target.span,
          expected_text: draft.target.text, replacement: draft.value,
        } }],
        selection_after: null, label_key: "office.transaction",
      });
      setDraft(null);
    } catch (caught) {
      setEditError(caught);
    } finally {
      setApplying(false);
    }
  };

  const scroll = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "PageDown" || event.key === "PageUp" ? 400 : 40;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp" || event.key === "PageUp") dy = -step;
    else if (event.key === "ArrowDown" || event.key === "PageDown") dy = step;
    else return;
    event.preventDefault();
    onViewport({
      ...viewport,
      x_px: Math.max(0, viewport.x_px + dx),
      y_px: Math.max(0, viewport.y_px + dy),
    });
  };

  return (
    <div
      className="adp-office-surface adp-office-viewport"
      role="document"
      tabIndex={0}
      aria-label={t("office.ready")}
      onKeyDown={scroll}
    >
      {pages.map((page, index) => (
        <article key={page.page_id} className="adp-office-page" style={{ position: "relative" }}>
          <img
            src={fileUrl(page.image.token, page.image.name)}
            width={Math.max(1, page.rect.width_pt * scale)}
            height={Math.max(1, page.rect.height_pt * scale)}
            alt=""
            draggable={false}
          />
          {page.accessibility.map((node) => {
            if (!node.name && !node.editable) return null;
            const target = node.document_text;
            const canOpenDraft = Boolean(canEditText && nodeSelectable(node) && target &&
              target.span.revision === renderedRevision && renderedRevision === revision);
            const openDraft = () => {
              if (!canOpenDraft || !target || applying ||
                  target.span.revision !== controller.getState().revision) return;
              setEditError(null);
              setDraft({ target, value: target.text });
            };
            const isSelected = selected
              ? selected.span.anchor.block_id === node.id
              : false;
            return (
              <button
                key={node.id}
                type="button"
                className={"adp-office-node" + (isSelected ? " adp-office-node--selected" : "")}
                style={{
                  position: "absolute",
                  left: node.rect.x_pt * scale,
                  top: node.rect.y_pt * scale,
                  width: Math.max(1, node.rect.width_pt * scale),
                  height: Math.max(1, node.rect.height_pt * scale),
                }}
                aria-label={node.name}
                tabIndex={canOpenDraft ? 0 : -1}
                disabled={!nodeSelectable(node) || controller.family !== "document"}
                onClick={() => {
                  if (!nodeSelectable(node) || controller.family !== "document") return;
                  const state = controller.getState();
                  if (!state.ready || state.revision !== renderedRevision) return;
                  const position = { block_id: node.id, offset_utf16: 0 };
                  onSelection({
                    kind: "document",
                    page: index + 1,
                    span: {
                      anchor: position,
                      focus: { ...position },
                      revision: state.revision,
                    },
                  });
                }}
                onDoubleClick={openDraft}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !canOpenDraft) return;
                  event.preventDefault();
                  event.stopPropagation();
                  openDraft();
                }}
              />
            );
          })}
        </article>
      ))}
      <div className="adp-office-page-controls">
        {draft ? (
          <form onSubmit={(event) => { event.preventDefault(); void applyText(); }}
            onKeyDown={(event) => event.stopPropagation()}>
            <textarea aria-label={t("officeDeck.editText")} autoFocus value={draft.value}
              disabled={!canEditText || applying} maxLength={4096}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
            <button className="adp-btn" type="submit"
              disabled={!canEditText || applying || draft.value === draft.target.text}>
              {t("common.apply")}
            </button>
            <button className="adp-btn" type="button" disabled={applying}
              onClick={() => { setDraft(null); setEditError(null); }}>
              {t("common.cancel")}
            </button>
          </form>
        ) : null}
        {editError ? <p role="alert">{errorText(t, editError, "office_edit")}</p> : null}
        <button type="button" className="adp-btn" onClick={() => onOpenHelp("how-office-editing-works")}>
          {t("help.title")}
        </button>
      </div>
    </div>
  );
}
