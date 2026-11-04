import { Code, FileText, Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import SafeMarkupFrame from "../../components/SafeMarkupFrame";
import Skeleton from "../../components/Skeleton";
import type { Command } from "../../commands/registry";
import { errorText } from "../../services/errors";
import {
  openEmailAttachment,
  type EmailAddress,
  type EmailAttachment,
  type EmailSummary,
} from "../../services/extraViews";
import { formatDate, formatSize } from "../../services/format";
import Ribbon from "../../ribbon/Ribbon";
import { useCommandShortcuts } from "../../ribbon/shortcuts";
import type { RibbonDef } from "../../ribbon/types";
import ViewerFrame from "../../ribbon/ViewerFrame";
import type { HandlerViewProps } from "../types";
import { useExtraView } from "../extraView/useExtraView";

interface EmailCtx {
  ready: boolean;
  html: boolean;
  plain: boolean;
  attachmentCount: number;
  canOpenAsText: boolean;
}

function addressText(value: EmailAddress): string {
  if (value.name !== "" && value.address !== "") return `${value.name} <${value.address}>`;
  return value.name || value.address;
}

function hasBlockedImages(html: string): boolean {
  const images = html.match(/<img\b/gi)?.length ?? 0;
  const sourced = html.match(/<img\b[^>]*\bsrc=/gi)?.length ?? 0;
  return images > sourced;
}

export default function EmailView({
  info,
  active,
  onStatus,
  onOpenInWindowsApp,
  onOpenAsText,
  onOpenFile,
  find,
  previewOnly,
}: HandlerViewProps) {
  const { t, i18n } = useTranslation();
  const view = useExtraView(info.path, "email", active);
  const [showHtml, setShowHtml] = useState(true);
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<unknown>(null);
  const [matches, setMatches] = useState(0);
  const [showReading, setShowReading] = useState(false);
  const lastFind = useRef({ request: 0, text: "" });

  const pagePayload = view.page?.payload;
  const pageSummary = pagePayload?.kind === "email" ? pagePayload.message : null;
  const pageAttachments = pagePayload?.kind === "email" ? pagePayload.attachments : [];

  useEffect(() => {
    setSummary(null);
    setAttachments([]);
    setShowHtml(true);
  }, [view.session?.session_id]);

  useEffect(() => {
    if (pageSummary) setSummary(pageSummary);
  }, [pageSummary]);

  const message = summary;

  useEffect(() => {
    if (pageAttachments.length === 0) return;
    setAttachments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of pageAttachments) byId.set(item.id, item);
      return [...byId.values()];
    });
  }, [pageAttachments]);

  useEffect(() => {
    if (view.phase !== "loading") {
      setShowReading(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReading(true), 1000);
    return () => window.clearTimeout(timer);
  }, [view.phase]);

  const html = showHtml ? (message?.html ?? null) : null;
  const bodyText = message ? (message.html ? (message.plain_text || "") : message.plain_text) : "";

  useEffect(() => {
    if (find.request === lastFind.current.request && find.text === lastFind.current.text) return;
    lastFind.current = { request: find.request, text: find.text };
    if (find.text === "") {
      setMatches(0);
      return;
    }
    const searchable = `${message?.subject ?? ""}\n${bodyText}`;
    let count = 0;
    let at = 0;
    while (count < 10_000) {
      const found = searchable.indexOf(find.text, at);
      if (found < 0) break;
      count += 1;
      at = found + Math.max(1, find.text.length);
    }
    setMatches(count);
  }, [find.request, find.text, message?.subject, bodyText]);

  const openAttachment = useCallback(
    async (attachment: EmailAttachment) => {
      if (!view.session) return;
      setOpening(attachment.id);
      setAttachmentError(null);
      try {
        const job = await openEmailAttachment(view.session.session_id, attachment.id);
        const path = await job.completion;
        await onOpenFile?.(path);
      } catch (failure) {
        setAttachmentError(failure);
      } finally {
        setOpening(null);
      }
    },
    [view.session, onOpenFile],
  );

  useEffect(() => {
    const items: string[] = [];
    if (message?.subject) items.push(message.subject);
    items.push(t("email.attachmentCount", { count: attachments.length }));
    if (find.text !== "") items.push(t("viewer.matches", { count: matches }));
    items.push(formatSize(info.size, i18n.language));
    onStatus({ items });
  }, [message?.subject, attachments.length, find.text, matches, info.size, i18n.language, onStatus, t]);

  const ctx: EmailCtx = {
    ready: message !== null,
    html: Boolean(message?.html),
    plain: !showHtml,
    attachmentCount: attachments.length,
    canOpenAsText: Boolean(onOpenAsText),
  };
  const commands = useMemo<Command<EmailCtx>[]>(
    () => [
      {
        id: "email.html",
        labelKey: "email.htmlBody",
        icon: Code,
        risk: "read-only",
        helpSlug: "viewing-email",
        checkKind: "radio",
        checkedWhen: (current) => current.html && !current.plain,
        enabledWhen: (current) => current.html,
        run: () => setShowHtml(true),
      },
      {
        id: "email.plainText",
        labelKey: "extra_view.plainText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-email",
        checkKind: "radio",
        checkedWhen: (current) => current.plain,
        enabledWhen: () => true,
        run: () => setShowHtml(false),
      },
      {
        id: "email.openAsText",
        labelKey: "viewer.openAsText",
        icon: FileText,
        risk: "read-only",
        helpSlug: "viewing-text",
        visibleWhen: (current) => current.canOpenAsText,
        enabledWhen: (current) => current.canOpenAsText,
        run: () => onOpenAsText?.(),
      },
    ],
    [onOpenAsText],
  );
  useCommandShortcuts(commands, ctx, active);

  const ribbon: RibbonDef = {
    tabs: [
      {
        id: "view",
        labelKey: "ribbon.view",
        keyTip: "V",
        groups: [
          {
            id: "body",
            labelKey: "email.body",
            controls: [
              { type: "toggle", command: "email.html", keyTip: "H" },
              { type: "toggle", command: "email.plainText", keyTip: "P" },
            ],
          },
        ],
      },
    ],
  };

  const blocked = html ? hasBlockedImages(html) : false;
  const hasMoreAttachments = attachments.length > 0 && Boolean(view.page?.next_cursor);

  return (
    <ViewerFrame ribbon={<Ribbon def={ribbon} ctx={ctx} commands={commands} accent="explorer" active={active} />}>
      <div className="adp-email">
        {view.phase === "loading" ? (
          <div className="adp-viewer-message" role="status">
            <Skeleton variant="rows" count={6} />
            {showReading ? (
              <>
                <p>{t("components.loading")}</p>
                <Button onClick={view.cancelOpen}>{t("common.cancel")}</Button>
              </>
            ) : null}
          </div>
        ) : null}
        {view.phase === "error" ? (
          <div className="adp-viewer-message" role="alert">
            <p>{errorText(t, view.error, "extra_view")}</p>
            <div className="adp-dialog-actions">
              <Button onClick={view.reload}>{t("common.retry")}</Button>
              <Button variant="primary" onClick={onOpenInWindowsApp}>
                {t("fileTab.openInWindowsApp")}
              </Button>
            </div>
          </div>
        ) : null}
        {message ? (
          <div className="adp-email-message">
            <dl className="adp-email-headers">
              <dt>{t("extra_view.subject")}</dt>
              <dd>{message.subject}</dd>
              <dt>{t("extra_view.from")}</dt>
              <dd>{message.from.map(addressText).join(", ")}</dd>
              <dt>{t("extra_view.to")}</dt>
              <dd>{message.to.map(addressText).join(", ")}</dd>
              {message.cc.length > 0 ? (
                <>
                  <dt>{t("email.cc")}</dt>
                  <dd>{message.cc.map(addressText).join(", ")}</dd>
                </>
              ) : null}
              {message.date ? (
                <>
                  <dt>{t("email.date")}</dt>
                  <dd>{formatDate(Math.floor(new Date(message.date).getTime() / 1000), i18n.language)}</dd>
                </>
              ) : null}
            </dl>
            {blocked ? (
              <p className="adp-viewer-note" role="note">
                {t("extra_view.remoteBlocked")}
              </p>
            ) : null}
            {html ? (
              <SafeMarkupFrame
                className="adp-email-frame"
                html={html}
                resources={[]}
                title={message.subject || info.name}
              />
            ) : (
              <pre className="adp-email-text">{message.plain_text}</pre>
            )}
            <section className="adp-email-attachments" aria-label={t("extra_view.attachments")}>
              <h2>{t("extra_view.attachments")}</h2>
              {attachments.length === 0 ? (
                <p className="adp-viewer-note">{t("email.noAttachments")}</p>
              ) : (
                <ul>
                  {attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <Paperclip size={14} aria-hidden="true" />
                      <span className="adp-email-attachment-name">{attachment.name}</span>
                      <span className="adp-email-attachment-meta">
                        {attachment.mime} · {formatSize(attachment.byte_len, i18n.language)}
                      </span>
                      <Button
                        onClick={() => void openAttachment(attachment)}
                        disabled={opening !== null}
                      >
                        {opening === attachment.id ? t("components.loading") : t("common.open")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {attachmentError ? (
                <p className="adp-notebook-error" role="alert">
                  {errorText(t, attachmentError, "extra_view")}
                </p>
              ) : null}
              {hasMoreAttachments ? (
                <Button onClick={() => void view.request({ cursor: view.page?.next_cursor ?? null })}>
                  {t("commands.more")}
                </Button>
              ) : null}
            </section>
            {view.page?.partial ? <p className="adp-viewer-note" role="note">{t("extra_view.partial")}</p> : null}
            {previewOnly ? <p className="adp-viewer-note" role="note">{t("preview.readOnly")}</p> : null}
          </div>
        ) : null}
      </div>
    </ViewerFrame>
  );
}

/** Tests assert that no attachment bytes or path exist in the rendered DTO. */
export function emailAttachmentsAreMetadata(items: readonly EmailAttachment[]): boolean {
  return items.every((item) => !("bytes" in item) && !("path" in item));
}
