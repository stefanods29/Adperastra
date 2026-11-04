import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeController } from "../../OfficeController";
import { BUILTIN_DECK_STYLES } from "../styles/builtins";
import {
  DECK_AI_ACTIONS,
  type DeckAiAction,
  type DeckAiOutline,
  type DeckAiPreparedRequest,
  type DeckAiRequest,
  type DeckAiSource,
  type DeckAiSuggestion,
} from "./deckAiTypes";
import { DeckAiOutlineEditor } from "./DeckAiOutlineEditor";
import { DeckAiPreview } from "./DeckAiPreview";
import { DeckAiWarnings } from "./DeckAiWarnings";
import {
  acceptDeckSuggestion,
  generateDeckSuggestion,
  prepareDeckSuggestion,
  previewEditedDeckSuggestion,
  releaseDeckSuggestion,
} from "../../../services/deckAi";
import { AssistantOutboundConsentHost } from "../../../assistant/AssistantOutboundConsentHost";
import { errorText } from "../../../services/errors";

/** E9: accessible AI review. Send is separate from Accept; editing the
 * outline invalidates the preview and any payload consent; result arrival
 * never steals focus. */

export interface DeckAiPanelProps {
  controller: OfficeController | null;
  initialAction: DeckAiAction;
  source: DeckAiSource | null;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

function emptyOutline(action: DeckAiAction): DeckAiOutline {
  return {
    schema_id: "deck.outline.v1",
    action,
    suggested_style_id: null,
    rationale: "",
    slides: [],
    layout_choices: [],
  };
}

export function DeckAiPanel({ controller, initialAction, source, onClose, onOpenHelp }: DeckAiPanelProps) {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState<DeckAiAction>(initialAction);
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [styleId, setStyleId] = useState(BUILTIN_DECK_STYLES[0].id);
  const [prepared, setPrepared] = useState<DeckAiPreparedRequest | null>(null);
  const [suggestion, setSuggestion] = useState<DeckAiSuggestion | null>(null);
  const [outline, setOutline] = useState<DeckAiOutline>(emptyOutline(initialAction));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [consentSent, setConsentSent] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const topicRef = useRef<HTMLInputElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const job = useRef<{ cancel: () => Promise<void> } | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    topicRef.current?.focus();
    return () => {
      void Promise.resolve(job.current?.cancel()).catch(() => undefined);
      restoreFocus.current?.focus();
    };
  }, []);

  const request = useMemo((): DeckAiRequest | null => {
    if ((action === "shorten" || action === "layout") && !source) return null;
    const effective: DeckAiSource =
      source ?? { kind: "outline", text: sourceText };
    if (effective.kind === "outline" && effective.text.trim().length === 0) return null;
    if (action === "add" && topic.trim().length === 0) return null;
    return {
      action,
      source: effective,
      style_id: action === "style" ? null : styleId,
      topic,
      locale: i18n.language === "es" ? "es" : "en",
      slide_count: slideCount,
      include_speaker_notes: includeNotes,
      request_revision: 1,
    };
  }, [action, i18n.language, includeNotes, slideCount, source, sourceText, styleId, topic]);

  const edit = (next: DeckAiOutline) => {
    setOutline(next);
    setSuggestion((current) => (current ? { ...current, preview: null, status: "editing" } : current));
    setPrepared(null);
    setConsentSent(false);
    setReviewOpen(false);
    setStatus(null);
  };

  const start = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextPrepared = await prepareDeckSuggestion(controller, request);
      setPrepared(nextPrepared);
      setSuggestion(null);
      setConsentSent(false);
      setReviewOpen(false);
      if (nextPrepared.outbound_preview.backend === "local") {
        const handle = await generateDeckSuggestion(nextPrepared.id, null);
        job.current = handle;
        const generated = await handle.completion;
        setSuggestion(generated);
        setOutline(generated.outline);
        setStatus("deckAi.created");
      } else if (nextPrepared.outbound_preview.requires_consent) {
        setReviewOpen(true);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const sendApi = async (consentId: string) => {
    if (!prepared || busy) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await generateDeckSuggestion(prepared.id, consentId);
      job.current = handle;
      const generated = await handle.completion;
      setSuggestion(generated);
      setOutline(generated.outline);
      setStatus("deckAi.created");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const acceptOutbound = (consentId: string) => {
    setReviewOpen(false);
    setConsentSent(true);
    void sendApi(consentId);
  };

  const preview = async () => {
    if (!suggestion || busy) return;
    setBusy(true);
    setError(null);
    try {
      const handle = await previewEditedDeckSuggestion(controller, suggestion.id, outline);
      const next = await handle.completion;
      setSuggestion(next);
      setStatus(next.preview ? "deckAi.previewChanges" : "deckAi.unverified");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!suggestion || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptDeckSuggestion(controller, suggestion.id);
      setStatus("deckAi.created");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await Promise.resolve(job.current?.cancel()).catch(() => undefined);
    job.current = null;
    setBusy(false);
  };

  const discard = async () => {
    if (suggestion) await releaseDeckSuggestion(suggestion.id).catch(() => undefined);
    setSuggestion(null);
    setPrepared(null);
    setConsentSent(false);
    setReviewOpen(false);
    setOutline(emptyOutline(action));
    setStatus(null);
  };

  const headers = {
    create: "deckAi.create",
    add: "deckAi.add",
    shorten: "deckAi.shorten",
    notes: "deckAi.notes",
    layout: "deckAi.layout",
    style: "deckAi.style",
  } as const;

  return (
    <section
      className="deck-ai-panel"
      aria-label={t("deckAi.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The consent host owns Escape while its modal review is open.
        if (reviewOpen) return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select")) {
          event.preventDefault();
          target.blur();
          return;
        }
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="deck-ai-header">
        <h2>{t("deckAi.title")}</h2>
        <button type="button" aria-label={t("help.title")} onClick={() => onOpenHelp("creating-slides-with-ai")}>
          ?
        </button>
        <button type="button" aria-label={t("common.close")} onClick={onClose}>
          ×
        </button>
      </header>

      <div className="deck-ai-actions" role="toolbar" aria-label={t("deckAi.title")}>
        {DECK_AI_ACTIONS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={action === item}
            onClick={() => {
              setAction(item);
              setOutline(emptyOutline(item));
              setSuggestion(null);
              setPrepared(null);
              setConsentSent(false);
              setReviewOpen(false);
            }}
          >
            {t(headers[item])}
          </button>
        ))}
      </div>

      <div className="deck-ai-source">
        {!source && (action === "create" || action === "add" || action === "notes") ? (
          <label>
            <span>{t("deckAi.source")}</span>
            <textarea
              value={sourceText}
              maxLength={24000}
              onChange={(event) => setSourceText(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <span>{t("deckAi.topic")}</span>
          <input ref={topicRef} type="text" maxLength={2000} value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
        <label>
          <span>{t("deckAi.slideCount")}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={slideCount}
            onChange={(event) => setSlideCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
          />
        </label>
        <label>
          <span>{t("deckStyle.name")}</span>
          <select value={styleId} onChange={(event) => setStyleId(event.target.value)}>
            {BUILTIN_DECK_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {t(style.name_key ?? "")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
          {t("deckAi.includeNotes")}
        </label>
      </div>

      <div className="deck-ai-panel-actions">
        <button type="button" onClick={() => void start()} disabled={!request || busy}>
          {t("deckAi.generate")}
        </button>
        {busy ? (
          <button type="button" onClick={() => void cancel()}>
            {t("deckAi.cancel")}
          </button>
        ) : null}
        {prepared && prepared.outbound_preview.backend === "api" ? (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            disabled={busy || consentSent || !prepared.outbound_preview.requires_consent}
          >
            {t("deckAi.outboundReview")}
          </button>
        ) : null}
      </div>

      {reviewOpen && prepared && prepared.outbound_preview.requires_consent ? (
        <AssistantOutboundConsentHost
          key={prepared.outbound_preview.preview_id}
          preview={prepared.outbound_preview}
          onConsent={acceptOutbound}
          onCancel={() => setReviewOpen(false)}
        />
      ) : null}

      {suggestion ? (
        <>
          <DeckAiWarnings warnings={suggestion.warnings} />
          <DeckAiOutlineEditor outline={outline} disabled={busy} onChange={edit} />
          <DeckAiPreview preview={suggestion.preview} />
          <div className="deck-ai-review-actions">
            <button type="button" onClick={() => void preview()} disabled={busy}>
              {t("deckAi.previewChanges")}
            </button>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={
                busy ||
                !suggestion.preview ||
                !suggestion.preview.can_apply ||
                suggestion.status === "editing" ||
                action === "style"
              }
            >
              {suggestion.draft_id ? t("deckAi.acceptDraft") : t("deckAi.acceptChanges")}
            </button>
            <button type="button" onClick={() => void discard()} disabled={busy}>
              {t("deckAi.discard")}
            </button>
          </div>
        </>
      ) : null}

      <p className="deck-ai-status" role="status" aria-live="polite">
        {busy ? t("deckAi.progress") : status ? t(status) : ""}
      </p>
      {error ? (
        <p className="deck-ai-error" role="alert">
          {errorText(t, error, "deck_ai")}
        </p>
      ) : null}
    </section>
  );
}
