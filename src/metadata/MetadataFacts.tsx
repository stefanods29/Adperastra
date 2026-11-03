import type { TFunction } from "i18next";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import PreviewSurface, { usePreviewInfo } from "../components/PreviewSurface";
import { previewTargetFor } from "../preview/previewHandler";
import type { ExplorerItem } from "../services/explorer";
import { formatDate } from "../services/format";
import type {
  MetadataField,
  MetadataFieldId,
  MetadataInfo,
  MetadataValue,
} from "../services/metadata";
import { useMetadata } from "./useMetadata";

/** Type-specific facts for one selected file (Step 07b T6). Listing facts
 * stay in the pane; this block adds what the property helper knows, plus a
 * small read-only preview. A failure removes only this block. */

const LABEL_KEYS: Record<MetadataFieldId, string> = {
  width: "metadata.width",
  height: "metadata.height",
  orientation: "metadata.orientation",
  date_taken: "metadata.dateTaken",
  camera_make: "metadata.cameraMake",
  camera_model: "metadata.cameraModel",
  duration_ms: "metadata.duration",
  video_codec: "metadata.codec",
  frame_rate: "metadata.frameRate",
  audio_title: "metadata.title",
  audio_artist: "metadata.artist",
  audio_album: "metadata.album",
  author: "metadata.author",
  page_count: "metadata.pages",
  word_count: "metadata.words",
};

export function metadataLabelKey(id: MetadataFieldId): string {
  return LABEL_KEYS[id];
}

function numberText(value: number, lang: string, digits = 0): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value);
}

/** Minutes and seconds with locale-aware units and list joining (R-LANG). */
export function formatMetadataDuration(milliseconds: number, lang: string): string {
  const total = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total - minutes * 60);
  const secondText = new Intl.NumberFormat(lang, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
  }).format(seconds);
  if (minutes === 0) return secondText;
  const minuteText = new Intl.NumberFormat(lang, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
  }).format(minutes);
  return new Intl.ListFormat(lang, { style: "short", type: "unit" }).format([
    minuteText,
    secondText,
  ]);
}

export function formatMetadataValue(
  field: MetadataField,
  t: TFunction,
  lang: string,
): string {
  const value: MetadataValue = field.value;
  switch (value.kind) {
    case "text":
      return value.value;
    case "list":
      return value.value.join(", ");
    case "date": {
      const parsed = Date.parse(value.value);
      return Number.isFinite(parsed) ? formatDate(Math.floor(parsed / 1000), lang) : "";
    }
    case "decimal":
      // i18next types `count` as a number; this is a preformatted string.
      return t("metadata.fps", {
        count: numberText(value.value, lang, 2) as unknown as number,
      });
    case "integer":
      if (field.id === "width" || field.id === "height") {
        return t("metadata.pixels", {
          count: numberText(value.value, lang) as unknown as number,
        });
      }
      if (field.id === "duration_ms") {
        return formatMetadataDuration(value.value, lang);
      }
      return numberText(value.value, lang);
  }
}

export interface MetadataFactsProps {
  item: ExplorerItem;
  variant?: "details" | "column";
  active?: boolean;
  /** The normal open pipeline, for the pane preview's Open button. */
  onOpen?: (item: ExplorerItem) => void;
  onOpenHelp?: (slug: string) => void;
}

export default function MetadataFacts({
  item,
  variant = "details",
  active = true,
  onOpen,
  onOpenHelp,
}: MetadataFactsProps) {
  const { t, i18n } = useTranslation();
  const rich = item.kind === "file" && !item.online_only ? item.path : null;
  const metadata = useMetadata(rich, active, item);
  const info: MetadataInfo | null = metadata.status === "ready" ? metadata.info : null;
  const previewInfo = usePreviewInfo(rich, item.online_only, item, active);
  const showPreview =
    onOpen !== undefined &&
    previewInfo !== null &&
    previewTargetFor(previewInfo).kind === "preview";

  if (rich === null) return null;

  return (
    <section className="adp-metadata">
      {metadata.status === "loading" ? (
        <div className="adp-metadata-skeleton" role="status" aria-label={t("explorer.details.loading")}>
          <span className="adp-metadata-skeleton-row" />
          <span className="adp-metadata-skeleton-row" />
          <span className="adp-metadata-skeleton-row" />
        </div>
      ) : null}
      {metadata.error === "background.paused" ? (
        <p className="adp-metadata-partial">{t("errors.background.paused")}</p>
      ) : null}
      {info && info.fields.length > 0 ? (
        <>
          <dl className="adp-metadata-facts">
            {info.fields.map((field) => (
              <Fragment key={field.id}>
                <dt>{t(metadataLabelKey(field.id))}</dt>
                <dd>{formatMetadataValue(field, t, i18n.language)}</dd>
              </Fragment>
            ))}
          </dl>
          {info.partial ? <p className="adp-metadata-partial">{t("metadata.partial")}</p> : null}
        </>
      ) : null}
      {showPreview && previewInfo ? (
        <div className={`adp-metadata-preview adp-metadata-preview--${variant}`}>
          <PreviewSurface
            info={previewInfo}
            active={active}
            background
            sourceRevision={item}
            onOpen={async () => {
              onOpen?.(item);
            }}
            onOpenHelp={onOpenHelp}
          />
        </div>
      ) : null}
    </section>
  );
}
