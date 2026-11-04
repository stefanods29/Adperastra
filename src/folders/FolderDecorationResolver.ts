import type { FileIdentityKey } from "../services/fileIdentity";
import { folderViewKey } from "../services/folderViews";
import { validFolderDecoration, type FolderDecoration } from "../services/folderCustomization";

/** One profile-scoped resolver shared by every folder entry point. Native owns
 * identity, ancestor traversal and reparse boundaries; this cache never walks paths. */
export class FolderDecorationResolver {
  private readonly cache = new Map<string, { value: FolderDecoration; expires: number }>();
  private generation = 0;
  private disposed = false;

  constructor(private readonly read: (paths: readonly string[]) => Promise<FolderDecoration[]>) {}

  async resolve(paths: readonly string[]): Promise<readonly FolderDecoration[]> {
    if (this.disposed) throw new Error("folder_custom.changed");
    const generation = this.generation;
    const missing = new Map<string, string>();
    const resolved = new Map<string, FolderDecoration>();
    for (const path of paths) {
      const key = folderViewKey(path);
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) {
        resolved.set(key, cached.value);
        this.cache.delete(key);
        this.cache.set(key, cached);
      } else {
        this.cache.delete(key);
        missing.set(key, path);
      }
    }
    const entries = [...missing];
    for (let offset = 0; offset < entries.length; offset += 256) {
      const batch = entries.slice(offset, offset + 256);
      const values = await this.read(batch.map(([, path]) => path));
      if (this.disposed || generation !== this.generation) throw new Error("folder_custom.changed");
      if (values.length !== batch.length || !values.every(validFolderDecoration)) throw new Error("folder_custom.invalid");
      values.forEach((value, index) => {
        const key = batch[index][0];
        const owned = structuredClone(value);
        resolved.set(key, owned);
        this.cache.delete(key);
        this.cache.set(key, { value: owned, expires: Date.now() + 300_000 });
        while (this.cache.size > 1000) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
      });
    }
    return paths.map((path) => structuredClone(resolved.get(folderViewKey(path))!));
  }

  invalidate(keys: readonly FileIdentityKey[]): void {
    // An inherited record can affect any descendant, including cached aliases
    // of a stable ID. The wire decoration has no identity: clear conservatively.
    if (keys.length) this.invalidateAll();
  }

  /** A catalog mutation or identity overflow invalidates every entry; keeping
   * an inherited ancestor would otherwise show a look that no longer exists. */
  invalidateAll(): void {
    this.generation += 1;
    this.cache.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.cache.clear();
  }
}
