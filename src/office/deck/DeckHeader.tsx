import { MessageSquare, Redo2, Save, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import DropdownMenu from "../../components/DropdownMenu";
import type { Command } from "../../commands/registry";
import Ribbon from "../../ribbon/Ribbon";
import type { OfficeSessionState } from "../types";
import { canOfficeCommand } from "../officeCompatibility";
import { deckRibbon } from "./deckRibbon";
import type { DeckCommandContext, DeckEditorViewState } from "./deckUiTypes";

export interface DeckHeaderProps {
  title: string;
  active: boolean;
  state: OfficeSessionState;
  view: DeckEditorViewState;
  ctx: DeckCommandContext;
  commands: readonly Command<DeckCommandContext>[];
  onView: (view: DeckEditorViewState) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: (action: "copyPath" | "saveCopy" | "exportPdf") => void;
  onOpenHelp: (slug: string) => void;
}

/** The Office header row (40 px) and the ten-tab ribbon. The existing
 * `Ribbon` draws the data from `deckRibbon()`; the editor only supplies the
 * command context, so all four ribbon docks and Alt key tips stay owned by
 * the shared framework (Step 04b/05c). */
export default function DeckHeader({
  title,
  active,
  state,
  view,
  ctx,
  commands,
  onView,
  onSave,
  onUndo,
  onRedo,
  onShare,
  onOpenHelp,
}: DeckHeaderProps) {
  const { t } = useTranslation();
  const dirty = state.dirty;
  // The canonical OfficeController never advertises save_existing, so this
  // button stays disabled instead of calling a save the controller refuses.
  const canSave = state.capabilities.includes("save_existing");
  const status = !state.ready ? t("officeEdit.loading") : dirty ? t("office.unsaved") : t("office.saved");

  return (
    <div className="adp-deck-header" aria-label={t("officeDeck.header")}>
      <div className="adp-deck-header-row">
        <span className="adp-deck-saved" title={dirty ? t("office.unsaved") : t("office.saved")}>
          <span className={"adp-deck-save-dot" + (dirty ? " adp-deck-save-dot--dirty" : "")} aria-hidden="true" />
          {status}
        </span>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("common.save")}
          title={t("common.save")}
          disabled={!state.ready || !dirty || !canSave}
          onClick={onSave}
        >
          <Save size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("office.undo")}
          title={t("office.undo")}
          disabled={!state.can_undo || state.busy}
          onClick={onUndo}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("office.redo")}
          title={t("office.redo")}
          disabled={!state.can_redo || state.busy}
          onClick={onRedo}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <span className="adp-deck-title" title={title}>{title}</span>
        <span className="adp-deck-mode">{t(`office.${state.mode}`)}</span>
        <span className="adp-deck-header-spacer" />
        <button
          type="button"
          className="adp-btn"
          aria-pressed={view.comments_open}
          aria-label={t("office.comments")}
          onClick={() => onView({ ...view, comments_open: !view.comments_open })}
        >
          <MessageSquare size={14} aria-hidden="true" />
          <span>{t("office.comments")}</span>
        </button>
        <DropdownMenu
          ariaLabel={t("office.share")}
          label={t("office.share")}
          items={[
            { id: "copyPath", label: t("officeDeck.copyFilePath") },
            { id: "saveCopy", label: t("office.saveCopy"), disabled: !canOfficeCommand(state, "save_copy", false).enabled },
            { id: "exportPdf", label: t("office.exportPdf") },
          ]}
          onSelect={(id) => {
            if (id === "copyPath" || id === "saveCopy" || id === "exportPdf") onShare(id);
          }}
        />
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("help.title")}
          title={t("help.title")}
          onClick={() => onOpenHelp("editing-presentations")}
        >
          ?
        </button>
      </div>
      <Ribbon
        def={deckRibbon()}
        ctx={ctx}
        commands={commands}
        accent="powerpoint"
        active={active}
        handlerId="office-slide"
        initialTabId={view.active_ribbon_tab}
        onTabChange={(id) => {
          if (view.active_ribbon_tab !== id) onView({ ...view, active_ribbon_tab: id as DeckEditorViewState["active_ribbon_tab"] });
        }}
      />
    </div>
  );
}
