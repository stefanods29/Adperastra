import type { HelperGrantDTO } from "../services/helperBridge";

/** One EPUB entry limit for a single fetch (07d E7 range cap). */
export const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
/** The longest internal book path (D3). */
export const MAX_ENTRY_NAME_CHARS = 1024;

/** Normalize an internal EPUB entry name. Absolute paths, parent segments,
 * drive letters, NULs and empty names are refused; the book root is never a
 * privilege boundary that a path can cross. */
export function normalizeEntryName(name: string): string {
  if (typeof name !== "string") throw new Error("extra_view.bad_request");
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    throw new Error("extra_view.bad_request");
  }
  decoded = decoded.replace(/\\/g, "/");
  if (decoded.length === 0 || decoded.length > MAX_ENTRY_NAME_CHARS) {
    throw new Error("extra_view.bad_request");
  }
  if (decoded.startsWith("/") || decoded.includes("\0")) {
    throw new Error("extra_view.bad_request");
  }
  if (/^[A-Za-z]:/.test(decoded)) throw new Error("extra_view.bad_request");
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Error("extra_view.bad_request");
    if (/[\u0000-\u001f<>:"|?*]/.test(part)) {
      throw new Error("extra_view.bad_request");
    }
    parts.push(part);
  }
  if (parts.length === 0) throw new Error("extra_view.bad_request");
  return parts.join("/");
}

/** Resolve a chapter-relative resource without allowing `..`, a scheme, an
 * absolute path or a backslash escape. */
export function resolveBookResource(baseEntry: string, href: string): string {
  const base = normalizeEntryName(baseEntry);
  const cleanHref = href.split("#")[0].split("?")[0];
  if (cleanHref === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(cleanHref)) {
    throw new Error("extra_view.bad_request");
  }
  if (cleanHref.startsWith("/") || cleanHref.startsWith("\\")) {
    throw new Error("extra_view.bad_request");
  }
  const decoded = decodeURIComponent(cleanHref).replace(/\\/g, "/");
  if (decoded.split("/").some((part) => part === "..")) {
    throw new Error("extra_view.bad_request");
  }
  const baseParts = base.split("/");
  baseParts.pop();
  const joined = [...baseParts, ...decoded.split("/")].filter((part) => part !== "" && part !== ".");
  return normalizeEntryName(joined.join("/"));
}

export interface BookEntryGrant {
  entry: string;
  grant: string;
}

export interface EpubLoader {
  loadText(name: string): Promise<string>;
  loadBlob(name: string): Promise<Blob>;
  getSize(name: string): Promise<number>;
  sha1(name: string): Promise<string>;
  /** Replace the entry -> grant mapping before a new section is loaded. */
  setEntries(entries: readonly BookEntryGrant[]): void;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function grantFor(
  grants: readonly HelperGrantDTO[],
  entries: readonly BookEntryGrant[],
  name: string,
): HelperGrantDTO {
  const wanted = normalizeEntryName(name);
  const mapping = entries.find((entry) => normalizeEntryName(entry.entry) === wanted);
  const wantedGrant = mapping?.grant;
  const grant = grants.find((entry) =>
    wantedGrant !== undefined
      ? entry.name === wantedGrant
      : (() => {
          try {
            return normalizeEntryName(entry.name) === wanted;
          } catch {
            return false;
          }
        })(),
  );
  if (!grant) throw new Error("extra_view.bad_request");
  return grant;
}

async function fetchBytes(
  grant: HelperGrantDTO,
  fetcher: Fetcher,
): Promise<Uint8Array> {
  if (grant.byte_len > MAX_RESOURCE_BYTES) throw new Error("extra_view.too_large");
  const response = await fetcher(grant.token_url);
  if (!response.ok) throw new Error("extra_view.unavailable");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESOURCE_BYTES) throw new Error("extra_view.too_large");
  return new Uint8Array(buffer);
}

/** The loader foliate's parser-only EPUB object receives. It never decodes
 * ZIP itself: the native archive helper extracted each allowed entry and
 * granted its own token URL. */
export function createEpubLoader(
  grants: readonly HelperGrantDTO[],
  entries: readonly BookEntryGrant[] = [],
  fetcher: Fetcher = fetch,
): EpubLoader {
  let currentEntries = [...entries];
  return {
    setEntries(next) {
      currentEntries = [...next];
    },
    async loadText(name) {
      const bytes = await fetchBytes(grantFor(grants, currentEntries, name), fetcher);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    },
    async loadBlob(name) {
      const grant = grantFor(grants, currentEntries, name);
      const bytes = await fetchBytes(grant, fetcher);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return new Blob([copy], { type: grant.mime });
    },
    async getSize(name) {
      const grant = grantFor(grants, currentEntries, name);
      return grant.byte_len;
    },
    async sha1(name) {
      const bytes = await fetchBytes(grantFor(grants, currentEntries, name), fetcher);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const digest = await crypto.subtle.digest("SHA-1", copy);
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}

/** A bounded byte-range reader over one granted source. The MOBI parser asks
 * only for the header/record table and the current section's records. */
export interface ByteRangeReader {
  read(start: number, end: number): Promise<Uint8Array>;
}

export function createGrantRangeReader(
  tokenUrl: string,
  totalSize: number,
  fetcher: Fetcher = fetch,
): ByteRangeReader {
  return {
    async read(start: number, end: number) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > totalSize ||
        end - start > MAX_RESOURCE_BYTES
      ) {
        throw new Error("extra_view.bad_request");
      }
      const response = await fetcher(tokenUrl, {
        headers: { Range: `bytes=${start}-${end - 1}` },
      });
      if (!response.ok) throw new Error("extra_view.unavailable");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== end - start) throw new Error("extra_view.changed");
      return new Uint8Array(buffer);
    },
  };
}

export interface MobiFileLike {
  size: number;
  name: string;
  slice(start: number, end: number): { arrayBuffer: () => Promise<ArrayBuffer> };
}

/** The file-like object foliate's MOBI parser receives (D2): only the ranges
 * it asks for are read; the whole file is never fetched up front. */
export function makeMobiFileLike(
  name: string,
  size: number,
  reader: ByteRangeReader,
): MobiFileLike {
  return {
    size,
    name,
    slice(start, end) {
      return {
        async arrayBuffer() {
          const bytes = await reader.read(start, end);
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
      };
    },
  };
}
