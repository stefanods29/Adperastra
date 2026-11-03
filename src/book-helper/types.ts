import type { BookContentsItem } from "../services/extraViews";

/** Private payloads of the book helper (Step 07f T3). They travel inside the
 * 07d helper envelopes; no path, source stamp or raw book file is here. */

export type BookFormat = "epub" | "mobi" | "azw3";
export type BookTheme = "app" | "light" | "dark";

export interface BookOpenRequest {
  format: BookFormat;
  /** The internal entry name of the book file, when the native loader knows
   * it. It is never a user path or a URL. */
  entry_name: string;
  /** The OPF entry (EPUB only), already validated by the native loader. */
  opf_path: string | null;
  /** Internal entry -> short 07d grant name. */
  entries: { entry: string; grant: string }[];
}

export interface BookOpenReply {
  title: string;
  author: string;
  language: string;
  direction: "ltr" | "rtl";
  section_count: number;
  partial: boolean;
}

export interface BookPageRequest {
  section: number;
  page: number;
  font_px: number;
  theme: BookTheme;
  /** Entries whose images may become a lease; the page keeps the inert
   * `book-resource:<id>` token and SafeMarkupFrame maps it to the lease. */
  resources: { id: string }[];
  /** Internal entry -> short 07d grant name for the current inputs. */
  entries: { entry: string; grant: string }[];
}

export interface BookPageReply {
  section: number;
  page: number;
  page_count: number;
  html: string;
  resource_ids: string[];
  direction: "ltr" | "rtl";
}

export interface BookContentsRequest {
  cursor: string | null;
  limit: number;
}

export interface BookContentsReply {
  items: BookContentsItem[];
  next_cursor: string | null;
  complete: boolean;
}
