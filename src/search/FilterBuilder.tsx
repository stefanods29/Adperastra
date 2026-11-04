import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../components/Dialog";
import type { IndexRoot, SearchFilter } from "../services/search";

export interface FilterDraft {
  filter: SearchFilter | null;
  roots: string[];
}

export interface FilterBuilderProps {
  value: FilterDraft;
  roots: IndexRoot[];
  onChange: (value: FilterDraft) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

type LeafType = "string" | "number" | "date";

interface LeafDraft {
  id: string;
  type: LeafType;
  field: string;
  op: string;
  value: string;
  from: string;
  to: string;
}

const FIELD_KEYS: Record<string, string> = {
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

let leafCounter = 0;

function nextId(): string {
  leafCounter += 1;
  return `leaf-${leafCounter}`;
}

function stringLeaves(filter: SearchFilter | null): LeafDraft[] {
  if (!filter) return [];
  if (filter.kind === "all" || filter.kind === "any") {
    return filter.clauses.flatMap((clause): LeafDraft[] => {
      const leaf = leafFor(clause);
      return leaf ? [leaf] : [];
    });
  }
  const leaf = leafFor(filter);
  return leaf ? [leaf] : [];
}

function leafFor(clause: SearchFilter): LeafDraft | null {
  if (clause.kind === "string") {
    return {
      id: nextId(),
      type: "string",
      field: clause.field,
      op: clause.op,
      value: clause.value,
      from: "",
      to: "",
    };
  }
  if (clause.kind === "number") {
    return {
      id: nextId(),
      type: "number",
      field: clause.field,
      op: clause.op,
      value: String(clause.value),
      from: "",
      to: "",
    };
  }
  if (clause.kind === "date") {
    return {
      id: nextId(),
      type: "date",
      field: clause.field,
      op: "eq",
      value: "",
      from: unixToDate(clause.from_unix),
      to: unixToDate(clause.to_unix),
    };
  }
  return null;
}

function isLeafClause(clause: SearchFilter): boolean {
  return clause.kind === "string" || clause.kind === "number" || clause.kind === "date";
}

/** Clauses this dialog cannot edit (tags, `not`, extension sets, missing
 * dates, nested groups) are kept in the query instead of being dropped when
 * any other condition changes. */
function lockedClauses(filter: SearchFilter | null): SearchFilter[] {
  if (!filter) return [];
  if (filter.kind === "all" || filter.kind === "any") {
    return filter.clauses.filter((clause) => !isLeafClause(clause));
  }
  return isLeafClause(filter) ? [] : [filter];
}

function unixToDate(value: number | undefined): string {
  if (value === undefined) return "";
  // Show the calendar day in the user's local zone, matching the bounds the
  // date inputs produce below.
  const date = new Date(value * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateToUnix(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  // Fixed local-day bounds: the captured query is independent of later
  // clock changes but still means the day the user picked.
  const date = new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
  );
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function leafToFilter(leaf: LeafDraft): SearchFilter | null {
  if (leaf.type === "string") {
    return {
      kind: "string",
      field: leaf.field as "kind" | "ext" | "author",
      op: leaf.op as "eq" | "contains",
      value: leaf.value,
    };
  }
  if (leaf.type === "number") {
    const value = Number(leaf.value);
    if (!Number.isFinite(value) || value < 0) return null;
    return {
      kind: "number",
      field: leaf.field as "size" | "width" | "height" | "duration_ms" | "pages",
      op: leaf.op as "eq" | "gte" | "lte",
      value,
    };
  }
  const from = dateToUnix(leaf.from, false);
  const to = dateToUnix(leaf.to, true);
  if (from === undefined && to === undefined) return null;
  return {
    kind: "date",
    field: leaf.field as "modified" | "created" | "date_taken",
    from_unix: from,
    to_unix: to,
  };
}

/** Typed filter dialog (760 px). Dates become fixed epoch bounds for the
 * chosen local days; clauses this dialog cannot edit are preserved. */
export default function FilterBuilder({
  value,
  roots,
  onChange,
  onClose,
  onOpenHelp,
}: FilterBuilderProps) {
  const { t } = useTranslation();
  const initialMatch = value.filter?.kind === "any" ? "any" : "all";
  const [matchKind, setMatchKind] = useState<"all" | "any">(initialMatch);
  const [leaves, setLeaves] = useState<LeafDraft[]>(() => stringLeaves(value.filter));
  const [locked] = useState<SearchFilter[]>(() => lockedClauses(value.filter));

  const selectedRoots = useMemo(() => new Set(value.roots), [value.roots]);

  const publish = (nextLeaves: LeafDraft[], nextMatch: "all" | "any", nextRoots: string[]) => {
    const clauses = [
      ...locked,
      ...nextLeaves
        .map(leafToFilter)
        .filter((clause): clause is SearchFilter => clause !== null),
    ];
    const filter: SearchFilter | null =
      clauses.length === 0
        ? null
        : nextMatch === "any"
          ? { kind: "any", clauses }
          : { kind: "all", clauses };
    onChange({ filter, roots: nextRoots });
  };

  const updateLeaf = (id: string, patch: Partial<LeafDraft>) => {
    const next = leaves.map((leaf) => (leaf.id === id ? { ...leaf, ...patch } : leaf));
    setLeaves(next);
    publish(next, matchKind, [...value.roots]);
  };

  const addLeaf = (type: LeafType) => {
    const field = type === "string" ? "kind" : type === "number" ? "size" : "modified";
    const op = type === "string" ? "contains" : type === "number" ? "gte" : "eq";
    const next = [
      ...leaves,
      { id: nextId(), type, field, op, value: "", from: "", to: "" } satisfies LeafDraft,
    ];
    setLeaves(next);
    publish(next, matchKind, [...value.roots]);
  };

  const removeLeaf = (id: string) => {
    const next = leaves.filter((leaf) => leaf.id !== id);
    setLeaves(next);
    publish(next, matchKind, [...value.roots]);
  };

  const setMatch = (nextMatch: "all" | "any") => {
    setMatchKind(nextMatch);
    publish(leaves, nextMatch, [...value.roots]);
  };

  const toggleRoot = (id: string) => {
    const next = selectedRoots.has(id)
      ? value.roots.filter((root) => root !== id)
      : [...value.roots, id];
    publish(leaves, matchKind, next);
  };

  return (
    <Dialog title={t("search.filters")} onClose={onClose} className="adp-search-filter-dialog">
      <div className="adp-search-filter">
        <div className="adp-search-filter__match" role="group" aria-label={t("search.filters")}>
          <button
            type="button"
            className={matchKind === "all" ? "adp-btn adp-btn--primary" : "adp-btn"}
            aria-pressed={matchKind === "all"}
            onClick={() => setMatch("all")}
          >
            {t("search.opAll")}
          </button>
          <button
            type="button"
            className={matchKind === "any" ? "adp-btn adp-btn--primary" : "adp-btn"}
            aria-pressed={matchKind === "any"}
            onClick={() => setMatch("any")}
          >
            {t("search.opAny")}
          </button>
        </div>

        <div className="adp-search-filter__rows">
          {leaves.map((leaf) => (
            <div className="adp-search-filter__row" key={leaf.id}>
              <select
                aria-label={t("search.field")}
                value={leaf.field}
                onChange={(event) => {
                  const field = event.target.value;
                  const type: LeafType = ["kind", "ext", "author"].includes(field)
                    ? "string"
                    : ["modified", "created", "date_taken"].includes(field)
                      ? "date"
                      : "number";
                  updateLeaf(leaf.id, {
                    field,
                    type,
                    op: type === "string" ? "contains" : type === "number" ? "gte" : "eq",
                  });
                }}
              >
                {Object.entries(FIELD_KEYS).map(([field, key]) => (
                  <option key={field} value={field}>
                    {t(key)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("search.operator")}
                value={leaf.op}
                onChange={(event) => updateLeaf(leaf.id, { op: event.target.value })}
              >
                {Object.entries(OP_KEYS)
                  .filter(([op]) =>
                    leaf.type === "string"
                      ? op === "eq" || op === "contains"
                      : leaf.type === "number"
                        ? op === "eq" || op === "gte" || op === "lte"
                        : op === "eq",
                  )
                  .map(([op, key]) => (
                    <option key={op} value={op}>
                      {t(key)}
                    </option>
                  ))}
              </select>
              {leaf.type === "date" ? (
                <>
                  <input
                    className="adp-input"
                    type="date"
                    aria-label={t("search.from")}
                    value={leaf.from}
                    onChange={(event) => updateLeaf(leaf.id, { from: event.target.value })}
                  />
                  <input
                    className="adp-input"
                    type="date"
                    aria-label={t("search.to")}
                    value={leaf.to}
                    onChange={(event) => updateLeaf(leaf.id, { to: event.target.value })}
                  />
                </>
              ) : (
                <input
                  className="adp-input"
                  type={leaf.type === "number" ? "number" : "text"}
                  aria-label={t(FIELD_KEYS[leaf.field] ?? "search.fieldKind")}
                  value={leaf.value}
                  onChange={(event) => updateLeaf(leaf.id, { value: event.target.value })}
                />
              )}
              <button
                type="button"
                className="adp-icon-btn"
                aria-label={t("search.removeCondition")}
                title={t("search.removeCondition")}
                onClick={() => removeLeaf(leaf.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <div className="adp-search-filter__add">
          <button type="button" className="adp-btn" onClick={() => addLeaf("string")}>
            <Plus size={16} aria-hidden="true" />
            {t("search.addCondition")}
          </button>
        </div>

        <fieldset className="adp-search-filter__folders">
          <legend>{t("search.fieldFolder")}</legend>
          {roots.map((root) => (
            <label key={root.id}>
              <input
                type="checkbox"
                checked={selectedRoots.has(root.id)}
                onChange={() => toggleRoot(root.id)}
              />
              <span>{root.path}</span>
            </label>
          ))}
        </fieldset>

        <div className="adp-search-filter__footer">
          <button type="button" className="adp-btn" onClick={() => onOpenHelp("search-filters")}>
            {t("search.help")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
