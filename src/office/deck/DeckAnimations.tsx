import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { OfficeController } from "../OfficeController";
import type { DeckAnimation, OfficeSelection, OfficeTransactionResult } from "../types";

export type DeckAnimationKind = DeckAnimation["kind"];

/** Bounded animation value. Unsupported imported effects stay in the engine
 * and are listed as preserved-only; this builder only makes supported ones. */
export function buildAnimation(
  kind: DeckAnimationKind,
  start: DeckAnimation["start"],
  durationMs: number,
  delayMs: number,
  direction: DeckAnimation["direction"],
): DeckAnimation {
  return {
    kind,
    start,
    duration_ms: Math.min(10_000, Math.max(1, Math.round(Number.isFinite(durationMs) ? durationMs : 1))),
    delay_ms: Math.min(86_400_000, Math.max(0, Math.round(Number.isFinite(delayMs) ? delayMs : 0))),
    direction,
  };
}

/** A stale effect id is refused before the operation is sent, so a command
 * cannot remove or replace an effect that belonged to another revision. */
export function assertLiveAnimationId(currentIds: ReadonlySet<string>, animationId: string): void {
  if (!currentIds.has(animationId)) throw new Error("office_edit.changed");
}

export function animationTransaction(
  controller: OfficeController,
  selection: OfficeSelection,
  animationId: string,
  animation: DeckAnimation,
): Promise<OfficeTransactionResult> {
  if (selection.kind !== "deck" || selection.slide_ids.length === 0 || selection.shape_ids.length === 0) {
    throw new Error("office_edit.invalid");
  }
  const state = controller.getState();
  return controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: state.revision,
    operations: [{
      family: "deck",
      operation: {
        kind: "set_animation", slide_id: selection.slide_ids[0],
        shape_id: selection.shape_ids[0], animation_id: animationId, animation,
      },
    }],
    selection_after: null,
    label_key: "office.transaction",
  });
}

export function removeAnimationTransaction(
  controller: OfficeController,
  selection: OfficeSelection,
  animationId: string,
): Promise<OfficeTransactionResult> {
  if (selection.kind !== "deck" || selection.slide_ids.length === 0) throw new Error("office_edit.invalid");
  return controller.transact({
    transaction_id: crypto.randomUUID(),
    expected_revision: controller.getState().revision,
    operations: [{
      family: "deck",
      operation: { kind: "remove_animation", slide_id: selection.slide_ids[0], animation_id: animationId },
    }],
    selection_after: null,
    label_key: "office.transaction",
  });
}

export interface DeckAnimationsProps {
  animation: DeckAnimation | null;
  animationId: string | null;
  hasSelection: boolean;
  currentIds: ReadonlySet<string>;
  disabled: boolean;
  onApply: (animation: DeckAnimation) => void;
  onRemove: (animationId: string) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Animation dialog (Step 22a T6). Only the selected shape is changed; a
 * different slide's effect is never part of this transaction. */
export default function DeckAnimations({
  animation,
  animationId,
  hasSelection,
  currentIds,
  disabled,
  onApply,
  onRemove,
  onClose,
  onOpenHelp,
}: DeckAnimationsProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DeckAnimation["kind"]>(animation?.kind ?? "fade");
  const [start, setStart] = useState<DeckAnimation["start"]>(animation?.start ?? "on_click");
  const [duration, setDuration] = useState(String(animation?.duration_ms ?? 500));
  const [delay, setDelay] = useState(String(animation?.delay_ms ?? 0));
  const [direction, setDirection] = useState<DeckAnimation["direction"]>(animation?.direction ?? "left");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t("officeDeck.animation")} onClose={onClose} className="adp-deck-animation-dialog">
      <p className="adp-deck-hint">{t("officeDeck.animationHint")}</p>
      {!hasSelection ? <p className="adp-deck-hint">{t("officeDeck.animationNeedsShape")}</p> : null}
      <label className="adp-deck-field">
        <span>{t("officeDeck.animation")}</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as DeckAnimation["kind"])}>
          {(["appear", "fade", "fly", "spin"] as const).map((entry) => (
            <option key={entry} value={entry}>{t(`officeDeck.effect.${entry}`)}</option>
          ))}
        </select>
      </label>
      <label className="adp-deck-field">
        <span>{t("officeDeck.animationStart")}</span>
        <select value={start} onChange={(event) => setStart(event.target.value as DeckAnimation["start"])}>
          {(["on_click", "with_previous", "after_previous"] as const).map((entry) => (
            <option key={entry} value={entry}>{t(`officeDeck.animationStartOption.${entry}`)}</option>
          ))}
        </select>
      </label>
      <div className="adp-deck-grid-fields">
        <label className="adp-deck-field">
          <span>{t("officeDeck.animationDuration")}</span>
          <input type="number" min={1} max={10000} value={duration} onChange={(event) => setDuration(event.target.value)} />
        </label>
        <label className="adp-deck-field">
          <span>{t("officeDeck.animationDelay")}</span>
          <input type="number" min={0} max={86400000} value={delay} onChange={(event) => setDelay(event.target.value)} />
        </label>
      </div>
      <label className="adp-deck-field">
        <span>{t("officeDeck.directionLabel")}</span>
        <select value={direction} onChange={(event) => setDirection(event.target.value as DeckAnimation["direction"])}>
          {(["left", "right", "up", "down"] as const).map((entry) => (
            <option key={entry} value={entry}>{t(`officeDeck.direction.${entry}`)}</option>
          ))}
        </select>
      </label>
      {error ? <p className="adp-deck-error" role="alert">{error}</p> : null}
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("deck-transitions-and-animations")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        {animationId ? (
          <Button
            onClick={() => {
              try {
                assertLiveAnimationId(currentIds, animationId);
                onRemove(animationId);
              } catch (caught) {
                setError(t("errors.office_edit.changed"));
              }
            }}
          >
            {t("officeDeck.removeAnimation")}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={disabled || !hasSelection}
          onClick={() => onApply(buildAnimation(kind, start, Number(duration), Number(delay), direction))}
        >
          {t("officeDeck.applyAnimation")}
        </Button>
      </footer>
    </Dialog>
  );
}
