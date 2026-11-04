/** Parser-only foliate-js 1.0.1 surfaces used by the book helper. The View
 * module and every renderer are deliberately absent. The coordinator must
 * check these declarations against the pinned package before integration;
 * the package ships no TypeScript declarations. */
declare module "foliate-js/epub.js" {
  export class EPUB {
    constructor(loader: {
      loadText: (name: string) => Promise<string>;
      loadBlob: (name: string) => Promise<Blob>;
      getSize: (name: string) => Promise<number>;
      sha1: (name: string) => Promise<string>;
    });
    open(file: unknown): Promise<void>;
    init(): Promise<void>;
    metadata: Record<string, unknown>;
    toc: unknown[];
    sections: { id?: string; href?: string; label?: string }[];
  }
}

declare module "foliate-js/mobi.js" {
  import type { BookDecodeBudget } from "./boundedUnzlib";
  export class MOBI {
    constructor(options: {
      unzlib: (data: Uint8Array, budget?: BookDecodeBudget) => Promise<Uint8Array>;
    });
    open(file: {
      size: number;
      name: string;
      slice(start: number, end: number): { arrayBuffer: () => Promise<ArrayBuffer> };
    }): Promise<void>;
    init(): Promise<void>;
    metadata: Record<string, unknown>;
    toc: unknown[];
    sections: {
      id?: string;
      href?: string;
      label?: string;
      load?: () => Promise<unknown>;
    }[];
  }
}
