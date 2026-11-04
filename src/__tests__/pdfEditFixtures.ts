import type { DocumentControllerContext } from "../documents/controller";
import {
  initialDocumentState,
  stateAfterContentChange,
  type DocumentInfo,
  type DocumentRef,
  type DocumentState,
} from "../documents/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import type {
  PdfAnnotation,
  PdfEditCapabilities,
  PdfEditInspection,
  PdfEditModel,
  PdfFormOption,
  PdfFormValue,
  PdfPageState,
} from "../pdf-edit/types";

/** Deterministic fixtures for the Step 14a tests. Every value is plain data;
 * the helper is never a production path. */

export const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
export const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
export const CONTENT_ID = "33333333-3333-4333-8333-333333333333";
export const PAGE_ID = "44444444-4444-4444-8444-444444444444";
export const SECOND_PAGE_ID = "55555555-5555-4555-8555-555555555555";
export const ANNOTATION_ID = "66666666-6666-4666-8666-666666666666";
export const SECOND_ANNOTATION_ID = "77777777-7777-4777-8777-777777777777";

export function makeSnapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    snapshot_id: SNAPSHOT_ID,
    document_id: DOCUMENT_ID,
    revision: 1,
    content_id: CONTENT_ID,
    mime: "application/pdf",
    byte_len: 1024,
    storage_policy: "ordinary",
    expires_unix: 2_000_000_000,
    ...overrides,
  };
}

export function makePage(overrides: Partial<PdfPageState> = {}): PdfPageState {
  return {
    id: PAGE_ID,
    origin_source: makeSnapshot(),
    origin_page: 1,
    rotation: 0,
    crop: { x: 0, y: 0, width: 100, height: 200 },
    annotation_ids: [],
    ...overrides,
  };
}

export function makeSecondPage(overrides: Partial<PdfPageState> = {}): PdfPageState {
  return makePage({ id: SECOND_PAGE_ID, origin_page: 2, ...overrides });
}

export function makeAnnotation(overrides: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: ANNOTATION_ID,
    page_id: PAGE_ID,
    kind: "highlight",
    rect: { x: 20, y: 30, width: 40, height: 10 },
    color: [1, 0.8, 0, 1],
    opacity: 0.5,
    author: "Tester",
    created_unix: 1_700_000_000,
    text: "",
    quads: [
      [
        { x: 20, y: 30 },
        { x: 60, y: 30 },
        { x: 60, y: 40 },
        { x: 20, y: 40 },
      ],
    ],
    ...overrides,
  };
}

export function makeModel(overrides: Partial<PdfEditModel> = {}): PdfEditModel {
  const base: PdfEditModel = {
    schema_version: 1,
    document_id: DOCUMENT_ID,
    content_id: CONTENT_ID,
    pages: overrides.pages ?? [makePage()],
    annotations: overrides.annotations ?? [],
    forms: overrides.forms ?? [],
    source_snapshot: overrides.source_snapshot ?? makeSnapshot(),
    history: overrides.history ?? { entries: [], cursor: 0, bytes: 0 },
  };
  const merged = { ...base, ...overrides };
  const pages = merged.pages.map((page) => ({
    ...page,
    annotation_ids: merged.annotations
      .filter((annotation) => annotation.page_id === page.id)
      .map((annotation) => annotation.id),
  }));
  return { ...merged, pages, annotations: merged.annotations };
}

export interface FakeDocument {
  id: string;
  info: DocumentInfo;
  getState(): DocumentState;
  subscribe(listener: (state: DocumentState) => void): () => void;
  captureSnapshot(): Promise<ExportSnapshot>;
  setState(state: DocumentState): void;
  emit(): void;
}

export function makeDocument(overrides: Partial<DocumentInfo> = {}): FakeDocument {
  const ref: DocumentRef = { kind: "disk", path: "C:\\Docs\\report.pdf" };
  const info: DocumentInfo = {
    document_id: DOCUMENT_ID,
    source: ref,
    name: "report.pdf",
    ext: "pdf",
    mime: "application/pdf",
    size: 1024,
    modified_unix: 1_700_000_000,
    read_only: false,
    from_internet: false,
    sensitive: false,
    disk_path: "C:\\Docs\\report.pdf",
    ...overrides,
  };
  let state = initialDocumentState(CONTENT_ID);
  state = { ...state, ready: true, editing_enabled: true, can_save_copy: true };
  const listeners = new Set<(state: DocumentState) => void>();
  return {
    id: DOCUMENT_ID,
    info,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    captureSnapshot: async () => makeSnapshot(),
    setState(next) {
      state = next;
      for (const listener of listeners) listener(state);
    },
    emit() {
      for (const listener of listeners) listener(state);
    },
  };
}

export interface FakeContext extends DocumentControllerContext {
  readonly state: DocumentState;
  emit(): void;
}

export function makeContext(document: FakeDocument): FakeContext {
  const info = document.info;
  let state = document.getState();
  const context: FakeContext = {
    document_id: document.id,
    source: info.source,
    info,
    initial_content_id: state.content_id,
    get state() {
      return state;
    },
    notifyContentChanged(contentId: string) {
      state = stateAfterContentChange(state, contentId);
      document.setState(state);
      return state;
    },
    notifyReady(options) {
      state = {
        ...state,
        ready: true,
        editing_enabled: options.editing_enabled,
        can_save_existing: options.can_save_existing,
        can_save_copy: options.can_save_copy,
      };
      document.setState(state);
    },
    emit() {
      document.emit();
    },
  };
  return context;
}

export function makeCapabilities(overrides: Partial<PdfEditCapabilities> = {}): PdfEditCapabilities {
  return {
    signature_present: false,
    xfa_present: false,
    rich_text_fields: [],
    unsupported_structures: [],
    sensitive_memory_only: false,
    ...overrides,
  };
}

export function makeInspection(overrides: Partial<PdfEditInspection> = {}): PdfEditInspection {
  return {
    pages: [makePage()],
    annotations: [],
    forms: [],
    form_options: [],
    owned_annotation_ids: [],
    unknown_annotations: 0,
    capabilities: makeCapabilities(),
    ...overrides,
  };
}

export function makeForm(overrides: Partial<PdfFormValue> = {}): PdfFormValue {
  return { field_id: "name", kind: "text", value: "", readonly: false, ...overrides };
}

export function makeFormOption(overrides: Partial<PdfFormOption> = {}): PdfFormOption {
  return { field_id: "choice", options: ["A", "B"], ...overrides };
}
