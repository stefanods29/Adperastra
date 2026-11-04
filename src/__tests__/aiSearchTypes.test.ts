import { describe, expect, it } from "vitest";
import type { SearchFilter, SearchQuery } from "../services/search";
import {
  defaultAiSearchSettings,
  eligibleSemanticRoots,
  explicitRenameNamesValid,
  normalizeAiSearchSettings,
  upgradeAiSearchSettings,
  validateAiSearchQuery,
  validateSearchFilter,
} from "../services/aiSearchTypes";
import { validateAiSearchSettings } from "../search/ai/aiSearchSettings";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";

const filterQuery = (filter: SearchFilter | null): SearchQuery => ({
  mode: "filters",
  text: "",
  roots: [ROOT_A],
  filter,
  regex_scope: "name",
  match_case: false,
  sort: { key: "name", direction: "ascending" },
});

describe("ai search contracts", () => {
  it("ai_search_defaults_are_off", () => {
    const settings = upgradeAiSearchSettings(
      {
        semantic_text: true,
        photo_index: true,
        natural_query: true,
        rename: true,
        sort: true,
        roots: [{ root_id: ROOT_A, text: true, photos: true }],
        destinations: [{ id: ROOT_B, path: "C:\\Pictures", name: "Pictures" }],
        disabled_sort_extensions: ["pdf"],
      },
      45,
    );
    expect(settings).toEqual(defaultAiSearchSettings());
    expect(settings.semantic_text).toBe(false);
    expect(settings.photo_index).toBe(false);
    expect(settings.natural_query).toBe(false);
    expect(settings.rename).toBe(false);
    expect(settings.sort).toBe(false);
    expect(settings.roots).toEqual([]);
  });

  it("ai_query_uses_search_filter", () => {
    const valid = filterQuery({
      kind: "all",
      clauses: [
        { kind: "string", field: "ext", op: "eq", value: "pdf" },
        { kind: "number", field: "size", op: "gte", value: 5_242_881 },
      ],
    });
    expect(validateAiSearchQuery(valid)).toBe(true);

    const unknownSqlField = filterQuery({
      kind: "string",
      field: "sql",
      op: "eq",
      value: "DROP TABLE files",
    } as unknown as SearchFilter);
    expect(validateSearchFilter(unknownSqlField.filter as SearchFilter)).toBe(false);
    expect(validateAiSearchQuery(unknownSqlField)).toBe(false);

    const unknownOperator = filterQuery({
      kind: "number",
      field: "size",
      op: "between",
      value: 10,
    } as unknown as SearchFilter);
    expect(validateAiSearchQuery(unknownOperator)).toBe(false);
  });

  it("explicit_names_requires_unique_indices", () => {
    expect(
      explicitRenameNamesValid(
        [
          { input_index: 0, new_name: "Invoice.pdf" },
          { input_index: 0, new_name: "Other.pdf" },
        ],
        [0, 1],
      ),
    ).toBe(false);
    expect(
      explicitRenameNamesValid(
        [
          { input_index: 0, new_name: "Invoice.pdf" },
          { input_index: 1, new_name: "Notes.txt" },
        ],
        [0, 1],
      ),
    ).toBe(true);
  });

  it("sensitive_root_refused", () => {
    const settings = normalizeAiSearchSettings({
      semantic_text: true,
      roots: [{ root_id: ROOT_A, text: true, photos: false }],
    });
    const indexRoots = [
      {
        id: ROOT_A,
        path: "C:\\Documents",
        filename: true,
        content: true,
        ocr: false,
        enabled: true,
      },
    ];
    expect(eligibleSemanticRoots(settings, indexRoots, [ROOT_A], "text")).toEqual([]);
    expect(eligibleSemanticRoots(settings, indexRoots, [], "text")).toHaveLength(1);
    expect(validateAiSearchSettings(settings, indexRoots, [ROOT_A])).toBe("ai_search.sensitive");
  });
});
