import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { releaseCacheLease } from "../../services/cache";
import { fileUrl } from "../../services/files";
import { errorText } from "../../services/errors";
import { officeViewPage } from "../../services/officeView";
import type { OfficePage } from "../../services/officeViewTypes";
import type { JobHandle } from "../../services/jobs";
import type { PaperLayout } from "./usePaperLayout";
import type { PaperTarget } from "./paperTargets";

interface Props {
  layout: PaperLayout;
  page: number;
  width: number;
  targets: PaperTarget[];
  enabled: boolean;
  onEdit: (target: PaperTarget) => void;
  draft: { target: PaperTarget; text: string } | null;
  onText: (text: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

export default function PaperPage(props: Props) {
  const { t } = useTranslation();
  const [image, setImage] = useState<OfficePage | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let disposed = false;
    let job: JobHandle<OfficePage> | undefined;
    let lease: string | undefined;
    setImage(null);
    setError(null);
    void (async () => {
      try {
        job = await officeViewPage(props.layout.sessionId, props.layout.sectionId, props.page, 2);
        if (disposed) void job.cancel();
        const page = await job.completion;
        if (disposed) { void releaseCacheLease(page.image.lease_id); return; }
        lease = page.image.lease_id;
        setImage(page);
      } catch (caught) { if (!disposed) setError(caught); }
    })();
    return () => {
      disposed = true;
      if (job && !lease) void job.cancel().catch(() => undefined);
      if (lease) void releaseCacheLease(lease).catch(() => undefined);
    };
  }, [props.layout.sessionId, props.layout.sectionId, props.page]);
  if (!image) return <div className="adp-paper-placeholder" role="status">
    {error ? errorText(t, error, "office") : t("office.loading")}
  </div>;
  const scale = props.width / image.width_pt;
  const position = (target: PaperTarget) => ({
    left: target.x * scale, top: target.y * scale,
    width: Math.max(20, target.width * scale), height: Math.max(20, target.height * scale),
  });
  const draft = props.draft?.target.page === props.page ? props.draft : null;
  return <figure className="adp-paper-figure" style={{ width: props.width }}>
    <div className="adp-paper-page" style={{ width: props.width, height: image.height_pt * scale }}>
      <img src={fileUrl(image.image.token, image.image.name)}
        width={props.width} height={image.height_pt * scale}
        alt={t("office.pageOf", { page: props.page, count: props.layout.pages })} draggable={false} />
      {props.targets.filter(target => target.page === props.page).map(target => (
        <button key={target.item.id} type="button" className="adp-paper-target"
          style={position(target)} disabled={!props.enabled || !!props.draft}
          aria-label={t("office.paperEditText", { text: target.item.text.slice(0, 100) })}
          onClick={() => props.onEdit(target)} />
      ))}
      {draft ? <form className="adp-paper-inline" style={{
        ...position(draft.target),
        width: Math.min(image.width_pt - draft.target.x, Math.max(draft.target.width, 160)) * scale,
        minHeight: Math.max(draft.target.height, draft.target.fontSize * 1.6) * scale,
      }} onSubmit={(event) => { event.preventDefault(); props.onApply(); }}>
        <textarea autoFocus aria-label={t("office.basicText")} value={draft.text} maxLength={4096}
          style={{ fontSize: draft.target.fontSize * scale }}
          onChange={(event) => props.onText(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); props.onCancel(); }
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault(); props.onApply();
            }
          }} />
        <div className="adp-paper-inline-actions">
          <button type="submit" className="adp-btn">{t("common.apply")}</button>
          <button type="button" className="adp-btn" onClick={props.onCancel}>{t("common.cancel")}</button>
        </div>
      </form> : null}
    </div>
    <figcaption>{t("office.pageOf", { page: props.page, count: props.layout.pages })}</figcaption>
  </figure>;
}
