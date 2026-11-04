import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import { errorCode, errorText } from "../../services/errors";
import {
  endPresentation, onPresentationDisplayLost, onPresentationState, presentationDisplays,
  presentationNavigate, startPresentation,
} from "../../services/presentation";
import type {
  PresentationDisplay, PresentationIntent, PresentationRequest, PresentationState,
} from "../presentationTypes";
import { canOfficeCommand } from "../officeCompatibility";
import type { OfficeController } from "../OfficeController";

/** Display chooser and presenter view (Step 22a T7, D7).
 *
 * Presentation is always an explicit action: the chooser lists the current
 * monitors, requires a selected output display and a confirmation before the
 * separate audience window is created. Monitor 0 is never assumed to be the
 * second screen. The presenter view is the only place where notes are
 * rendered; the audience helper receives slide pixels and black/paused flags
 * only. Escape ends the presentation and restores the editor's focus. */

export interface DeckPresentDialogProps {
  controller: OfficeController;
  visibleSlideIds: readonly string[];
  currentSlideId: string | null;
  notes: string;
  startMode?: "first" | "current" | "presenter" | "display";
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Hidden slides are never part of a normal advance or a first-slide start. */
export function visibleSlideIds(slides: readonly { id: string; hidden: boolean }[]): string[] {
  return slides.filter((slide) => !slide.hidden).map((slide) => slide.id);
}

export function formatPresentationTime(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function displayLabel(display: PresentationDisplay, t: (key: string, options?: Record<string, unknown>) => string): string {
  const size = `${display.rect.width}×${display.rect.height}`;
  return display.primary
    ? t("officeDeck.displayPrimary", { name: display.name, size })
    : t("officeDeck.displayItem", { name: display.name, size });
}

/** Presentation errors use `errors.presentation.*`; an absent editing engine
 * stays in `errors.office_edit.engine_missing` so the user sees the real reason
 * instead of the folder-presentation fallback sentence. */
function presentationErrorText(t: Parameters<typeof errorText>[0], error: unknown): string {
  const code = errorCode(error);
  if (code === "presentation.busy") return t("errors.office_edit.busy");
  return errorText(t, error, code.startsWith("office_edit.") ? "office_edit" : "presentation");
}

export function DeckPresentDialog({
  controller,
  visibleSlideIds,
  currentSlideId,
  notes,
  startMode = "first",
  onClose,
  onOpenHelp,
}: DeckPresentDialogProps) {
  const { t } = useTranslation();
  const [displays, setDisplays] = useState<PresentationDisplay[]>([]);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const [showPresenter, setShowPresenter] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<"chooser" | "live">("chooser");
  const [state, setState] = useState<PresentationState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [monitorLost, setMonitorLost] = useState(false);
  const [clock, setClock] = useState(0);
  const focusBefore = useRef<HTMLElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  const stateRef = useRef<PresentationState | null>(null);
  const livePresentation = useRef<string | null>(null);
  stateRef.current = state;

  // Track the one native presentation this dialog owns so an unmount (for
  // example the tab closing) ends it through the native command instead of
  // leaving the audience helper alive.
  useEffect(() => {
    if (phase === "live" && state && !state.ended) {
      livePresentation.current = state.presentation_id;
    } else {
      livePresentation.current = null;
    }
  }, [phase, state]);

  useEffect(() => () => {
    const id = livePresentation.current;
    livePresentation.current = null;
    if (id) void endPresentation(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void presentationDisplays()
      .then((list) => {
        if (cancelled) return;
        setDisplays(list);
        const first = list[0] ?? null;
        setOutputId((current) => current ?? first?.id ?? null);
      })
      .catch((caught) => { if (!cancelled) setError(caught); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void onPresentationState((next) => {
      // One document owns one session; state from another deck never changes
      // this presenter or its timer.
      if (next.session_id !== controller.session_id) return;
      setState(next);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [controller.session_id]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void onPresentationDisplayLost((presentationId) => {
      const live = stateRef.current;
      if (!live || live.presentation_id !== presentationId) return;
      if (!live.ended) void endPresentation(live.presentation_id).catch(() => undefined);
      setMonitorLost(true);
      setPhase("chooser");
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (phase !== "chooser" || !focusBefore.current) return;
    // The originating control may have been unmounted with the chooser (the
    // Start button itself); then focus returns to the new Start button.
    const target = focusBefore.current.isConnected ? focusBefore.current : startRef.current;
    target?.focus?.();
  }, [phase]);

  useEffect(() => {
    if (phase === "live" && state?.ended) {
      setPhase("chooser");
      onClose();
    }
  }, [onClose, phase, state?.ended]);

  useEffect(() => {
    if (!state || state.paused || state.ended) return;
    setClock(state.elapsed_ms);
    const started = Date.now();
    const timer = window.setInterval(() => setClock(state.elapsed_ms + Date.now() - started), 250);
    return () => window.clearInterval(timer);
  }, [state]);

  const end = async () => {
    if (!state) {
      onClose();
      return;
    }
    try {
      await endPresentation(state.presentation_id);
    } catch {
      // A duplicate end succeeds natively; a failed end still closes the UI.
    }
    setPhase("chooser");
    onClose();
  };

  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const start = async () => {
    if (!outputId || !accepted || visibleSlideIds.length === 0) return;
    if (!canOfficeCommand(controller.getState(), "deck_present", false).enabled) {
      setError(new Error("office.unsupported"));
      return;
    }
    const fromCurrent = startMode === "current" && currentSlideId && visibleSlideIds.includes(currentSlideId);
    const slideId = fromCurrent && currentSlideId ? currentSlideId : visibleSlideIds[0];
    const request: PresentationRequest = {
      slide_id: slideId,
      start_from: fromCurrent ? "current" : "first",
      output_display_id: outputId,
      presenter_display_id: presenterId,
      show_presenter: showPresenter,
    };
    try {
      const started = await startPresentation(controller.session_id, request);
      // The chooser unmounts with the live view, so the focused control must
      // be remembered before the phase change replaces it with <body>.
      focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setState(started);
      setError(null);
      setMonitorLost(false);
      setPhase("live");
    } catch (caught) {
      const code = errorCode(caught);
      setError(caught);
      if (code === "presentation.display_missing") setMonitorLost(true);
    }
  };

  const navigate = async (intent: PresentationIntent) => {
    if (!state) return;
    if (intent.kind === "end") {
      await end();
      return;
    }
    try {
      const next = await presentationNavigate(state.presentation_id, intent);
      setState(next);
      setError(null);
    } catch (caught) {
      const code = errorCode(caught);
      setError(caught);
      if (code === "presentation.display_missing") setMonitorLost(true);
    }
  };

  if (phase === "live" && state) {
    return (
      <section className="adp-deck-presenter" aria-label={t("officeDeck.presenterView")}>
        <header className="adp-deck-presenter-head">
          <span>{t("officeDeck.presenterView")}</span>
          <span className="adp-deck-presenter-time" aria-live="off">{formatPresentationTime(clock)}</span>
          <span>{t("officeDeck.slideStatus", { slide: state.slide_index + 1, total: state.slide_count })}</span>
        </header>
        <div className="adp-deck-presenter-body">
          <div className="adp-deck-presenter-main">
            <p className="adp-deck-hint">{t("officeDeck.presenterNext", { slide: state.slide_index + 2 })}</p>
            <div className="adp-deck-presenter-next" aria-hidden="true" />
            <div className="adp-deck-presenter-actions">
              <Button onClick={() => { void navigate({ kind: "previous" }); }}>{t("officeDeck.previous")}</Button>
              <Button variant="primary" onClick={() => { void navigate({ kind: "next" }); }}>{t("officeDeck.next")}</Button>
              <Button onClick={() => { void navigate({ kind: "toggle_black" }); }} aria-pressed={state.black}>
                {t("officeDeck.black")}
              </Button>
              <Button onClick={() => { void navigate({ kind: "toggle_pause" }); }} aria-pressed={state.paused}>
                {t("officeDeck.pause")}
              </Button>
              <Button onClick={() => { void navigate({ kind: "reset_timer" }); }}>{t("officeDeck.resetTimer")}</Button>
              <Button variant="primary" onClick={() => { void end(); }}>{t("officeDeck.end")}</Button>
            </div>
            <p className="adp-deck-hint">{t("officeDeck.endHint")}</p>
          </div>
          <aside className="adp-deck-presenter-notes" aria-label={t("officeDeck.notes")}>
            <h3>{t("officeDeck.notes")}</h3>
            <p className="adp-deck-private">{t("officeDeck.notesPrivate")}</p>
            <p className="adp-deck-presenter-notestext">{notes}</p>
            <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("presenting-slides")}>
              {t("help.title")}
            </button>
          </aside>
        </div>
        {error ? <p className="adp-deck-error" role="alert">{presentationErrorText(t, error)}</p> : null}
      </section>
    );
  }

  return (
    <Dialog title={t("officeDeck.presentTitle")} onClose={onClose} className="adp-deck-present-dialog">
      <p>{t("officeDeck.presentExplanation")}</p>
      {monitorLost ? <p className="adp-deck-error" role="alert">{t("officeDeck.monitorLost")}</p> : null}
      {error ? <p className="adp-deck-error" role="alert">{presentationErrorText(t, error)}</p> : null}
      <fieldset className="adp-deck-field">
        <legend>{t("officeDeck.outputDisplay")}</legend>
        {displays.length === 0 ? <p>{t("officeDeck.noDisplays")}</p> : null}
        {displays.map((display) => (
          <label key={display.id} className="adp-deck-check">
            <input
              type="radio"
              name="deck-output-display"
              checked={outputId === display.id}
              onChange={() => setOutputId(display.id)}
            />
            <span>{displayLabel(display, t)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="adp-deck-field">
        <legend>{t("officeDeck.presenterDisplay")}</legend>
        <label className="adp-deck-check">
          <input type="radio" name="deck-presenter-display" checked={presenterId === null}
            onChange={() => setPresenterId(null)} />
          <span>{t("officeDeck.presenterMainWindow")}</span>
        </label>
        {displays.map((display) => (
          <label key={display.id} className="adp-deck-check">
            <input type="radio" name="deck-presenter-display" checked={presenterId === display.id}
              onChange={() => setPresenterId(display.id)} />
            <span>{display.name}</span>
          </label>
        ))}
      </fieldset>
      <label className="adp-deck-check">
        <input type="checkbox" checked={showPresenter} onChange={(event) => setShowPresenter(event.target.checked)} />
        <span>{t("officeDeck.showPresenterView")}</span>
      </label>
      <label className="adp-deck-check">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{t("officeDeck.displayConfirm")}</span>
      </label>
      <p className="adp-deck-hint">{t("officeDeck.notesPrivate")}</p>
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("presenting-slides")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" ref={startRef} disabled={!outputId || !accepted || visibleSlideIds.length === 0}
          onClick={() => { void start(); }}>
          {t("officeDeck.startPresentation")}
        </Button>
      </footer>
    </Dialog>
  );
}
