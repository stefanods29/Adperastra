import { MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobHandle } from "../services/jobs";
import type { AiCitation } from "../services/localAiTypes";
import {
  assistantMessages,
  createAssistantChat,
  sendAssistantTurn,
  stopAssistantTurn,
} from "../services/assistant";
import {
  assistantScope,
  requestAssistantScope,
  revokeAssistantScope,
} from "../services/assistantScope";
import {
  applyAssistantDraft,
  cancelAssistantDraft,
  confirmAssistantRecycle,
  previewAssistantAction,
} from "../services/assistantActions";
import {
  assistantEndpointStatus,
  credentialStatus,
  editAssistantCredential,
  testAssistantProvider,
} from "../services/assistantProviders";
import { isTauriRuntime } from "../services/settings";
import { AssistantActionCard } from "./AssistantActionCard";
import { AssistantBackendPicker } from "./AssistantBackendPicker";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantMessages } from "./AssistantMessages";
import { AssistantOutboundConsentHost } from "./AssistantOutboundConsentHost";
import { listAssistantHistory } from "./history";
import { assistantErrorKey } from "./types";
import type {
  AssistantBackend,
  AssistantConversation,
  AssistantDraft,
  AssistantEndpointStatus,
  AssistantLocalSource,
  AssistantMessage,
  AssistantOutboundPreview,
  AssistantProviderId,
  AssistantScope,
  AssistantTurnRequest,
  AssistantTurnResult,
  CredentialStatus,
} from "./types";

export interface AssistantPanelProps {
  active: boolean;
  /** False when the assistant is off in Settings; Send stays disabled. */
  enabled?: boolean;
  initialBackend?: AssistantBackend;
  initialProviderId?: AssistantProviderId;
  localSource?: AssistantLocalSource;
  /** The folder the user is looking at; a grant is requested only on click. */
  scopeRootPath?: string | null;
  /** A native-prepared outbound payload, shown through the one-use host. */
  outboundPreview?: AssistantOutboundPreview | null;
  onOutboundConsent?(consentId: string): void;
  onOutboundCancel?(): void;
  onOutboundError?(errorKey: string): void;
  onClose(): void;
  onOpenHelp(slug: string): void;
  /** Additive, optional: activate an existing viewer and seek to the cite. */
  onSeekCitation?(citation: AiCitation): void;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function errorKeyOf(error: unknown): string {
  const code =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  return assistantErrorKey(code);
}

function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function historyLabel(chat: AssistantConversation, locale: string): string {
  const first = chat.messages.find((message) => message.role === "user")?.plain_text.trim();
  if (first) {
    const chars = Array.from(first);
    return chars.slice(0, 48).join("") + (chars.length > 48 ? "\u2026" : "");
  }
  const date = new Date(chat.created_unix * 1000);
  return Number.isNaN(date.getTime())
    ? chat.id.slice(0, 8)
    : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
}

/**
 * Docked assistant (Step 17a T6, E10). Opening the panel loads no model and
 * makes no network request. A chat and a scope are created only when the
 * user presses Send.
 */
export function AssistantPanel({
  active,
  enabled = true,
  initialBackend = "local",
  initialProviderId = "meta",
  localSource = "bundled",
  scopeRootPath = null,
  outboundPreview = null,
  onOutboundConsent,
  onOutboundCancel,
  onOutboundError,
  onClose,
  onOpenHelp,
  onSeekCitation,
}: AssistantPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language ?? "en";
  const [backend, setBackend] = useState<AssistantBackend>(initialBackend);
  const [providerId, setProviderId] = useState<AssistantProviderId>(initialProviderId);
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [history, setHistory] = useState<AssistantConversation[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [credential, setCredential] = useState<CredentialStatus | null>(null);
  const [endpoint, setEndpoint] = useState<AssistantEndpointStatus | null>(null);
  const [providerState, setProviderState] = useState<
    "checking" | "ready" | "missing" | "unavailable"
  >(initialBackend === "api" ? "checking" : "ready");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [scope, setScope] = useState<AssistantScope | null>(null);
  const [scopeRecursive, setScopeRecursive] = useState(true);
  const [scopeReadContents, setScopeReadContents] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [recycleStage, setRecycleStage] = useState<0 | 1>(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const handleRef = useRef<JobHandle<AssistantTurnResult> | null>(null);
  const stoppedRef = useRef(false);
  const scopeRef = useRef<AssistantScope | null>(null);
  scopeRef.current = scope;

  const revokeScope = useCallback(async () => {
    const current = scopeRef.current;
    scopeRef.current = null;
    setScope(null);
    if (!current) return;
    try {
      await revokeAssistantScope(current.id);
    } catch {
      // A profile change or window close may already have revoked it.
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const next = await listAssistantHistory();
      setHistory(next);
      setHistoryError(null);
    } catch (caught) {
      setHistoryError(errorKeyOf(caught));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    return () => {
      void handleRef.current?.cancel();
      handleRef.current = null;
      void revokeScope();
    };
  }, [active, revokeScope]);

  useEffect(() => {
    if (active) void refreshHistory();
  }, [active, refreshHistory]);

  // Provider selection status. A missing key or endpoint is a real blocker;
  // the panel never falls back to another backend on its own.
  useEffect(() => {
    if (!active) return;
    setCredential(null);
    setEndpoint(null);
    setProviderError(null);
    if (!enabled) {
      setProviderState("unavailable");
      return;
    }
    if (backend === "local") {
      setProviderState("ready");
      return;
    }
    if (!isTauriRuntime()) {
      setProviderState("ready");
      return;
    }
    let live = true;
    setProviderState("checking");
    void (async () => {
      try {
        const nextCredential = await credentialStatus(providerId);
        if (!live) return;
        setCredential(nextCredential);
        if (!nextCredential.has_key) {
          setProviderState("missing");
          return;
        }
        if (providerId === "custom_compatible") {
          const nextEndpoint = await assistantEndpointStatus();
          if (!live) return;
          setEndpoint(nextEndpoint);
          if (!nextEndpoint.configured) {
            setProviderState("missing");
            return;
          }
        }
        setProviderState("ready");
      } catch (caught) {
        if (!live) return;
        setProviderState("unavailable");
        setProviderError(errorKeyOf(caught));
      }
    })();
    return () => {
      live = false;
    };
  }, [active, backend, enabled, providerId]);

  if (!active) return null;

  const resetChat = async () => {
    await revokeScope();
    setConversation(null);
    setMessages([]);
    setText("");
    setDraft(null);
    setRecycleStage(0);
    setActionNote(null);
    setErrorCode(null);
    setScopeError(null);
  };

  const changeBackend = async (next: AssistantBackend) => {
    if (next === backend) return;
    await resetChat();
    setBackend(next);
  };

  const changeProvider = async (next: AssistantProviderId) => {
    if (next === providerId) return;
    await resetChat();
    setProviderId(next);
  };

  const selectHistory = async (chatId: string) => {
    if (chatId === "new") {
      await resetChat();
      return;
    }
    const chat = history.find((entry) => entry.id === chatId);
    if (!chat) return;
    await revokeScope();
    setConversation(chat);
    setBackend(chat.backend);
    if (chat.provider_id) setProviderId(chat.provider_id);
    setMessages(chat.messages);
    setDraft(null);
    setRecycleStage(0);
    setActionNote(null);
    setErrorCode(null);
    setScopeError(null);
    try {
      const nativeMessages = await assistantMessages(chat.id, null);
      if (nativeMessages.length > 0) setMessages(nativeMessages);
    } catch {
      // The cached conversation list is still readable without the store.
    }
    try {
      setScope(await assistantScope(chat.id));
    } catch {
      setScope(null);
    }
  };

  const editKey = async () => {
    if (providerBusy) return;
    setProviderBusy(true);
    setProviderError(null);
    try {
      const next = await editAssistantCredential(providerId);
      setCredential(next);
      if (!next.has_key) {
        setProviderState("missing");
        return;
      }
      if (providerId === "custom_compatible") {
        const nextEndpoint = await assistantEndpointStatus();
        setEndpoint(nextEndpoint);
        setProviderState(nextEndpoint.configured ? "ready" : "missing");
        return;
      }
      setProviderState("ready");
    } catch (caught) {
      setProviderError(errorKeyOf(caught));
    } finally {
      setProviderBusy(false);
    }
  };

  const testConnection = async () => {
    if (providerBusy) return;
    setProviderBusy(true);
    setProviderError(null);
    try {
      const result = await testAssistantProvider(providerId);
      if (!result.ok) {
        setProviderState("unavailable");
        setProviderError(assistantErrorKey(result.error_code));
        return;
      }
      setProviderState("ready");
    } catch (caught) {
      setProviderState("unavailable");
      setProviderError(errorKeyOf(caught));
    } finally {
      setProviderBusy(false);
    }
  };

  const grantScope = async () => {
    if (!enabled || !scopeRootPath || scopeBusy) return;
    setScopeBusy(true);
    setScopeError(null);
    try {
      let chat = conversation;
      if (!chat) {
        chat = await createAssistantChat(backend);
        setConversation(chat);
        setMessages(chat.messages);
      }
      if (backend === "api" && chat.provider_id !== providerId) {
        setProviderState("unavailable");
        setProviderError("errors.assistant.provider_invalid");
        return;
      }
      setScope(
        await requestAssistantScope(
          chat.id,
          scopeRootPath,
          scopeRecursive,
          scopeReadContents,
        ),
      );
    } catch (caught) {
      setScopeError(errorKeyOf(caught));
    } finally {
      setScopeBusy(false);
    }
  };

  const scopeReady =
    !scopeRootPath ||
    (scope !== null && (conversation === null || scope.chat_id === conversation.id));
  const canSend =
    enabled && providerState === "ready" && scopeReady && !scopeBusy && !providerBusy;

  const blockedKey: string | null = !enabled
    ? "assistant.unavailable"
    : providerState === "checking"
      ? null
      : backend === "api" && providerState === "missing"
        ? credential !== null && !credential.has_key
          ? "assistant.noKey"
          : "assistant.configureEndpoint"
        : providerState === "unavailable"
          ? backend === "api"
            ? "assistant.apiFailed"
            : "assistant.failed"
          : !scopeReady
            ? "assistant.scope"
            : null;

  const stop = async () => {
    const handle = handleRef.current;
    if (!handle || stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      await stopAssistantTurn(handle.id);
    } finally {
      await handle.cancel();
      setBusy(false);
    }
  };

  const send = async () => {
    if (busy || text.trim().length === 0) return;
    if (!enabled) {
      setErrorCode("assistant.failed");
      return;
    }
    if (providerState !== "ready") {
      setErrorCode(providerState === "missing" ? "assistant.api_auth" : "assistant.failed");
      return;
    }
    if (!scopeReady) {
      setErrorCode("assistant.scope_denied");
      return;
    }
    setErrorCode(null);
    setDraft(null);
    setRecycleStage(0);
    setActionNote(null);
    setBusy(true);
    stoppedRef.current = false;
    try {
      const chat = conversation ?? (await createAssistantChat(backend));
      if (!conversation) {
        setConversation(chat);
        setMessages(chat.messages);
      }
      if (backend === "api" && chat.provider_id !== providerId) {
        setProviderState("unavailable");
        setProviderError("errors.assistant.provider_invalid");
        return;
      }
      const activeScope =
        scope && scope.chat_id === chat.id
          ? scope
          : scopeRootPath
            ? null
            : await assistantScope(chat.id);
      if (!activeScope) throw new Error("assistant.scope_denied");
      const user: AssistantMessage = {
        id: newId(),
        role: "user",
        plain_text: text,
        citations: [],
        status: "done",
        error_code: null,
        backend,
        provider_id: backend === "api" ? providerId : null,
        model_id: chat.model_id,
      };
      setMessages((current) => [...current, user]);
      setText("");
      const request: AssistantTurnRequest = {
        chat_id: chat.id,
        expected_revision: chat.revision,
        user_text: user.plain_text,
        scope_id: activeScope.id,
        request_id: "pending",
        chat_send_nonce: newId(),
      };
      const handle = await sendAssistantTurn(request);
      handleRef.current = handle;
      const result = await handle.completion;
      if (stoppedRef.current) return;
      setConversation((current) =>
        current ? { ...current, revision: result.revision } : current,
      );
      if (result.warnings.includes("assistant.injection")) {
        setActionNote("assistant.injection");
      }
      const assistant: AssistantMessage = {
        id: newId(),
        role: "assistant",
        plain_text: result.reply.kind === "answer" ? result.reply.text : result.reply.kind,
        citations: result.reply.kind === "answer" ? result.reply.citations : [],
        status: "done",
        error_code: null,
        backend: result.backend,
        provider_id: result.provider_id,
        model_id: result.model_id,
      };
      let nativeMessages: AssistantMessage[] = [];
      try {
        nativeMessages = await assistantMessages(chat.id, null);
      } catch {
        nativeMessages = [];
      }
      if (stoppedRef.current) return;
      if (nativeMessages.length > 0) {
        setMessages(nativeMessages);
      } else {
        setMessages((current) => [...current, assistant]);
      }
      if (result.reply.kind === "tool") {
        try {
          const nextDraft =
            result.draft ?? (await previewAssistantAction(chat.id, result.reply.request));
          setDraft(nextDraft);
          setRecycleStage(0);
        } catch (error) {
          setErrorCode(errorKeyOf(error));
        }
      } else {
        setDraft(result.draft);
        setRecycleStage(0);
      }
      void refreshHistory();
    } catch (error) {
      if (stoppedRef.current) return;
      setErrorCode(errorKeyOf(error));
    } finally {
      handleRef.current = null;
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.risk === "recycle") {
        // Two different human gestures are required. The native dialog is the
        // authority; the WebView never chains both clicks on its own.
        if (recycleStage === 0) {
          const first = await confirmAssistantRecycle(draft.id, 1);
          if (first.ready) {
            setRecycleStage(1);
            setActionNote("assistant.recycleFirst");
          }
          return;
        }
        const second = await confirmAssistantRecycle(draft.id, 2);
        if (second.ready) setActionNote("assistant.recycleUnavailable");
        return;
      }
      const handle = await applyAssistantDraft(draft.id);
      const result = await handle.completion;
      setActionNote(result.state === "partial" ? "assistant.partial" : null);
      setDraft(null);
      setRecycleStage(0);
      void refreshHistory();
    } catch (error) {
      setErrorCode(errorKeyOf(error));
    } finally {
      setBusy(false);
    }
  };

  const scopeFolder = scopeRootPath ? folderLabel(scopeRootPath) : "";
  const currentInHistory =
    conversation !== null && history.some((entry) => entry.id === conversation.id);

  return (
    <aside className="adp-assistant" role="complementary" aria-label={t("assistant.title")}>
      <header className="adp-assistant-header">
        <MessageSquare size={16} aria-hidden="true" />
        <h2 className="adp-assistant-title">{t("assistant.title")}</h2>
        <button
          type="button"
          className="adp-icon-button"
          aria-label={t("assistant.title")}
          onClick={() => onOpenHelp("assistant")}
        >
          <span aria-hidden="true">?</span>
        </button>
        <button
          type="button"
          className="adp-icon-button"
          aria-label={t("assistant.close")}
          onClick={() => {
            void stop();
            onClose();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="adp-assistant-modelbar">
        <AssistantBackendPicker
          backend={backend}
          providerId={providerId}
          disabled={busy || scopeBusy || providerBusy}
          onChange={(next) => void changeBackend(next)}
          onProviderChange={(next) => void changeProvider(next)}
        />
        {backend === "api" ? (
          <div className="adp-assistant-key-row">
            <span className="adp-assistant-meta">
              {credential === null
                ? "\u2014"
                : credential.has_key
                  ? t("assistant.keyPresent", { hint: credential.masked_hint })
                  : t("assistant.noKey")}
            </span>
            <button
              type="button"
              className="adp-button"
              disabled={providerBusy || busy}
              onClick={() => void editKey()}
            >
              {t("assistant.editKey")}
            </button>
            <button
              type="button"
              className="adp-button"
              disabled={providerBusy || busy}
              onClick={() => void testConnection()}
            >
              {t("assistant.test")}
            </button>
          </div>
        ) : localSource === "user_server" ? (
          <p className="adp-assistant-notice" role="note">
            {t("assistant.serverNotice")}
          </p>
        ) : null}
        {backend === "api" && providerId === "custom_compatible" ? (
          <p className="adp-assistant-meta">
            {endpoint?.configured
              ? t("assistant.endpointNotice", { origin: endpoint.display_origin ?? "" })
              : t("assistant.configureEndpoint")}
          </p>
        ) : null}
        {providerError ? (
          <p className="adp-assistant-error" role="alert">
            {t(providerError)}
          </p>
        ) : null}
      </div>
      {history.length > 0 || conversation !== null ? (
        <div className="adp-assistant-key-row">
          {history.length > 0 ? (
            <select
              aria-label={t("assistant.keepHistory")}
              value={conversation?.id ?? "new"}
              disabled={busy}
              onChange={(event) => void selectHistory(event.target.value)}
            >
              <option value="new">{t("assistant.newChat")}</option>
              {conversation !== null && !currentInHistory ? (
                <option value={conversation.id}>
                  {historyLabel(conversation, locale)}
                </option>
              ) : null}
              {history.map((chat) => (
                <option key={chat.id} value={chat.id}>
                  {historyLabel(chat, locale)}
                </option>
              ))}
            </select>
          ) : null}
          {conversation !== null ? (
            <button
              type="button"
              className="adp-button"
              disabled={busy}
              onClick={() => void resetChat()}
            >
              {t("assistant.newChat")}
            </button>
          ) : null}
        </div>
      ) : null}
      {historyError ? (
        <p className="adp-assistant-error" role="alert">
          {t(historyError)}
        </p>
      ) : null}
      {scopeRootPath ? (
        <section className="adp-assistant-backend" aria-label={t("assistant.scope")}>
          <div className="adp-assistant-key-row">
            <span className="adp-assistant-label">{t("assistant.scope")}</span>
            <span className="adp-assistant-meta">
              {scope
                ? scope.roots.map((root) => root.label).join(", ") ||
                  scope.files.map((file) => file.id).join(", ")
                : "\u2014"}
            </span>
          </div>
          {scope ? (
            <button
              type="button"
              className="adp-button"
              disabled={scopeBusy || busy}
              onClick={() => void revokeScope()}
            >
              {t("assistant.cancel")}
            </button>
          ) : (
            <>
              <label className="adp-assistant-radio">
                <input
                  type="checkbox"
                  checked={scopeRecursive}
                  disabled={scopeBusy || busy}
                  onChange={(event) => setScopeRecursive(event.target.checked)}
                />
                <span>{t("assistant.recursive")}</span>
              </label>
              <label className="adp-assistant-radio">
                <input
                  type="checkbox"
                  checked={scopeReadContents}
                  disabled={scopeBusy || busy}
                  onChange={(event) => setScopeReadContents(event.target.checked)}
                />
                <span>{t("assistant.readContents")}</span>
              </label>
              <button
                type="button"
                className="adp-button"
                disabled={!enabled || scopeBusy || busy}
                onClick={() => void grantScope()}
              >
                {t("assistant.allowScope", { folder: scopeFolder })}
              </button>
            </>
          )}
          {scopeError ? (
            <p className="adp-assistant-error" role="alert">
              {t(scopeError)}
            </p>
          ) : null}
        </section>
      ) : null}
      <AssistantMessages
        messages={messages}
        streaming={busy}
        onSeek={(citation) => onSeekCitation?.(citation)}
      />
      {draft ? (
        <AssistantActionCard
          draft={draft}
          busy={busy}
          recycleStage={recycleStage}
          onApply={() => void apply()}
          onCancel={() => {
            void cancelAssistantDraft(draft.id);
            setDraft(null);
            setRecycleStage(0);
            setActionNote(null);
          }}
        />
      ) : null}
      {actionNote ? <p className="adp-assistant-notice">{t(actionNote)}</p> : null}
      {errorCode ? (
        <p className="adp-assistant-error" role="alert">
          {t(assistantErrorKey(errorCode))}
        </p>
      ) : null}
      {blockedKey && !busy ? (
        <p className="adp-assistant-notice" role="status">
          {t(blockedKey)}
        </p>
      ) : null}
      <AssistantComposer
        value={text}
        busy={busy}
        disabled={!canSend}
        onChange={setText}
        onSend={() => void send()}
        onStop={() => void stop()}
      />
      {outboundPreview ? (
        <AssistantOutboundConsentHost
          key={outboundPreview.preview_id}
          preview={outboundPreview}
          onConsent={(consentId) => onOutboundConsent?.(consentId)}
          onCancel={() => onOutboundCancel?.()}
          onError={(errorKey) => onOutboundError?.(errorKey)}
        />
      ) : null}
    </aside>
  );
}

export default AssistantPanel;
