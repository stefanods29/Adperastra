import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Announcement, AnnouncementQueue } from "./announcements";

/** File-row announcement (Step 10f D2): one ICU message with name, type,
 * formatted size and date, plus logical positions for virtualized lists so
 * screen readers hear the full folder size, not the rendered window. */

export interface FileAnnouncementParts {
  name: string;
  type: string;
  size: string;
  date: string;
}

export function fileAnnouncementArgs(parts: FileAnnouncementParts): Record<string, string> {
  return { name: parts.name, type: parts.type, size: parts.size, date: parts.date };
}

/** ARIA list position from the logical (unvirtualized) index and count. */
export function listItemAriaProps(
  logicalIndex: number,
  logicalCount: number,
): { "aria-setsize": number; "aria-posinset": number } {
  const count = Math.max(1, Math.floor(logicalCount));
  const index = Math.min(Math.max(0, Math.floor(logicalIndex)), count - 1);
  return { "aria-setsize": count, "aria-posinset": index + 1 };
}

export interface AccessibleFileAnnouncementProps {
  parts: FileAnnouncementParts;
  /** When given, delivery goes through the shared queue (throttled). The
   * visually hidden text below still names the focused row for
   * aria-describedby; integrators enable exactly one spoken path. */
  queue?: AnnouncementQueue;
}

export function AccessibleFileAnnouncement({ parts, queue }: AccessibleFileAnnouncementProps) {
  const { t } = useTranslation();
  const args = fileAnnouncementArgs(parts);
  const text = t("accessibility.fileAnnouncement", args);
  useEffect(() => {
    queue?.announce("accessibility.fileAnnouncement", args, "polite");
    // Args are primitives; announce once per distinct row description.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, text]);
  return (
    <span className="adp-visually-hidden" data-file-announcement={parts.name}>
      {text}
    </span>
  );
}

/** Live regions fed by an AnnouncementQueue. Polite messages use a status
 * region, assertive ones an alert region; React renders the translated
 * text as a text node, so file names can never inject markup. */
export function AnnouncementRegion({ queue }: { queue: AnnouncementQueue }) {
  const { t } = useTranslation();
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(
    () =>
      queue.subscribe((announcement: Announcement) => {
        const text = t(announcement.key, announcement.args);
        if (announcement.priority === "assertive") setAssertive(text);
        else setPolite(text);
      }),
    [queue, t],
  );
  return (
    <>
      <div className="adp-visually-hidden" role="status" aria-live="polite" data-announcement="polite">
        {polite}
      </div>
      <div className="adp-visually-hidden" role="alert" aria-live="assertive" data-announcement="assertive">
        {assertive}
      </div>
    </>
  );
}

export default AccessibleFileAnnouncement;
