import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PsdLayerInfo } from "../../services/specialViews";

export interface PsdLayersProps {
  layers: readonly PsdLayerInfo[];
  query: string;
  onQuery: (value: string) => void;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onMore: () => void;
}

/** Layer names are rendered as text nodes only. */
export default function PsdLayers({ layers, query, onQuery, loading, error, hasMore, onMore }: PsdLayersProps) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 });
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? layers.filter((layer) => layer.name.toLocaleLowerCase().includes(needle)) : layers;
  return (
    <aside className="adp-psd-layers" aria-label={t("psd.layers")}>
      <div className="adp-psd-layers-header">
        <span>{t("psd.layers")}</span>
      </div>
      <label className="adp-psd-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="adp-input"
          type="search"
          value={query}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          onChange={(event) => onQuery(event.currentTarget.value)}
        />
      </label>
      {error ? <p className="adp-psd-note" role="alert">{error}</p> : null}
      {loading && shown.length === 0 ? <p className="adp-psd-note">{t("preview.loading")}</p> : null}
      <ul className="adp-psd-layer-list">
        {shown.map((layer) => (
          <li key={layer.id} className="adp-psd-layer-row" style={{ paddingLeft: `${12 + depthOf(layers, layer) * 12}px` }}>
            <span className={layer.visible ? "adp-psd-eye" : "adp-psd-eye adp-psd-eye--hidden"} aria-hidden="true" />
            <span className="adp-psd-layer-name" title={layer.name}>{layer.name}</span>
            <span className="adp-psd-layer-opacity" aria-hidden="true">{percent.format(layer.opacity)}</span>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button type="button" className="adp-btn adp-btn--subtle" disabled={loading} onClick={onMore}>
          {loading ? t("preview.loading") : t("common.moreOptions")}
        </button>
      ) : null}
    </aside>
  );
}

function depthOf(layers: readonly PsdLayerInfo[], layer: PsdLayerInfo): number {
  let depth = 0;
  let parent = layer.parent;
  const seen = new Set<number>();
  while (parent !== null && seen.size < 32) {
    if (seen.has(parent)) break;
    seen.add(parent);
    depth += 1;
    parent = layers.find((item) => item.id === parent)?.parent ?? null;
  }
  return depth;
}
