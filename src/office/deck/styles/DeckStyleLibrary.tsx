import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../../../components/Skeleton";
import { errorText } from "../../../services/errors";
import {
  listDeckStylesWithHistory,
  removeDeckStyleWithHistory,
} from "../deckStyleHost";
import type { OfficeController } from "../../OfficeController";
import { BUILTIN_DECK_STYLES } from "./builtins";
import { StyleCard } from "./StyleCard";
import { StyleDetails } from "./StyleDetails";
import { deckStyleIsReadyToApply } from "./styleFonts";
import { previewCanApply } from "./stylePreview";
import { applyDeckStyle, prepareDeckStyle } from "./styleApplication";
import { warningText } from "./styleWarningText";
import {
  DeckStyleError,
  type DeckStyle,
  type DeckStyleCatalog,
  type DeckStylePreview,
} from "./styleTypes";

/** E3: the 560 px style library. It never receives a document path and never
 * renders active document content: previews are synthetic palette/layout
 * labels. Apply is disabled when the deck is read-only, fonts are missing, or
 * composition reports no native style host (E4/E5 absent). */

export interface DeckStyleLibraryProps {
  controller: OfficeController;
  selectedSlideIds: readonly string[];
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
  /** Coordinator wiring: choose a template/file and open StyleImportDialog. */
  onRequestImport?: (kind: "template" | "file") => void | Promise<void>;
  /** Coordinator wiring: choose a save path and call exportStyleFile. */
  onRequestExport?: (style: DeckStyle) => void | Promise<void>;
  /** Bumped after an import saved a style; re-reads the catalog without
   * remounting the panel or moving focus. */
  refreshToken?: number;
  /** Composition gate: false while no approved native style host is
   * registered, so Apply stays disabled instead of failing later. */
  applyAvailable?: boolean;
}

export type Scope = "whole" | "selected";

export function DeckStyleLibrary({
  controller,
  selectedSlideIds,
  onClose,
  onOpenHelp,
  onRequestImport,
  onRequestExport,
  refreshToken,
  applyAvailable = true,
}: DeckStyleLibraryProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<DeckStyleCatalog | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("whole");
  const [focused, setFocused] = useState(0);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeckStylePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => restoreFocus.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    listDeckStylesWithHistory()
      .then((next) => {
        if (active) setCatalog(next);
      })
      .catch((caught) => {
        if (active) setLoadError(caught);
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (selectedSlideIds.length === 0 && scope === "selected") setScope("whole");
  }, [scope, selectedSlideIds.length]);

  const styles = useMemo(() => {
    const all = [...BUILTIN_DECK_STYLES, ...(catalog?.styles ?? [])];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter((style) => {
      const name = style.name_key ? t(style.name_key) : (style.name ?? "");
      return name.toLocaleLowerCase().includes(needle);
    });
  }, [catalog, query, t]);

  const state = controller.getState();
  const canEdit =
    applyAvailable &&
    state.family === "deck" &&
    state.mode === "editing" &&
    state.ready &&
    !state.busy &&
    state.capabilities.includes("deck_themes");

  const ineligibleReason = (style: DeckStyle): string | null => {
    if (!deckStyleIsReadyToApply(style)) return "deckStyle.missingFont";
    if (!canEdit) return "deckStyle.applyDisabled";
    return null;
  };

  const runApply = async (style: DeckStyle) => {
    if (ineligibleReason(style) !== null || busy) return;
    setBusy(true);
    setError(null);
    setStatusKey(null);
    try {
      const prepared = await prepareDeckStyle(
        controller,
        style,
        scope === "whole" ? null : [...selectedSlideIds],
      );
      if (prepared.warnings.length > 0) {
        setPreview(prepared);
      } else {
        await applyDeckStyle(controller, prepared);
        setStatusKey("deckStyle.applied");
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const confirmPreview = async () => {
    if (!preview || !previewCanApply(preview) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await applyDeckStyle(controller, preview);
      setPreview(null);
      setStatusKey("deckStyle.applied");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const removeStyle = async (style: DeckStyle) => {
    if (!catalog || style.builtin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await removeDeckStyleWithHistory(style.id, catalog.revision, catalog);
      setCatalog(next);
      setDetailsId(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  /** A coordinator-owned picker/import runs here; its failure stays inside
   * the library instead of closing the presentation view. */
  const requestImport = async (kind: "template" | "file") => {
    if (!onRequestImport) return;
    setError(null);
    try {
      await onRequestImport(kind);
      setCatalog(await listDeckStylesWithHistory());
    } catch (caught) { setError(caught); }
  };

  const requestExport = async (style: DeckStyle) => {
    if (!onRequestExport) return;
    setError(null);
    try {
      await onRequestExport(style);
    } catch (caught) { setError(caught); }
  };

  useEffect(() => {
    if (focused >= styles.length) setFocused(Math.max(0, styles.length - 1));
  }, [focused, styles.length]);

  const moveFocus = (next: number) => {
    if (styles.length === 0) return;
    const bounded = (next + styles.length) % styles.length;
    setFocused(bounded);
    cardRefs.current[bounded]?.querySelector<HTMLElement>('[role="option"]')?.focus();
  };

  const gridStep = (): number => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return 2;
    return window.matchMedia("(max-width: 600px)").matches ? 1 : 2;
  };

  const gridKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(index - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(index + gridStep());
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(index - gridStep());
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(styles.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        if (detailsId) setDetailsId(null);
        else if (preview) setPreview(null);
        else onClose();
        break;
      default:
        break;
    }
  };

  const detailsStyle = styles.find((style) => style.id === detailsId) ?? null;
  const selectedSlidesLabel = selectedSlideIds.length;

  return (
    <section
      className="adp-deck-style-library"
      aria-label={t("deckStyle.title")}
      aria-busy={busy}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.key !== "Escape") return;
        event.preventDefault();
        if (detailsId) setDetailsId(null);
        else if (preview) setPreview(null);
        else onClose();
      }}
    >
      <header className="adp-deck-style-library-header">
        <h2>{t("deckStyle.title")}</h2>
        <button type="button" onClick={() => onOpenHelp("deck-style-library")} aria-label={t("help.title")}>
          ?
        </button>
        <button type="button" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </header>

      <div className="adp-deck-style-library-scope" role="radiogroup" aria-label={t("deckStyle.title")}>
        <label>
          <input type="radio" name="deck-style-scope" checked={scope === "whole"} onChange={() => setScope("whole")} />
          {t("deckStyle.whole")}
        </label>
        <label>
          <input
            type="radio"
            name="deck-style-scope"
            checked={scope === "selected"}
            disabled={selectedSlidesLabel === 0}
            onChange={() => setScope("selected")}
          />
          {t("deckStyle.selected")}
        </label>
      </div>

      <div className="adp-deck-style-library-tools">
        <input
          type="search"
          value={query}
          placeholder={t("deckStyle.search")}
          aria-label={t("deckStyle.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" disabled={!onRequestImport} onClick={() => void requestImport("template")}>
          {t("deckStyle.import")}
        </button>
        <button type="button" disabled={!onRequestImport} onClick={() => void requestImport("file")}>
          {t("deckStyle.importFile")}
        </button>
      </div>

      {loadError ? (
        <p className="adp-deck-style-library-error" role="alert">
          {errorText(t, loadError, "deck_style")}
        </p>
      ) : null}

      {catalog === null && !loadError ? (
        <Skeleton variant="tiles" count={4} />
      ) : (
        <div className="adp-deck-style-library-grid" role="listbox" aria-label={t("deckStyle.title")}>
          {styles.map((style, index) => {
            const reason = ineligibleReason(style);
            return (
              <div key={style.id} ref={(element) => { cardRefs.current[index] = element; }}>
                <StyleCard
                  style={style}
                  focused={focused === index}
                  selected={detailsId === style.id}
                  eligible={reason === null}
                  ineligibleReason={reason}
                  onFocus={() => setFocused(index)}
                  onApply={() => void runApply(style)}
                  onDetails={() => setDetailsId(style.id)}
                  onKeyDown={(event) => gridKeyDown(event, index)}
                />
              </div>
            );
          })}
        </div>
      )}

      {detailsStyle ? (
        <StyleDetails
          style={detailsStyle}
          eligible={ineligibleReason(detailsStyle) === null}
          ineligibleReason={ineligibleReason(detailsStyle)}
          canRemove={!detailsStyle.builtin && catalog !== null}
          canExport={onRequestExport !== undefined}
          onApply={() => void runApply(detailsStyle)}
          onClose={() => setDetailsId(null)}
          onRemove={() => void removeStyle(detailsStyle)}
          onExport={() => void requestExport(detailsStyle)}
        />
      ) : null}

      {preview ? (
        <div className="adp-deck-style-review" role="alertdialog" aria-labelledby="deck-style-review-title">
          <h3 id="deck-style-review-title">{t("deckStyle.overflow")}</h3>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning.id}>{warningText(t, warning)}</li>
            ))}
          </ul>
          <button type="button" onClick={() => void confirmPreview()} disabled={!previewCanApply(preview) || busy}>
            {t("deckStyle.apply")}
          </button>
          <button type="button" onClick={() => setPreview(null)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="adp-deck-style-library-error" role="alert">
          {errorText(t, error, "deck_style")}
        </p>
      ) : null}
      <p className="adp-deck-style-library-status" role="status" aria-live="polite">
        {statusKey ? t(statusKey) : busy ? t("deckStyle.applying") : ""}
      </p>
    </section>
  );
}

/** Stable UI ordering shared with tests: built-ins first in table order,
 * then user styles by name. */
export function libraryStyles(catalog: DeckStyleCatalog | null): readonly DeckStyle[] {
  const user = [...(catalog?.styles ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return [...BUILTIN_DECK_STYLES, ...user];
}

export function deckStyleIneligible(style: DeckStyle, canEdit: boolean): string | null {
  if (!deckStyleIsReadyToApply(style)) return "deckStyle.missingFont";
  if (!canEdit) return "deckStyle.applyDisabled";
  return null;
}

export function styleScopeIds(scope: Scope, selectedSlideIds: readonly string[]): string[] | null {
  if (scope === "whole") return null;
  if (selectedSlideIds.length === 0) throw new DeckStyleError("deck_style.invalid");
  return [...selectedSlideIds];
}
