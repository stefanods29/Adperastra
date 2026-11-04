import { Pencil, Search as SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../components/Dialog";
import { formatDate } from "../../services/format";
import type { IndexRoot, SearchQuery } from "../../services/search";
import type { NaturalQueryPreview } from "../../services/aiSearchTypes";
import FilterBuilder, { type FilterDraft } from "../FilterBuilder";
import { naturalQueryChips } from "./naturalQuery";

export interface NaturalQueryPreviewPanelProps {
  preview: NaturalQueryPreview;
  roots: IndexRoot[];
  busy?: boolean;
  onSearch: (edited: SearchQuery) => void;
  onCancel: () => void;
  onOpenHelp: (slug: string) => void;
}

const FIELD_KEYS: Record<string, string> = {
  name: "explorer.columnName",
  kind: "search.fieldKind",
  ext: "search.fieldExtension",
  author: "search.fieldAuthor",
  size: "search.fieldSize",
  width: "search.fieldWidth",
  height: "search.fieldHeight",
  duration_ms: "search.fieldDuration",
  pages: "search.fieldPages",
  modified: "search.fieldModified",
  created: "search.fieldCreated",
  date_taken: "search.fieldDateTaken",
};

const OP_KEYS: Record<string, string> = {
  eq: "search.opEquals",
  contains: "search.opContains",
  gte: "search.opAtLeast",
  lte: "search.opAtMost",
};

/** Width 760 (max viewport minus 32), wrapped chips and keyboard-first. */
export default function NaturalQueryPreviewPanel({
  preview,
  roots,
  busy,
  onSearch,
  onCancel,
  onOpenHelp,
}: NaturalQueryPreviewPanelProps) {
  const { t, i18n } = useTranslation();
  const [edited, setEdited] = useState<SearchQuery | null>(preview.query);
  const [editorOpen, setEditorOpen] = useState(false);
  const firstChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstChip.current?.focus();
  }, []);

  const chips = useMemo(
    () => naturalQueryChips(edited ? { ...preview, query: edited } : preview),
    [edited, preview],
  );
  const rootLabel = (rootId: string) => roots.find((root) => root.id === rootId)?.path ?? rootId;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement | null;
    // Enter on a chip or an editor control performs that control's action,
    // never an implicit search.
    if (target?.closest("button, input, select, textarea")) return;
    if (preview.status === "ready" && edited && !editorOpen) {
      event.preventDefault();
      onSearch(edited);
    }
  };

  const filterDraft: FilterDraft = {
    filter: edited?.filter ?? null,
    roots: edited?.roots ?? preview.query?.roots ?? [],
  };

  return (
    <Dialog title={t("aiSearch.preview")} onClose={onCancel} className="ai-query-preview">
      <div className="ai-query-preview__body" onKeyDown={onKeyDown}>
        <p className="ai-query-preview__explanation">{preview.explanation}</p>
        {preview.status === "clarify" ? (
          <p className="ai-query-preview__clarify" role="status">
            {preview.unsupported.length > 0
              ? preview.unsupported.join(", ")
              : t("errors.ai_search.ambiguous")}
          </p>
        ) : (
          <>
            <div className="ai-query-chips" role="list" aria-label={t("aiSearch.preview")}>
              {chips.map((chip, index) => (
                <button
                  key={`${chip.kind}-${index}`}
                  ref={index === 0 ? firstChip : undefined}
                  type="button"
                  className="ai-query-chip"
                  role="listitem"
                  onClick={() => setEditorOpen(true)}
                >
                  {chip.kind === "root" ? (
                    <span>{rootLabel(chip.root_id ?? "")}</span>
                  ) : chip.kind === "date" ? (
                    <span>
                      {t(FIELD_KEYS[chip.field ?? "modified"] ?? "search.fieldModified")}:{" "}
                      {chip.from_unix ? formatDate(chip.from_unix, i18n.language) : ""}
                      {chip.from_unix && chip.to_unix ? " – " : ""}
                      {chip.to_unix ? formatDate(chip.to_unix, i18n.language) : ""}
                    </span>
                  ) : chip.kind === "extension" ? (
                    <span>
                      {t("search.fieldExtension")}: {String(chip.value ?? "")}
                    </span>
                  ) : chip.kind === "missing" ? (
                    <span>
                      {t(FIELD_KEYS[chip.field ?? "modified"] ?? "search.fieldModified")}: —
                    </span>
                  ) : chip.kind === "sort" ? (
                    <span>
                      {t("commands.sortBy", {
                        name: t(FIELD_KEYS[chip.field ?? "name"] ?? "search.fieldKind"),
                      })}
                      :{" "}
                      {t(chip.value === "ascending" ? "commands.sortAscending" : "commands.sortDescending")}
                    </span>
                  ) : (
                    <span>
                      {t(FIELD_KEYS[chip.field ?? ""] ?? "search.fieldKind")}{" "}
                      {t(OP_KEYS[chip.op ?? ""] ?? "search.opEquals")} {String(chip.value ?? "")}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="ai-query-preview__actions">
              <button type="button" className="adp-btn" onClick={() => setEditorOpen(true)}>
                <Pencil size={16} aria-hidden="true" />
                {t("search.filters")}
              </button>
              <button
                type="button"
                className="adp-btn adp-btn--primary"
                disabled={busy || preview.status !== "ready" || !edited}
                onClick={() => edited && onSearch(edited)}
              >
                <SearchIcon size={16} aria-hidden="true" />
                {t("aiSearch.search")}
              </button>
              <button type="button" className="adp-btn" onClick={onCancel}>
                {t("aiSearch.cancel")}
              </button>
              <button type="button" className="adp-btn" onClick={() => onOpenHelp("natural-language-search")}>
                {t("search.help")}
              </button>
            </div>
          </>
        )}
        <p className="ai-query-preview__status" aria-live="polite">
          {busy ? t("aiSearch.progress") : ""}
        </p>
        {editorOpen ? (
          <FilterBuilder
            value={filterDraft}
            roots={roots}
            onChange={(next) => {
              if (!edited) return;
              setEdited({ ...edited, filter: next.filter, roots: next.roots });
            }}
            onClose={() => setEditorOpen(false)}
            onOpenHelp={onOpenHelp}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
