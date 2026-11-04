import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput } from "../convert/types";
import { runJob, type JobHandle } from "./jobs";
import {
  OFFICE_MAX_CELL_COLUMNS,
  OFFICE_MAX_CELL_ROWS,
  OFFICE_MAX_CELL_START,
  OFFICE_MAX_PAGES,
  OFFICE_MAX_SCALE,
  OFFICE_MAX_SHEET_COLUMNS,
  OFFICE_MIN_SCALE,
  validOfficeInput,
  validOfficePageNumber,
  validOfficeScale,
  validSectionId,
  type OfficeCellPage,
  type OfficeCommentPage,
  type OfficePage,
  type OfficeSectionPage,
  type OfficeSession,
} from "./officeViewTypes";

/** Read-only Office view services (Step 13 E1-E4).
 *
 * Only this file calls the six Office commands. The Rust side validates the
 * input, session, page and cursor again; these checks are for immediate UI
 * feedback and never replace native validation. Bytes never travel through
 * invoke: pages are cache leases served by the `adpfile` protocol. */

export type {
  OfficeCell,
  OfficeCellPage,
  OfficeComment,
  OfficeCommentPage,
  OfficeFormat,
  OfficeOutlineNode,
  OfficePage,
  OfficeSection,
  OfficeSectionPage,
  OfficeSession,
  OfficeViewState,
} from "./officeViewTypes";

export const OFFICE_VIEW_COMMANDS = {
  open: "office_view_open_start",
  page: "office_view_page_start",
  text: "office_view_text_start",
  sections: "office_view_sections",
  comments: "office_view_comments",
  cells: "office_view_cells",
  close: "office_view_close",
} as const;

/** Open a normal file or an immutable snapshot. A snapshot never becomes a
 * fake disk path; the native resolver owns its four identity fields. */
export async function openOfficeView(
  input: ConversionInput,
): Promise<JobHandle<OfficeSession>> {
  if (!validOfficeInput(input)) throw new Error("office.bad_request");
  return runJob<OfficeSession>("officeopen", (requestId) =>
    invoke("office_view_open_start", { requestId, input }),
  );
}

/** Pure request check shared by the UI and its tests. */
export function validateOfficePageRequest(
  sessionId: string,
  sectionId: string,
  page: number,
  scale: number,
): void {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 64) {
    throw new Error("office.bad_request");
  }
  if (!validSectionId(sectionId) || !validOfficePageNumber(page) || page > OFFICE_MAX_PAGES) {
    throw new Error("office.bad_request");
  }
  if (!validOfficeScale(scale) || scale < OFFICE_MIN_SCALE || scale > OFFICE_MAX_SCALE) {
    throw new Error("office.bad_request");
  }
}

export async function officeViewPage(
  sessionId: string,
  sectionId: string,
  page: number,
  scale: number,
): Promise<JobHandle<OfficePage>> {
  validateOfficePageRequest(sessionId, sectionId, page, scale);
  return runJob<OfficePage>("officepage", (requestId) =>
    invoke("office_view_page_start", { requestId, sessionId, sectionId, page, scale }),
  );
}

export async function officeViewText(sessionId: string, sectionId: string, page: number) {
  validateOfficePageRequest(sessionId, sectionId, page, 1);
  return runJob<{ runs: import("./officeViewTypes").OfficeLayoutRun[]; complete: boolean }>(
    "officetext", (requestId) => invoke("office_view_text_start", { requestId, sessionId, sectionId, page }),
  );
}

export async function officeViewSections(
  sessionId: string,
  cursor?: string,
): Promise<OfficeSectionPage> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("office.bad_request");
  }
  return (await invoke("office_view_sections", {
    sessionId,
    cursor: cursor ?? null,
  })) as OfficeSectionPage;
}

export async function officeViewComments(
  sessionId: string,
  sectionId: string,
  cursor?: string,
): Promise<OfficeCommentPage> {
  if (typeof sessionId !== "string" || !validSectionId(sectionId)) {
    throw new Error("office.bad_request");
  }
  return (await invoke("office_view_comments", {
    sessionId,
    sectionId,
    cursor: cursor ?? null,
  })) as OfficeCommentPage;
}

/** One visible column window. The optional columns default to the first
 * OFFICE_MAX_CELL_COLUMNS; callers pass the window the grid actually paints so
 * a 16,384-column sheet stays under the 768 KiB answer cap. Cells keep
 * absolute row/column addresses in every answer. */
export async function officeViewCells(
  sessionId: string,
  sectionId: string,
  rowStart: number,
  rowCount: number,
  columnStart = 0,
  columnCount = OFFICE_MAX_CELL_COLUMNS,
): Promise<OfficeCellPage> {
  if (
    typeof sessionId !== "string" ||
    !validSectionId(sectionId) ||
    !Number.isSafeInteger(rowStart) ||
    rowStart < 0 ||
    rowStart > OFFICE_MAX_CELL_START ||
    !Number.isSafeInteger(rowCount) ||
    rowCount < 1 ||
    rowCount > OFFICE_MAX_CELL_ROWS ||
    !Number.isSafeInteger(columnStart) ||
    columnStart < 0 ||
    columnStart > OFFICE_MAX_SHEET_COLUMNS ||
    !Number.isSafeInteger(columnCount) ||
    columnCount < 1 ||
    columnCount > OFFICE_MAX_CELL_COLUMNS
  ) {
    throw new Error("office.bad_request");
  }
  return (await invoke("office_view_cells", {
    sessionId,
    sectionId,
    rowStart,
    rowCount,
    columnStart,
    columnCount,
  })) as OfficeCellPage;
}

/** Idempotent: a tab that already closed must not fail. */
export async function closeOfficeView(sessionId: string): Promise<void> {
  try {
    await invoke("office_view_close", { sessionId });
  } catch {
    // The session may have been evicted or already closed.
  }
}
