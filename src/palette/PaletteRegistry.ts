import type { PaletteEntry, PaletteHost, PaletteProvider } from "./types";

const KINDS = new Set(["command", "folder", "recent_file", "tab", "saved_group", "settings", "help"]);
const allowed = new Set(["id", "kind", "label_key", "runtime_label", "english_label", "keywords", "description", "shortcut", "disabled_reason_key", "enabled", "target_id"]);
function bounded(value: unknown, max: number): value is string { return typeof value === "string" && [...value].length <= max && !value.includes("\0"); }
export function validatePaletteEntry(entry: PaletteEntry): void {
  if (!entry || Object.getPrototypeOf(entry) !== Object.prototype || Object.keys(entry).some((key) => !allowed.has(key)) ||
    !bounded(entry.id, 32768) || !entry.id.startsWith(`${entry.kind}:`) || !KINDS.has(entry.kind) ||
    !bounded(entry.target_id, 32768) || !bounded(entry.english_label, 512) ||
    !Array.isArray(entry.keywords) || entry.keywords.length > 32 || !entry.keywords.every((word) => bounded(word, 128)) ||
    typeof entry.enabled !== "boolean" || (entry.label_key !== undefined && !bounded(entry.label_key, 512)) ||
    (entry.runtime_label !== undefined && !bounded(entry.runtime_label, 512)) ||
    (entry.description !== undefined && !bounded(entry.description, 512)) || (entry.shortcut !== undefined && !bounded(entry.shortcut, 128)) ||
    (entry.disabled_reason_key !== undefined && !bounded(entry.disabled_reason_key, 512))) throw new Error("palette.invalid");
}
export class PaletteRegistry {
  private providers = new Map<string, PaletteProvider>();
  private entries = new Map<string, { entry: PaletteEntry; provider: PaletteProvider }>();
  private generation = 0;
  registerProvider(id: string, provider: PaletteProvider): () => void {
    if (!id || this.providers.has(id)) throw new Error("palette.invalid");
    this.providers.set(id, provider);
    this.generation += 1;
    return () => {
      if (this.providers.get(id) !== provider) return;
      this.providers.delete(id); this.generation += 1;
      for (const [key, value] of this.entries) if (value.provider === provider) this.entries.delete(key);
    };
  }
  async collect(): Promise<readonly PaletteEntry[]> {
    const generation = ++this.generation;
    const providers = [...this.providers.values()];
    const snapshots = await Promise.all(providers.map(async (provider) => ({ provider, entries: await provider.snapshot() })));
    const next = new Map<string, { entry: PaletteEntry; provider: PaletteProvider }>();
    const seen = new Set<string>();
    if (snapshots.reduce((count, snapshot) => count + snapshot.entries.length, 0) > 10000) throw new Error("palette.invalid");
    let locations = 0;
    for (const snapshot of snapshots) for (const input of snapshot.entries) {
      validatePaletteEntry(input);
      if (seen.has(input.id)) throw new Error("palette.invalid");
      seen.add(input.id);
      if ((input.kind === "folder" || input.kind === "recent_file") && ++locations > 500) continue;
      if (next.size >= 10000) throw new Error("palette.invalid");
      const entry = Object.freeze({ ...input, keywords: Object.freeze([...input.keywords]) as unknown as string[] });
      next.set(entry.id, { entry, provider: snapshot.provider });
    }
    if (generation !== this.generation) throw new Error("palette.unavailable");
    this.entries = next;
    return [...next.values()].map(({ entry }) => entry);
  }
  async dispatch(id: string, host: PaletteHost): Promise<void> {
    const item = this.entries.get(id);
    if (!item || !item.entry.enabled) throw new Error("palette.unavailable");
    await item.provider.dispatch(item.entry, host);
  }
}
