/** Registered Home sections (Step 10e T3).
 *
 * A section renders only while it is visible and expanded, in the saved DOM
 * order (no CSS reordering), and asks its provider for at most 100 rows. A
 * stale or aborted load never replaces newer content; disposing the section
 * aborts its provider (D4).
 */
import { ChevronDown, ChevronRight, File, Folder, Layers, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "../components/Skeleton";
import { errorCode } from "../services/errors";
import { sectionLabelKey, safeHomeLimit } from "./homeProviders";
import {
  type HomeCustomization,
  type HomeSectionProvider,
  type HomeSectionSize,
  type ShellItem,
  MAX_HOME_LIMIT,
} from "./types";

export interface HomeSectionHostProps {
  layout: HomeCustomization;
  providers: readonly HomeSectionProvider[];
  onActivate: (item: ShellItem) => void | Promise<void>;
  onToggleCollapsed?: (id: string) => void;
  onError?: (code: string) => void;
  /** Bump to reload every visible section. */
  refreshKey?: number;
}

interface BodyState {
  items: readonly ShellItem[];
  loading: boolean;
  error: string | null;
}

function ItemIcon({ item }: { item: ShellItem }) {
  if (item.icon_id === "layers") return <Layers size={18} aria-hidden="true" />;
  if (item.icon_id === "sparkles") return <Sparkles size={18} aria-hidden="true" />;
  if (item.kind === "folder") return <Folder size={18} aria-hidden="true" />;
  return <File size={18} aria-hidden="true" />;
}

function HomeSectionBody({
  provider,
  limit,
  size,
  refreshKey,
  onActivate,
  onError,
}: {
  provider: HomeSectionProvider;
  limit: number;
  size: HomeSectionSize;
  refreshKey: number;
  onActivate: (item: ShellItem) => void | Promise<void>;
  onError?: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<BodyState>({ items: [], loading: true, error: null });
  const generation = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    const current = generation.current;
    setState({ items: [], loading: true, error: null });
    provider
      .load(limit, controller.signal)
      .then((items) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setState({ items: items.slice(0, limit), loading: false, error: null });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        const code = errorCode(failure);
        if (code === "AbortError") return;
        setState({ items: [], loading: false, error: code || "shell.load" });
        onErrorRef.current?.(code || "shell.load");
      });
    return () => controller.abort();
  }, [provider, limit, refreshKey]);

  if (state.loading) return <Skeleton variant="tiles" count={3} />;
  if (state.error) return <p className="adp-empty-note">{t("explorer.loadError")}</p>;
  if (state.items.length === 0) return null;

  return (
    <div className="adp-home-section__grid">
      {state.items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`adp-home-section__card adp-home-section__card--${size}`}
          data-shell-item-id={item.id}
          disabled={item.disabled_reason_key !== undefined}
          title={item.disabled_reason_key ? t(item.disabled_reason_key) : item.detail}
          onClick={() => {
            if (item.disabled_reason_key) return;
            void Promise.resolve(onActivate(item)).catch((failure: unknown) => onError?.(errorCode(failure)));
          }}
        >
          <span className="adp-home-section__icon">
            <ItemIcon item={item} />
          </span>
          <span className="adp-home-section__text">
            <span className="adp-home-section__label">{item.label}</span>
            {item.detail ? <span className="adp-home-section__detail">{item.detail}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function HomeSectionHost(props: HomeSectionHostProps) {
  const { t } = useTranslation();

  return (
    <div className="adp-home-section-host">
      {props.layout.sections.map((section) => {
        if (!section.visible) return null;
        const provider = props.providers.find((entry) => entry.id === section.id) ?? null;
        const label = provider ? t(provider.label_key) : t(sectionLabelKey(section.id));
        const limit = safeHomeLimit(Math.min(section.limit, MAX_HOME_LIMIT));
        return (
          <section
            key={section.id}
            className={`adp-home-section${provider ? "" : " adp-home-section--missing"}`}
            data-section-id={section.id}
            data-section-visible={section.visible ? "true" : "false"}
            aria-label={label}
          >
            <div className="adp-home-section__header">
              <button
                type="button"
                className="adp-home-section__toggle"
                aria-expanded={!section.collapsed}
                aria-controls={`adp-home-section-${section.id}`}
                disabled={!provider || !section.visible}
                onClick={() => props.onToggleCollapsed?.(section.id)}
              >
                {section.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                <span>{label}</span>
              </button>
              {!provider ? <span className="adp-home-section__missing">{t("toolbarCustom.missing")}</span> : null}
            </div>
            {section.visible && provider && !section.collapsed ? (
              <div id={`adp-home-section-${section.id}`}>
                <HomeSectionBody
                  provider={provider}
                  limit={limit}
                  size={section.size}
                  refreshKey={props.refreshKey ?? 0}
                  onActivate={props.onActivate}
                  onError={props.onError}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
