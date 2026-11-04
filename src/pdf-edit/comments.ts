import {
  PDF_EDIT_MAX_AUTHOR_CHARS,
  PDF_EDIT_MAX_REPLIES,
  PDF_EDIT_MAX_TEXT_CHARS,
  isPdfEditUuid,
  newPdfEditId,
  pdfEditError,
  type PdfAnnotation,
  type PdfColor,
  type PdfRect,
} from "./types";

/** Comment rules (Step 14a D5, T3). A thread is one root `comment`
 * annotation plus at most 1,000 replies. Replies carry `parent_id`; the
 * helper writes that as the PDF `IRT` reference. No comment field ever
 * contains executable actions. */

export interface PdfCommentSeed {
  pageId: string;
  rect: PdfRect;
  color: PdfColor;
  opacity: number;
  author: string;
  createdUnix: number;
  text: string;
}

export interface PdfReplySeed {
  author: string;
  createdUnix: number;
  text: string;
}

/** The visible author: the configured value, or the localized Anonymous
 * label. The machine login name is never used (D9). */
export function pdfCommentAuthor(author: string, anonymousLabel: string): string {
  const trimmed = author.trim();
  const value = trimmed.length > 0 ? trimmed : anonymousLabel.trim();
  if (value.length === 0) throw pdfEditError("pdf_edit.bad_request");
  return value.slice(0, PDF_EDIT_MAX_AUTHOR_CHARS);
}

export function pdfCommentTextError(text: string): "pdf_edit.bad_request" | "pdf_edit.too_large" | null {
  if (text.trim().length === 0) return "pdf_edit.bad_request";
  if (text.length > PDF_EDIT_MAX_TEXT_CHARS) return "pdf_edit.too_large";
  return null;
}

export function createPdfComment(seed: PdfCommentSeed, anonymousLabel: string): PdfAnnotation {
  if (!isPdfEditUuid(seed.pageId)) throw pdfEditError("pdf_edit.bad_request");
  const error = pdfCommentTextError(seed.text);
  if (error) throw pdfEditError(error);
  return {
    id: newPdfEditId(),
    page_id: seed.pageId,
    kind: "comment",
    rect: { ...seed.rect },
    color: [...seed.color] as PdfColor,
    opacity: seed.opacity,
    author: pdfCommentAuthor(seed.author, anonymousLabel),
    created_unix: seed.createdUnix,
    text: seed.text,
  };
}

/** One reply to a root comment. Replies to replies are refused: the panel
 * keeps a single visible level, and flattening a nested thread silently is
 * not acceptable. */
export function createPdfReply(parent: PdfAnnotation, seed: PdfReplySeed, anonymousLabel: string): PdfAnnotation {
  if (parent.kind !== "comment" || parent.parent_id) throw pdfEditError("pdf_edit.bad_request");
  const error = pdfCommentTextError(seed.text);
  if (error) throw pdfEditError(error);
  return {
    id: newPdfEditId(),
    page_id: parent.page_id,
    kind: "comment",
    parent_id: parent.id,
    rect: {
      x: parent.rect.x,
      y: parent.rect.y,
      width: parent.rect.width,
      height: parent.rect.height,
    },
    color: [...parent.color] as PdfColor,
    opacity: parent.opacity,
    author: pdfCommentAuthor(seed.author, anonymousLabel),
    created_unix: seed.createdUnix,
    text: seed.text,
  };
}

export interface PdfCommentThread {
  root: PdfAnnotation;
  replies: PdfAnnotation[];
}

/** Group root comments and their replies, oldest first. A reply whose parent
 * is missing is not shown as a root: it is ignored rather than invented. */
export function pdfCommentThreads(annotations: readonly PdfAnnotation[]): PdfCommentThread[] {
  const threads: PdfCommentThread[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== "comment" || annotation.parent_id) continue;
    const replies = annotations
      .filter((entry) => entry.kind === "comment" && entry.parent_id === annotation.id)
      .sort((a, b) => a.created_unix - b.created_unix)
      .slice(0, PDF_EDIT_MAX_REPLIES);
    threads.push({ root: annotation, replies });
  }
  return threads.sort((a, b) => a.root.created_unix - b.root.created_unix);
}

export function pdfCommentReplyCount(annotations: readonly PdfAnnotation[], rootId: string): number {
  return annotations.filter((annotation) => annotation.parent_id === rootId).length;
}

export function canRemovePdfComment(annotations: readonly PdfAnnotation[], id: string): boolean {
  const comment = annotations.find((annotation) => annotation.id === id);
  if (!comment || comment.kind !== "comment") return false;
  return !annotations.some((annotation) => annotation.parent_id === id);
}

export function updatePdfCommentText(annotation: PdfAnnotation, text: string): PdfAnnotation {
  if (annotation.kind !== "comment") throw pdfEditError("pdf_edit.bad_request");
  const error = pdfCommentTextError(text);
  if (error) throw pdfEditError(error);
  return { ...annotation, text };
}

/** A deletion plan for one whole thread: replies first, then the root.
 * `canRemovePdfComment` refuses a root that still has replies. */
export function pdfCommentDeleteOrder(annotations: readonly PdfAnnotation[], id: string): string[] {
  const root = annotations.find((annotation) => annotation.id === id);
  if (!root) throw pdfEditError("pdf_edit.bad_request");
  const replies = annotations
    .filter((annotation) => annotation.parent_id === id)
    .sort((a, b) => b.created_unix - a.created_unix)
    .map((annotation) => annotation.id);
  return [...replies, id];
}

export function findPdfCommentParent(
  annotations: readonly PdfAnnotation[],
  reply: PdfAnnotation,
): PdfAnnotation | null {
  if (!reply.parent_id) return null;
  return annotations.find((annotation) => annotation.id === reply.parent_id) ?? null;
}
