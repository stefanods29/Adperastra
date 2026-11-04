import { describe, expect, it } from "vitest";
import { BUILTIN_DECK_STYLES } from "../office/deck/styles/builtins";
import {
  DECK_STYLE_CATALOG_ADAPTER_ID,
  catalogDiff,
  recordDeckStyleCatalogChange,
  registerDeckStyleCatalogHistory,
  sameCatalogContent,
  type DeckStyleCatalogHistoryHost,
  type DeckStyleCatalogHistoryRegistry,
} from "../office/deck/styles/styleCatalogHistory";
import {
  assertRemovableDeckStyle,
  deckStyleNameCollision,
  validateDeckStyleCatalog,
} from "../office/deck/styles/styleValidation";
import {
  DeckStyleError,
  type DeckStyle,
  type DeckStyleCatalog,
} from "../office/deck/styles/styleTypes";

function userStyle(index: number, name: string): DeckStyle {
  const base = structuredClone(BUILTIN_DECK_STYLES[0]) as DeckStyle;
  const id = `220b0100-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  base.id = id;
  base.theme.id = id;
  base.builtin = false;
  base.name_key = null;
  base.name = name;
  base.description_key = null;
  base.created_unix = 1;
  base.modified_unix = 1;
  return base;
}

function code(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof DeckStyleError ? error.code : "unexpected";
  }
}

class FakeHost implements DeckStyleCatalogHistoryHost {
  catalog: DeckStyleCatalog = { schema_version: 1, styles: [], revision: 0 };
  failWrites = false;

  async list(): Promise<DeckStyleCatalog> {
    return structuredClone(this.catalog);
  }

  async save(style: DeckStyle, expectedRevision: number): Promise<DeckStyleCatalog> {
    if (this.failWrites) throw new DeckStyleError("deck_style.failed");
    if (expectedRevision !== this.catalog.revision) throw new DeckStyleError("deck_style.changed");
    if (style.builtin) throw new DeckStyleError("deck_style.invalid");
    if (this.catalog.styles.some((item) => item.id === style.id)) throw new DeckStyleError("deck_style.invalid");
    if (deckStyleNameCollision(this.catalog, style.name ?? "")) throw new DeckStyleError("deck_style.invalid");
    this.catalog = {
      schema_version: 1,
      styles: [...this.catalog.styles, structuredClone(style)],
      revision: this.catalog.revision + 1,
    };
    return structuredClone(this.catalog);
  }

  async remove(id: string, expectedRevision: number): Promise<DeckStyleCatalog> {
    if (this.failWrites) throw new DeckStyleError("deck_style.failed");
    if (expectedRevision !== this.catalog.revision) throw new DeckStyleError("deck_style.changed");
    assertRemovableDeckStyle(this.catalog, id);
    this.catalog = {
      schema_version: 1,
      styles: this.catalog.styles.filter((item) => item.id !== id),
      revision: this.catalog.revision + 1,
    };
    return structuredClone(this.catalog);
  }
}

class FakeRegistry implements DeckStyleCatalogHistoryRegistry {
  private adapter: { validate: (state: unknown) => boolean; apply: (state: unknown) => Promise<void> } | null = null;
  private records = new Map<string, { before: unknown; after: unknown }>();
  private nextId = 1;

  registerAdapter(id: string, adapter: { validate: (state: unknown) => boolean; apply: (state: unknown) => Promise<void> }): void {
    expect(id).toBe(DECK_STYLE_CATALOG_ADAPTER_ID);
    this.adapter = adapter;
  }

  record(adapterId: string, before: unknown, after: unknown): string {
    expect(adapterId).toBe(DECK_STYLE_CATALOG_ADAPTER_ID);
    expect(this.adapter?.validate(before)).toBe(true);
    expect(this.adapter?.validate(after)).toBe(true);
    const id = `record-${this.nextId++}`;
    this.records.set(id, { before, after });
    return id;
  }

  async apply(id: string, reverse: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error("missing record");
    const target = reverse ? record.before : record.after;
    if (!this.adapter?.validate(target)) return;
    await this.adapter.apply(target);
  }
}

describe("user style catalog", () => {
  it("fails a built-in delete and keeps eight built-ins", () => {
    const catalog: DeckStyleCatalog = { schema_version: 1, styles: [], revision: 0 };
    expect(code(() => assertRemovableDeckStyle(catalog, BUILTIN_DECK_STYLES[0].id))).toBe(
      "deck_style.invalid",
    );
    expect(BUILTIN_DECK_STYLES).toHaveLength(8);
  });

  it("asks for a new name on a case-insensitive collision", () => {
    const catalog: DeckStyleCatalog = {
      schema_version: 1,
      styles: [userStyle(1, "Quarterly report")],
      revision: 4,
    };
    expect(deckStyleNameCollision(catalog, "QUARTERLY REPORT")).toBe(true);
    expect(deckStyleNameCollision(catalog, "Quarterly report", catalog.styles[0].id)).toBe(false);
    expect(deckStyleNameCollision(catalog, "Quarterly report 2")).toBe(false);
  });

  it("rejects a stale expected revision without changing the catalog", () => {
    const host = new FakeHost();
    const style = userStyle(2, "Fresh");
    const stale = host.save(style, 9);
    return expect(stale).rejects.toMatchObject({ code: "deck_style.changed" }).then(() => {
      expect(host.catalog).toEqual({ schema_version: 1, styles: [], revision: 0 });
    });
  });

  it("keeps the catalog when a write fails", async () => {
    const host = new FakeHost();
    host.failWrites = true;
    const style = userStyle(3, "Never saved");
    await expect(host.save(style, 0)).rejects.toMatchObject({ code: "deck_style.failed" });
    expect(host.catalog.styles).toHaveLength(0);
    expect(host.catalog.revision).toBe(0);
  });

  it("restores the exact catalog with Undo and Redo", async () => {
    const host = new FakeHost();
    const registry = new FakeRegistry();
    registerDeckStyleCatalogHistory(registry, host);
    const before = await host.list();
    const style = userStyle(4, "History style");
    const after = await host.save(style, before.revision);
    const record = recordDeckStyleCatalogChange(registry, before, after);
    expect(catalogDiff(before, after).added?.id).toBe(style.id);

    await registry.apply(record, true);
    expect(sameCatalogContent(host.catalog, before)).toBe(true);
    expect(host.catalog.revision).toBe(2);

    await registry.apply(record, false);
    expect(sameCatalogContent(host.catalog, after)).toBe(true);
    expect(host.catalog.revision).toBe(3);
  });

  it("refuses a state over 4 MiB before any mutation", () => {
    const tooLarge = {
      schema_version: 1,
      styles: [],
      revision: 0,
      padding: "x".repeat(4 * 1024 * 1024),
    };
    expect(code(() => validateDeckStyleCatalog(tooLarge))).toBe("deck_style.too_large");
  });

  it("refuses an unreplayable multi-entry jump", () => {
    const before: DeckStyleCatalog = { schema_version: 1, styles: [], revision: 0 };
    const after: DeckStyleCatalog = {
      schema_version: 1,
      styles: [userStyle(5, "One"), userStyle(6, "Two")],
      revision: 1,
    };
    const registry = new FakeRegistry();
    registerDeckStyleCatalogHistory(registry, new FakeHost());
    expect(code(() => recordDeckStyleCatalogChange(registry, before, after))).toBe(
      "deck_style.history_full",
    );
  });
});
