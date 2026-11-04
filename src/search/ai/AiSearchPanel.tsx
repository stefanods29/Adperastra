import { FolderInput, Search as SearchIcon, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssistantOutboundConsentHost } from "../../assistant/AssistantOutboundConsentHost";
import type { AssistantOutboundPreview } from "../../assistant/types";
import Skeleton from "../../components/Skeleton";
import { errorText } from "../../services/errors";
import type { JobHandle } from "../../services/jobs";
import type { AiInputRef } from "../../services/localAiTypes";
import type { IndexRoot, SearchPage, SearchQuery } from "../../services/search";
import type {
  AiSearchMode,
  AiSearchSettings,
  NaturalQueryPreview,
  NaturalQueryRequest,
  SemanticPage,
} from "../../services/aiSearchTypes";
import { prepareAiSearchInference, previewNaturalQuery, searchSemantic as startSemantic, semanticStatus } from "../../services/aiSearch";
import { isTauriRuntime } from "../../services/settings";
import { confirmNaturalQuery } from "./naturalQuery";
import NaturalQueryPreviewPanel from "./NaturalQueryPreviewPanel";
import { aiModeDisabledReason } from "./aiSearchSettings";
import { eligibleSemanticRoots } from "../../services/aiSearchTypes";
import { pageForRevision, SemanticRevisionGate } from "./semanticAdapter";

export interface AiSearchPanelProps {
  settings: AiSearchSettings;
  indexRoots: IndexRoot[];
  sensitiveRootIds?: string[];
  selectedInput?: AiInputRef | null;
  selectedKind?: "text" | "image" | null;
  selectedSensitive?: boolean;
  onOpenFile?: (path: string) => Promise<void>;
  onSemanticResults?: (page: SemanticPage) => void;
  /** The host applies the confirmed query through its ordinary search view. */
  onNaturalResults?: (page: SearchPage, query: SearchQuery) => void;
  /** Host command opened one specific mode; the panel starts there. */
  initialMode?: AiSearchMode;
  onOpenSettings?: () => void;
  onOpenHelp: (slug: string) => void;
  /** Explicit status from the host: false when the local embedder is absent. */
  providerAvailable?: boolean;
  service?: AiSearchPanelService;
  onRequestOutboundConsent?: (
    preview: AssistantOutboundPreview,
    request: NaturalQueryRequest,
  ) => Promise<string | null>;
  onRequestSensitiveConsent?: (input: AiInputRef) => Promise<string | null>;
}

export interface AiSearchPanelService {
  prepare(request: import("../../services/aiSearchTypes").AiSearchInferenceRequest): Promise<{
    id: string;
    outbound_preview: AssistantOutboundPreview;
    expires_unix: number;
  }>;
  previewNatural(
    request: NaturalQueryRequest,
    preparedId: string,
    outboundConsentId: string | null,
  ): Promise<JobHandle<NaturalQueryPreview>>;
  searchSemantic(query: import("../../services/aiSearchTypes").SemanticQuery): Promise<JobHandle<SemanticPage>>;
}

const MODE_LABELS: Record<AiSearchMode, string> = {
  meaning: "aiSearch.meaning",
  photos: "aiSearch.photos",
  similar: "aiSearch.similar",
  natural: "aiSearch.natural",
};

const MODE_ICONS = {
  meaning: SearchIcon,
  photos: Sparkles,
  similar: FolderInput,
  natural: Sparkles,
} as const;

const defaultService: AiSearchPanelService = {
  prepare: prepareAiSearchInference,
  previewNatural: previewNaturalQuery,
  searchSemantic: startSemantic,
};

let requestRevision = 0;
function nextRevision(): number {
  requestRevision += 1;
  return requestRevision;
}

function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function AiSearchPanel({
  settings,
  indexRoots,
  sensitiveRootIds = [],
  selectedInput = null,
  selectedKind = null,
  selectedSensitive = false,
  onOpenFile,
  onSemanticResults,
  onNaturalResults,
  initialMode,
  onOpenSettings,
  onOpenHelp,
  providerAvailable,
  service,
  onRequestOutboundConsent,
  onRequestSensitiveConsent,
}: AiSearchPanelProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<AiSearchMode>(initialMode ?? "meaning");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<SemanticPage | null>(null);
  const [preview, setPreview] = useState<NaturalQueryPreview | null>(null);
  const [previewRequest, setPreviewRequest] = useState<NaturalQueryRequest | null>(null);
  const [outbound, setOutbound] = useState<AssistantOutboundPreview | null>(null);
  const [statusReady, setStatusReady] = useState(true);
  const gate = useRef(new SemanticRevisionGate());
  const job = useRef<JobHandle<unknown> | null>(null);
  const slowTimer = useRef<number | null>(null);
  const outboundWaiter = useRef<((consent: string | null) => void) | null>(null);

  useEffect(() => {
    return () => {
      job.current?.cancel();
      if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
      outboundWaiter.current?.(null);
      outboundWaiter.current = null;
    };
  }, []);

  // With a production service, read the real native status once. A missing
  // embedder must disable semantic modes instead of returning empty results.
  useEffect(() => {
    if (!service && !isTauriRuntime()) return;
    let live = true;
    void semanticStatus()
      .then((status) => {
        if (live) setStatusReady(status.reason_code !== "ai_search.unavailable");
      })
      .catch(() => {
        if (live) setStatusReady(false);
      });
    return () => {
      live = false;
    };
  }, [service]);

  const providerReady = providerAvailable ?? statusReady;
  const reason = aiModeDisabledReason(settings, mode, indexRoots, sensitiveRootIds, selectedKind, providerReady);
  const modeDisabled = reason !== null;
  const api = service ?? defaultService;

  // The shared consent host is a fallback for hosts that do not supply their
  // own outbound review. It never sends anything: only a native confirmation
  // returns a one-use consent for the prepared preview.
  const requestLocalOutboundConsent = (prepared: AssistantOutboundPreview) =>
    new Promise<string | null>((resolve) => {
      outboundWaiter.current?.(null);
      outboundWaiter.current = resolve;
      setOutbound(prepared);
    });

  const settleOutbound = (consentId: string | null) => {
    const waiter = outboundWaiter.current;
    outboundWaiter.current = null;
    setOutbound(null);
    waiter?.(consentId);
  };

  const stop = () => {
    job.current?.cancel();
    job.current = null;
    gate.current.cancel();
    outboundWaiter.current?.(null);
    outboundWaiter.current = null;
    setOutbound(null);
    setBusy(false);
    setSlow(false);
  };

  const startWait = () => {
    setBusy(true);
    setError("");
    setSlow(false);
    slowTimer.current = window.setTimeout(() => setSlow(true), 1000);
  };

  const endWait = () => {
    setBusy(false);
    setSlow(false);
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
    slowTimer.current = null;
  };

  const searchSemantic = async () => {
    const kind =
      mode === "meaning" ? "text" : mode === "photos" ? "photo" : selectedKind === "text" ? "similar_text" : "similar_image";
    const rootMode = kind === "text" || kind === "similar_text" ? "text" : "photos";
    const semanticRoots = eligibleSemanticRoots(
      settings,
      indexRoots,
      sensitiveRootIds,
      rootMode,
    ).map((root) => root.root_id);
    if (semanticRoots.length === 0) {
      setError(t("aiSearch.empty"));
      return;
    }
    if (mode === "similar" && !selectedInput) {
      setError(t("errors.ai_search.denied"));
      return;
    }
    let consent: string | null = null;
    if (selectedSensitive && selectedInput && mode === "similar") {
      if (!onRequestSensitiveConsent) {
        setError(t("errors.ai_search.sensitive"));
        return;
      }
      consent = await onRequestSensitiveConsent(selectedInput);
      if (!consent) return;
    }
    const revision = nextRevision();
    startWait();
    setPage(null);
    try {
      const handle = await api.searchSemantic({
        kind,
        text: kind === "text" || kind === "photo" ? text : null,
        input: kind === "text" || kind === "photo" ? null : selectedInput,
        root_ids: semanticRoots,
        limit: 50,
        request_revision: revision,
        sensitive_consent_id: consent,
      });
      job.current = handle;
      const result = await handle.completion;
      const current = pageForRevision(result, revision);
      if (current && gate.current.accept(revision)) {
        setPage(current);
        onSemanticResults?.(current);
      }
    } catch (caught) {
      if (gate.current.accept(revision)) setError(errorText(t, caught, "ai_search"));
    } finally {
      endWait();
    }
  };

  const startNatural = async () => {
    const request: NaturalQueryRequest = {
      text: text.trim(),
      // Natural-language interpretation only discloses the vocabulary of
      // ordinary enabled roots; it never infers AI indexing consent.
      root_ids: indexRoots
        .filter((root) => root.enabled && !sensitiveRootIds.includes(root.id))
        .slice(0, 32)
        .map((root) => root.id),
      now_unix: Math.floor(Date.now() / 1000),
      timezone: currentTimeZone(),
      locale: i18n.language === "es" ? "es" : "en",
      request_revision: nextRevision(),
    };
    if (request.text.length === 0 || request.root_ids.length === 0) {
      setError(request.root_ids.length === 0 ? t("aiSearch.empty") : t("errors.ai_search.invalid"));
      return;
    }
    startWait();
    try {
      const prepared = await api.prepare({ kind: "query", request });
      let consent: string | null = null;
      if (prepared.outbound_preview.requires_consent) {
        consent = onRequestOutboundConsent
          ? await onRequestOutboundConsent(prepared.outbound_preview, request)
          : await requestLocalOutboundConsent(prepared.outbound_preview);
        if (!consent) {
          setError(t("errors.ai_search.denied"));
          return;
        }
      }
      const handle = await api.previewNatural(request, prepared.id, consent);
      job.current = handle;
      const result = await handle.completion;
      setPreview(result);
      setPreviewRequest(request);
    } catch (caught) {
      setError(errorText(t, caught, "ai_search"));
    } finally {
      endWait();
    }
  };

  const run = () => {
    if (modeDisabled) return;
    stop();
    setError("");
    if (mode === "natural") void startNatural();
    else void searchSemantic();
  };

  const confirm = async (edited: import("../../services/search").SearchQuery) => {
    if (!preview) return;
    startWait();
    try {
      const handle = await confirmNaturalQuery(preview, edited);
      job.current = handle;
      const result = await handle.completion;
      onNaturalResults?.(result, edited);
      setPreview(null);
      setPreviewRequest(null);
    } catch (caught) {
      setError(errorText(t, caught, "ai_search"));
    } finally {
      endWait();
    }
  };

  const Icon = MODE_ICONS[mode];
  const emptyRoots = eligibleSemanticRoots(settings, indexRoots, sensitiveRootIds, "text").length === 0;

  return (
    <section className="ai-search-panel" aria-busy={busy} aria-label={t("aiSearch.title")}>
      <h2 className="ai-search-panel__title">{t("aiSearch.title")}</h2>
      <div className="ai-search-panel__modes" role="tablist" aria-label={t("aiSearch.title")}>
        {(Object.keys(MODE_LABELS) as AiSearchMode[]).map((id) => {
          const disabledReason = aiModeDisabledReason(settings, id, indexRoots, sensitiveRootIds, selectedKind, providerReady);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              aria-disabled={disabledReason !== null || undefined}
              title={disabledReason ? t(disabledReason) : undefined}
              className={mode === id ? "ai-search-panel__mode ai-search-panel__mode--active" : "ai-search-panel__mode"}
              onClick={() => {
                if (disabledReason) return;
                stop();
                setMode(id);
                setError("");
                setPage(null);
              }}
            >
              {id === mode ? <Icon size={16} aria-hidden="true" /> : null}
              {t(MODE_LABELS[id])}
            </button>
          );
        })}
      </div>

      <div className="ai-search-panel__query">
        <input
          className="adp-input"
          type="text"
          value={text}
          aria-label={t(MODE_LABELS[mode])}
          placeholder={t("search.searchBox")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              run();
            }
          }}
        />
        <button
          type="button"
          className="adp-btn adp-btn--primary"
          disabled={busy || modeDisabled}
          onClick={run}
        >
          <SearchIcon size={16} aria-hidden="true" />
          {t("aiSearch.search")}
        </button>
        {settings.roots.length === 0 && emptyRoots && onOpenSettings ? (
          <button type="button" className="adp-btn" onClick={onOpenSettings}>
            {t("aiSearch.empty")}
          </button>
        ) : null}
      </div>

      {reason && modeDisabled ? <p className="ai-search-panel__notice">{t(reason)}</p> : null}
      {selectedSensitive && mode === "similar" ? (
        <p className="ai-search-panel__notice">{t("aiSearch.sensitiveConsent")}</p>
      ) : null}
      {busy && !slow ? <Skeleton variant="rows" count={3} /> : null}
      {busy && slow ? (
        <p className="ai-search-panel__status" role="status">
          {t("aiSearch.progress")}
        </p>
      ) : null}
      {error ? (
        <p className="ai-search-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      {page?.coverage !== "complete" && page ? (
        <p className="ai-search-panel__notice" role="status">
          {t("aiSearch.partial")}
        </p>
      ) : null}
      {page ? (
        <div className="ai-search-results" aria-live="polite">
          <p className="ai-search-results__coverage">
            {t("aiSearch.coverage", { done: page.scanned, skipped: page.skipped })}
          </p>
          <ul>
            {page.hits.map((hit) => (
              <li key={`${hit.item.key.path_key}-${hit.chunk_index}`}>
                <button type="button" className="ai-search-result" onClick={() => onOpenFile?.(hit.item.item.path)}>
                  <span>{hit.item.item.name}</span>
                  <span className="ai-search-result__score">
                    {t("aiSearch.relevance")}:{" "}
                    {new Intl.NumberFormat(i18n.language === "es" ? "es" : "en", {
                      maximumFractionDigits: 3,
                    }).format(hit.score)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview && previewRequest ? (
        <NaturalQueryPreviewPanel
          preview={preview}
          roots={indexRoots}
          busy={busy}
          onSearch={(edited) => void confirm(edited)}
          onCancel={() => {
            setPreview(null);
            setPreviewRequest(null);
          }}
          onOpenHelp={onOpenHelp}
        />
      ) : null}

      {outbound ? (
        <AssistantOutboundConsentHost
          key={outbound.preview_id}
          preview={outbound}
          onConsent={(consentId) => settleOutbound(consentId)}
          onCancel={() => settleOutbound(null)}
        />
      ) : null}
    </section>
  );
}
