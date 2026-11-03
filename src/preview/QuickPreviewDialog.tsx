import { ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import IconButton from "../components/IconButton";
import PreviewSurface, { PreviewFallback } from "../components/PreviewSurface";
import Skeleton from "../components/Skeleton";
import type { ExplorerItem } from "../services/explorer";
import { extensionOf, type FileTypeInfo } from "../services/files";
import { previewDetect } from "../services/previewAccess";
import { isTauriRuntime } from "../services/settings";
import { previewItemAt, previewNeighbors } from "./previewNavigation";
import type { PreviewSelection } from "./useQuickPreview";

/** How long before words join the skeleton (rules.md R-UI-2). */
export const QUICK_PREVIEW_SLOW_MS = 1000;

export type { PreviewSelection } from "./useQuickPreview";

export interface QuickPreviewProps {
  selection: PreviewSelection;
  onClose: () => void;
  /** The normal explicit open pipeline; called after the dialog closes. */
  onOpen: (path: string) => Promise<void>;
  onOpenHelp: (slug: string) => void;
}

function fallbackInfo(item: ExplorerItem): FileTypeInfo {
  return {
    path: item.path,
    name: item.name,
    ext: extensionOf(item.name),
    mime: "",
    size: item.size,
    modified_unix: item.modified_unix,
    online_only: item.online_only,
    read_only: false,
    from_internet: false,
  };
}

function isEditable(target: HTMLElement): boolean {
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

/** The Space preview window (Step 07b D1/E4): one per Explorer tab, 960x720
 * at most, with the current filename, read-only content, previous/next,
 * Open and Close. The item list behind it is inert while it is open. */
export function QuickPreviewDialog({
  selection,
  onClose,
  onOpen,
  onOpenHelp,
}: QuickPreviewProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [path, setPath] = useState(selection.path);
  const item = previewItemAt(selection.items, path);
  const neighbors = previewNeighbors(selection.items, path);
  const [info, setInfo] = useState<FileTypeInfo | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setDetectFailed(false);
    setSlow(false);
    if (!item) {
      setDetectFailed(true);
      return () => undefined;
    }
    if (item.online_only) {
      setInfo(fallbackInfo(item));
      return () => undefined;
    }
    const timer = window.setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, QUICK_PREVIEW_SLOW_MS);
    if (!isTauriRuntime()) { setDetectFailed(true); window.clearTimeout(timer); return; }
    previewDetect(item.path)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setDetectFailed(true);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [item]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const overlay = dialog?.parentElement;
    if (!dialog || !overlay) return;
    const saved: Array<[HTMLElement, boolean]> = [];
    let branch: HTMLElement = overlay;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          // Remember the actual previous state; `inert` is a boolean, not
          // "the value it happened to have when we first read it".
          saved.push([sibling, Boolean(sibling.inert)]);
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const contain = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("focusin", contain);
      for (const [element, inert] of saved) element.inert = inert;
    };
  }, []);

  // Focus enters the dialog and cycles inside it (D1).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.focus({ preventScroll: true });
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = focusable(dialog);
      if (list.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onTab);
    return () => dialog.removeEventListener("keydown", onTab);
  }, []);

  const go = (direction: "previous" | "next") => {
    const target = direction === "previous" ? neighbors.previous : neighbors.next;
    if (target) setPath(target);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep every key inside the modal; owner-level shortcut scopes are also
    // disabled while open. A child handler may already have consumed it.
    event.stopPropagation();
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const target = event.target as HTMLElement;
    if (isEditable(target) || target.closest("video, audio, [role=slider]")) return;
    if (event.key === " ") {
      // A focused button uses Space itself; anywhere else Space closes.
      if (target.closest("button, a")) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go("previous");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go("next");
    }
  };

  const openFile = async () => {
    if (!item) return;
    onClose();
    try {
      await onOpen(item.path);
    } catch {
      // The Explorer's normal open flow reports its own translated error.
    }
  };

  const title = item ? item.name : path.split(/[\\/]/).pop() ?? path;

  return (
    <div
      className="adp-preview-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="adp-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="adp-preview-header">
          <span className="adp-preview-icon" aria-hidden="true">
            <Eye size={16} />
          </span>
          <h2 className="adp-preview-title" id={titleId} title={title}>
            {title}
          </h2>
          <div className="adp-preview-actions">
            <IconButton
              icon={ChevronLeft}
              labelKey="preview.previous"
              shortcut="Left"
              disabled={neighbors.previous === null}
              onClick={() => go("previous")}
            />
            <IconButton
              icon={ChevronRight}
              labelKey="preview.next"
              shortcut="Right"
              disabled={neighbors.next === null}
              onClick={() => go("next")}
            />
            <Button variant="primary" onClick={() => void openFile()} disabled={!item}>
              {t("preview.open")}
            </Button>
            <IconButton
              icon={X}
              labelKey="components.closeDialog"
              shortcut="Esc"
              onClick={onClose}
            />
          </div>
        </header>
        <div className="adp-preview-body">
          {info ? (
            <PreviewSurface
              info={info}
              sourceRevision={item}
              active
              onOpen={() => openFile()}
              onOpenHelp={onOpenHelp}
            />
          ) : detectFailed ? (
            <PreviewFallback name={title} onOpen={openFile} onOpenHelp={onOpenHelp} />
          ) : (
            <div className="adp-preview-loading" role="status" aria-label={t("preview.loading")}>
              <Skeleton variant="rows" count={6} />
              {slow ? <p className="adp-preview-loading-text">{t("preview.loading")}</p> : null}
            </div>
          )}
        </div>
        <footer className="adp-preview-footer">{t("preview.readOnly")}</footer>
      </div>
    </div>
  );
}

export default QuickPreviewDialog;
