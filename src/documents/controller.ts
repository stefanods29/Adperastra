import type { ExportSnapshot } from "../services/exportSnapshots";
import type { SourceStamp } from "../services/cache";
import type { DocumentInfo, DocumentRef, DocumentState } from "./types";

/** Editable-document controllers (Step 09a, tabs-documents-1). One
 * controller owns the mutable model and history of one document; every
 * view of that document synchronizes through it. Factories are trusted
 * static registrations, never loaded from file data. */

export interface DocumentControllerContext {
  document_id: string;
  source: DocumentRef;
  info: DocumentInfo;
  initial_source?: SourceStamp;
  initial_content_id: string;
  /** Call once after each successful model transaction (edits, Undo,
   * Redo). The supplied id is the immutable history-state identity. */
  notifyContentChanged(content_id: string): DocumentState;
  notifyReady(options: { editing_enabled: boolean; can_save_existing: boolean; can_save_copy: boolean }): void;
}

export interface DocumentControllerBinding {
  handler_id: string;
  /** Encode the captured revision's immutable content. */
  capture(captured_revision: number, content_id: string): Promise<ExportSnapshot>;
  discardToSaved(saved_content_id: string): Promise<void>;
  setEditingEnabled(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

export type DocumentControllerFactory = (context: DocumentControllerContext) => Promise<DocumentControllerBinding>;

const factories = new Map<string, DocumentControllerFactory>();

export function registerDocumentControllerFactory(handlerId: string, factory: DocumentControllerFactory): void {
  if (!handlerId || factories.has(handlerId)) throw new Error("documents.editor_conflict");
  factories.set(handlerId, factory);
}

export function documentControllerFactory(handlerId: string): DocumentControllerFactory | null {
  return factories.get(handlerId) ?? null;
}

/** Test helper: forget every registered factory. */
export function clearDocumentControllerFactories(): void {
  factories.clear();
}
