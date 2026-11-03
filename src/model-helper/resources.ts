/** Model resource permissions (Step 07g D2).
 *
 * The helper never receives a folder. Native code grants each resource the
 * selected model actually names; this policy maps a relative URI to one of
 * those application-issued grant URLs and refuses everything else. No
 * fetch, loader or texture request is created for an unlisted URI, so a
 * remote texture in a malicious glTF produces zero HTTP requests. */

export interface ResourceGrant {
  /** Normalized relative name, for example `textures/wood.png`. */
  name: string;
  /** `http://adpfile.localhost/<token>/<name>` from the host. */
  url: string;
  byte_len?: number;
}

export class ModelResourceError extends Error {
  constructor(readonly code: "special_view.unsupported" | "special_view.too_large") {
    super(code);
    this.name = "ModelResourceError";
  }
}

function unsafeUri(value: string): boolean {
  if (value === "" || value.length > 1024) return true;
  // Any scheme, including http, https, file, data and javascript.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return true;
  if (value.startsWith("//") || value.startsWith("\\\\")) return true;
  return false;
}

/** Normalize a relative model path. Returns null for absolute paths,
 * drive letters, UNC paths, URL schemes and any `.`/`..` segment. */
export function normalizeModelResourcePath(value: string, allowLeadingSlash = false): string | null {
  if (unsafeUri(value)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (unsafeUri(decoded)) return null;
  let text = decoded.replace(/\\/g, "/");
  if (allowLeadingSlash) text = text.replace(/^\/+/, "");
  if (text === "" || text.startsWith("/") || /^[a-zA-Z]:/.test(text)) return null;
  const segments = text.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

/** Grants by normalized lower-case name. Duplicate names are refused: two
 * grants for one URI would make the selected bytes ambiguous. */
export class ModelResourcePolicy {
  private readonly byKey = new Map<string, ResourceGrant>();

  constructor(grants: readonly ResourceGrant[]) {
    if (grants.length > 256) throw new ModelResourceError("special_view.too_large");
    for (const grant of grants) {
      const name = normalizeModelResourcePath(grant.name, true);
      if (!name) continue;
      const key = name.toLowerCase();
      if (this.byKey.has(key)) throw new ModelResourceError("special_view.unsupported");
      this.byKey.set(key, grant);
    }
  }

  /** A glTF/OBJ-relative resource. `null` means "refused". */
  resolve(requested: string): string | null {
    const name = normalizeModelResourcePath(requested);
    return name ? this.byKey.get(name.toLowerCase())?.url ?? null : null;
  }

  /** A 3MF archive path such as `/3D/Textures/wood.png`. */
  resolveArchive(requested: string): string | null {
    const name = normalizeModelResourcePath(requested, true);
    return name ? this.byKey.get(name.toLowerCase())?.url ?? null : null;
  }

  /** Resolve every URI the glTF names, or refuse the whole model before the
   * GLTFLoader is created. Data URIs are refused too: the helper accepts
   * only application-issued grants. */
  requireAll(requested: readonly string[]): string[] {
    const urls: string[] = [];
    for (const uri of requested) {
      const url = this.resolve(uri);
      if (!url) throw new ModelResourceError("special_view.unsupported");
      urls.push(url);
    }
    return urls;
  }
}

export interface GltfResourceReference {
  kind: "buffer" | "image";
  uri: string;
}

/** Collect the external buffer and image URIs from a parsed glTF JSON. */
export function gltfResourceReferences(json: unknown): GltfResourceReference[] {
  if (json === null || typeof json !== "object") return [];
  const document = json as { buffers?: unknown; images?: unknown };
  const references: GltfResourceReference[] = [];
  const collect = (kind: "buffer" | "image", value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      if (entry && typeof entry === "object") {
        const uri = (entry as { uri?: unknown }).uri;
        if (typeof uri === "string" && uri !== "") references.push({ kind, uri });
      }
    }
  };
  collect("buffer", document.buffers);
  collect("image", document.images);
  if (references.length > 256) throw new ModelResourceError("special_view.too_large");
  return references;
}

/** A glTF may embed its buffer through GLB instead of a URI. */
export function isGlb(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes);
  return view.getUint32(0, true) === 0x46546c67; // "glTF"
}
