import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { OfficeController } from "../OfficeController";
import type { DeckTransition, OfficeTransactionResult } from "../types";

export type DeckTransitionKind = DeckTransition["kind"];

/** Build one typed transition. `fade` at 500 ms is stored exactly, not
 * rounded to a preset bucket. */
export function buildTransition(
  kind: DeckTransitionKind,
  durationMs: number,
  advanceOnClick: boolean,
  advanceAfterMs: number | null,
): DeckTransition {
  const duration = Number.isFinite(durationMs) ? Math.min(10_000, Math.max(0, Math.round(durationMs))) : 0;
  const advance = advanceAfterMs === null || !Number.isFinite(advanceAfterMs)
    ? null
    : Math.min(86_400_000, Math.max(0, Math.round(advanceAfterMs)));
  return {
    kind,
    duration_ms: duration,
    advance_on_click: advanceOnClick,
    advance_after_ms: advance,
  };
}

/** One transaction for exactly the chosen slides. Other slides keep their
 * imported effects untouched. */
export function transitionTransaction(
  controller: OfficeController,
  transition: DeckTransition,
  slideIds: readonly string[],
): Promise<OfficeTransactionResult> {
  if (slideIds.length === 0) throw new Error("office_edit.invalid");
  const state = controller.getState();
  return controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: state.revision,
    operations: [{
      family: "deck",
      operation: { kind: "set_transition", slide_ids: [...slideIds], transition },
    }],
    selection_after: null,
    label_key: "office.transaction",
  });
}

export interface DeckTransitionsProps {
  transition: DeckTransition;
  slideIds: readonly string[];
  disabled: boolean;
  onApply: (transition: DeckTransition) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Transitions dialog (Step 22a T6, D6). Selecting a different effect for a
 * slide is a reviewable edit; imported unsupported effects are preserve-only
 * and are never rewritten by an ordinary save. */
export default function DeckTransitions({
  transition,
  slideIds,
  disabled,
  onApply,
  onClose,
  onOpenHelp,
}: DeckTransitionsProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DeckTransition["kind"]>(transition.kind);
  const [duration, setDuration] = useState(String(transition.duration_ms));
  const [click, setClick] = useState(transition.advance_on_click);
  const [after, setAfter] = useState(transition.advance_after_ms === null ? "" : String(transition.advance_after_ms));

  const kinds: DeckTransition["kind"][] = ["none", "fade", "push", "wipe"];
  return (
    <Dialog title={t("officeDeck.transition")} onClose={onClose} className="adp-deck-transition-dialog">
      <p className="adp-deck-hint">{t("officeDeck.transitionHint")}</p>
      <div className="adp-deck-effect-list" role="radiogroup" aria-label={t("officeDeck.transition")}>
        {kinds.map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={kind === entry}
            className={"adp-deck-effect" + (kind === entry ? " adp-deck-effect--active" : "")}
            onClick={() => setKind(entry)}
          >
            {t(`officeDeck.effect.${entry}`)}
          </button>
        ))}
      </div>
      <label className="adp-deck-field">
        <span>{t("officeDeck.transitionDuration")}</span>
        <input type="number" min={0} max={10000} value={duration} onChange={(event) => setDuration(event.target.value)} />
        <span>ms</span>
      </label>
      <label className="adp-deck-check">
        <input type="checkbox" checked={click} onChange={(event) => setClick(event.target.checked)} />
        <span>{t("officeDeck.advanceClick")}</span>
      </label>
      <label className="adp-deck-field">
        <span>{t("officeDeck.advanceAfter")}</span>
        <input type="number" min={0} max={86400000} value={after} placeholder={t("officeDeck.advanceAfterOff")}
          onChange={(event) => setAfter(event.target.value)} />
        <span>ms</span>
      </label>
      <p className="adp-deck-hint">{t("officeDeck.effectPreservedOnly")}</p>
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("deck-transitions-and-animations")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <span className="adp-deck-hint">{t("officeDeck.slideCount", { count: slideIds.length })}</span>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={disabled || slideIds.length === 0}
          onClick={() => onApply(buildTransition(kind, Number(duration), click, after === "" ? null : Number(after)))}
        >
          {t("officeDeck.applyTransition")}
        </Button>
      </footer>
    </Dialog>
  );
}
