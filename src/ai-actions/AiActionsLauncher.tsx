import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../components/Button";
import Dialog from "../components/Dialog";
import IconButton from "../components/IconButton";
import Skeleton from "../components/Skeleton";
import TextInput from "../components/TextInput";
import type { ConversionInput, ConversionRequest } from "../convert/types";
import type { ExportSnapshot } from "../services/exportSnapshots";
import {
  authorizeSnapshotFile,
  releaseExportSnapshot,
  releaseSnapshotAuthority,
  uploadSnapshot,
} from "../services/exportSnapshots";
import { fileDetect, fileGrant, fileRevoke, fileUrl } from "../services/files";
import { aiCapabilities } from "../services/localAiRuntime";
import { acquireAiDocumentInput, acquireAiInput, describeAiArtifact, readAiArtifact, releaseAiInput } from "../services/localAiArtifacts";
import { loadSettings } from "../services/settings";
import { pickSavePath } from "../services/textFiles";
import { recognizeText, releaseOcr } from "../services/ocr";
import type { AiCapabilityStatus, AiInputRef } from "../services/localAiTypes";
import type {
  AiActionId,
  AiActionRequest,
  AiActionResult,
} from "../services/aiActionTypes";
import {
  AI_CAPABILITY_FOREGROUND,
  AI_CAPABILITY_INPAINT,
  AI_CAPABILITY_TEXT,
  AI_CAPABILITY_TRANSCRIBE,
  AI_CAPABILITY_UPSCALE,
  AI_CAPABILITY_VISION,
  AI_ACTION_MAX_ARTIFACT_BYTES,
  AI_ACTION_MAX_QUESTION,
  isValidTargetLanguage,
} from "../services/aiActionTypes";
import {
  exportAiActionResult,
  releaseAiActionResult,
  startAiAction,
} from "../services/aiActions";
import { applyAiImageResult } from "./imageActions";
import type { ImageActionId } from "./imageActions";
import { buildDocumentRequest, type DocumentActionId } from "./documentActions";
import { ImageEffectPreview } from "./ImageEffectPreview";
import { AiActionMenu } from "./AiActionMenu";
import { AiResultView } from "./AiResultView";
import type { AiActionCapability, AiActionContext } from "./registry";
import UpscaleDialog from "../ai/UpscaleDialog";

/**
 * The one host that mounts the AI-action menu, previews and result review in
 * the Explorer and in file tabs (Step 17b D1/D3/D12).
 *
 * A disabled capability never starts work; every action goes through
 * `startAiAction` and every shown result is a native `AiActionResult`. The
 * host owns input/snapshot leases and releases them when it closes; closing a
 * result releases its artifact lease. There is no simulated suggestion.
 */

export interface AiActionItemRef {
  path: string;
  name: string;
}

export interface AiActionsLauncherProps {
  trigger?: "button" | "icon";
  items: readonly AiActionItemRef[];
  /** The file tab's own handler kind; an extension cannot describe `.adimage`. */
  inputKind?: "image" | "document" | null;
  /** Open file token; a missing token makes the host authorize its own. */
  token?: string | null;
  /** The editable image document behind this file tab, when there is one. */
  documentId?: string | null;
  expectedContentId?: string | null;
  /** Captures the open 14b document for upscale without re-reading the disk. */
  captureSnapshot?: () => Promise<ExportSnapshot>;
  sourceSize?: { width: number; height: number } | null;
  /** Lazy source dimensions, so the shared file tab keeps image-edit lazy. */
  sourceSizeFor?: () => Promise<{ width: number; height: number } | null>;
  ocrLanguage?: string;
  disabled?: boolean;
  onOpenStorage?: () => void;
  onOpenHelp: (slug: string) => void;
  onNotify?: (message: string) => void;
}

type HostView = "menu" | "options" | "busy" | "none";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "avif", "ico",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "txt", "md", "markdown", "json", "jsonc", "csv", "tsv", "xml", "html", "htm",
  "rtf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "epub", "log",
]);
const MAX_INPUT_BYTES = 256 * 1024 * 1024;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The action context kind for one file; media has its own later host. */
export function aiInputKindForName(name: string): "image" | "document" | null {
  const ext = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return null;
}

function contextFor(
  items: readonly AiActionItemRef[],
  override: "image" | "document" | null = null,
): AiActionContext {
  if (items.length === 0) return { input_kinds: [], input_count: 0, capabilities: [] };
  if (items.length > 1) return { input_kinds: ["multiple"], input_count: items.length, capabilities: [] };
  const kind = override ?? aiInputKindForName(items[0].name);
  return kind
    ? { input_kinds: [kind], input_count: 1, capabilities: [] }
    : { input_kinds: [], input_count: 0, capabilities: [] };
}

function capabilityIdForTask(task: AiCapabilityStatus["task"]): string | null {
  switch (task) {
    case "foreground_mask":
      return AI_CAPABILITY_FOREGROUND;
    case "inpaint":
      return AI_CAPABILITY_INPAINT;
    case "transcribe":
      return AI_CAPABILITY_TRANSCRIBE;
    case "upscale":
      return AI_CAPABILITY_UPSCALE;
    case "structured_text":
      return AI_CAPABILITY_TEXT;
    case "vision_answer":
      return AI_CAPABILITY_VISION;
    default:
      return null;
  }
}

async function capabilityRows(): Promise<AiActionCapability[]> {
  try {
    const [rows, settings] = await Promise.all([aiCapabilities(), loadSettings().catch(() => null)]);
    const mapped: AiActionCapability[] = [];
    for (const row of rows) {
      const id = capabilityIdForTask(row.task);
      if (id) mapped.push({ id, available: row.available, reason: row.reason });
    }
    // An API backend needs 17a's tested-provider evidence and its one-shot
    // outbound review; without that flow the text/vision actions stay
    // disabled instead of borrowing a local model row.
    if (settings?.assistant.backend === "api") {
      return mapped.filter((row) => !("id" in row) || (row.id !== AI_CAPABILITY_TEXT && row.id !== AI_CAPABILITY_VISION));
    }
    return mapped;
  } catch {
    return [];
  }
}

function newConsumerId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0")}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

interface HeldInputs {
  inputs: string[];
  snapshots: string[];
  authorities: string[];
  revokes: (() => Promise<void>)[];
}

const EMPTY_HELD: HeldInputs = { inputs: [], snapshots: [], authorities: [], revokes: [] };

export function AiActionsLauncher({
  trigger = "icon",
  items,
  inputKind = null,
  token = null,
  documentId = null,
  expectedContentId = null,
  captureSnapshot,
  sourceSize = null,
  sourceSizeFor,
  ocrLanguage,
  disabled = false,
  onOpenStorage,
  onOpenHelp,
  onNotify,
}: AiActionsLauncherProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<HostView>("menu");
  const [rows, setRows] = useState<AiActionCapability[] | null>(null);
  const [action, setAction] = useState<AiActionId | null>(null);
  const [question, setQuestion] = useState("");
  const [targetLanguage, setTargetLanguage] = useState(i18n.language.startsWith("es") ? "en" : "es");
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    action: ImageActionId;
    input: AiInputRef;
    expectedContentId: string | null;
    sourceSize: { width: number; height: number } | null;
  } | null>(null);
  const [upscale, setUpscale] = useState<{
    input: ConversionInput;
    documentId: string | null;
    expectedContentId: string | null;
    sourceSize: { width: number; height: number } | null;
  } | null>(null);
  const [result, setResult] = useState<AiActionResult | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const held = useRef<HeldInputs>({ ...EMPTY_HELD });
  const resultRef = useRef<string | null>(null);
  const afterUrlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);

  const releaseEverything = useCallback(async () => {
    const current = held.current;
    held.current = { ...EMPTY_HELD };
    for (const id of current.inputs) await releaseAiInput(id).catch(() => undefined);
    for (const id of current.snapshots) await releaseExportSnapshot(id).catch(() => undefined);
    for (const id of current.authorities) await releaseSnapshotAuthority(id).catch(() => undefined);
    for (const revoke of current.revokes) await revoke().catch(() => undefined);
    if (resultRef.current) {
      await releaseAiActionResult(resultRef.current).catch(() => undefined);
      resultRef.current = null;
    }
    if (afterUrlRef.current) {
      URL.revokeObjectURL(afterUrlRef.current);
      afterUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void releaseEverything();
    };
    // The cleanup runs once; leases are tracked in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeAll = useCallback(() => {
    generation.current += 1;
    setOpen(false);
    setView("menu");
    setAction(null);
    setQuestion("");
    setError(null);
    setPreview(null);
    setUpscale(null);
    setResult(null);
    setAfterUrl(null);
    void releaseEverything();
  }, [releaseEverything]);

  const show = useCallback(() => {
    if (disabled) return;
    generation.current += 1;
    setOpen(true);
    setView("menu");
    setError(null);
    setRows(null);
  }, [disabled]);

  useEffect(() => {
    if (!open || rows !== null) return;
    let cancelled = false;
    void capabilityRows().then((next) => {
      if (!cancelled) setRows(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);

  async function snapshotInput(item: AiActionItemRef, reuseToken: string | null): Promise<AiInputRef> {
    let granted = reuseToken;
    let ownedToken: string | null = null;
    if (!granted) {
      granted = await fileGrant(item.path);
      ownedToken = granted;
    }
    let snapshot: ExportSnapshot | null = null;
    let authorityId: string | null = null;
    try {
      const info = await fileDetect(item.path);
      if (info.size <= 0 || info.size > MAX_INPUT_BYTES) throw new Error("ai_actions.too_large");
      const authority = await authorizeSnapshotFile(granted);
      authorityId = authority.document_id;
      const response = await fetch(fileUrl(granted, info.name));
      if (!response.ok) throw new Error("ai_actions.invalid");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== info.size || bytes.byteLength === 0) throw new Error("ai_actions.changed");
      if (typeof crypto.subtle?.digest !== "function") throw new Error("ai_actions.unsupported");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const contentId = hex(new Uint8Array(digest));
      snapshot = await uploadSnapshot(
        {
          document_id: authority.document_id,
          revision: 1,
          content_id: contentId,
          mime: authority.mime || info.mime || "application/octet-stream",
          byte_len: bytes.byteLength,
        },
        bytes,
      );
      const input = await acquireAiInput({
        kind: "snapshot",
        snapshot_id: snapshot.snapshot_id,
        document_id: snapshot.document_id,
        revision: snapshot.revision,
      });
      held.current = {
        inputs: [...held.current.inputs, input.id],
        snapshots: [...held.current.snapshots, snapshot.snapshot_id],
        // A token the tab already owns keeps its own authority; only the
        // snapshot leased here is released.
        authorities: ownedToken && authorityId
          ? [...held.current.authorities, authorityId]
          : held.current.authorities,
        revokes: ownedToken ? [...held.current.revokes, () => fileRevoke(ownedToken as string)] : held.current.revokes,
      };
      return input;
    } catch (failure) {
      if (snapshot) await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
      if (authorityId) await releaseSnapshotAuthority(authorityId).catch(() => undefined);
      if (ownedToken) await fileRevoke(ownedToken).catch(() => undefined);
      throw failure;
    }
  }

  const acquireInputs = useCallback(
    async (count: number): Promise<AiInputRef[]> => {
      const chosen = items.slice(0, count);
      if (chosen.length !== count) throw new Error("ai_actions.invalid");
      if (count === 1 && documentId && captureSnapshot) {
        // The open model may hold unsaved edits; capture its exact current
        // revision instead of reading the original backing at revision 1.
        const snapshot = await captureSnapshot();
        const input = await acquireAiInput({
          kind: "snapshot",
          snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id,
          revision: snapshot.revision,
        });
        held.current = {
          ...held.current,
          inputs: [...held.current.inputs, input.id],
          snapshots: [...held.current.snapshots, snapshot.snapshot_id],
        };
        return [input];
      }
      if (count === 1 && documentId) {
        const input = await acquireAiDocumentInput(documentId);
        held.current = { ...held.current, inputs: [...held.current.inputs, input.id] };
        return [input];
      }
      const inputs: AiInputRef[] = [];
      for (const item of chosen) {
        inputs.push(await snapshotInput(item, chosen.length === 1 ? token : null));
      }
      return inputs;
    },
    [captureSnapshot, documentId, items, token],
  );

  async function loadAfterImage(produced: AiActionResult) {
    if (produced.payload.kind !== "image") return;
    const artifact = produced.payload.image.artifact_id;
    const info = await describeAiArtifact(artifact);
    if (!info || info.byte_len <= 0 || info.byte_len > AI_ACTION_MAX_ARTIFACT_BYTES) {
      throw new Error("ai_actions.too_large");
    }
    const bytes = await readAiArtifact(artifact, 0, info.byte_len);
    if (bytes.byteLength !== info.byte_len) throw new Error("ai_actions.invalid");
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
    if (afterUrlRef.current) URL.revokeObjectURL(afterUrlRef.current);
    afterUrlRef.current = url;
    setAfterUrl(url);
  }

  const showResult = useCallback((produced: AiActionResult) => {
    resultRef.current = produced.id;
    setResult(produced);
    setView("none");
    if (produced.payload.kind === "image") {
      void loadAfterImage(produced).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "ai_actions.failed");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTextAction(chosen: AiActionId, options: { question?: string; target?: string }) {
    const runId = ++generation.current;
    setView("busy");
    setBusyText(t("aiActions.preview"));
    setError(null);
    try {
      const count = chosen === "compare_documents" ? 2 : 1;
      const inputs = await acquireInputs(count);
      let request: AiActionRequest;
      if (chosen === "compare_documents") {
        request = {
          action: chosen,
          inputs,
          options: { kind: "compare_documents" },
          request_revision: 1,
          expected_content_id: null,
          scope_id: null,
          outbound_consent_id: null,
        };
      } else if (chosen === "describe_image" || chosen === "ask_image") {
        const asked = (options.question ?? "").trim() || t("aiActions.describe_image");
        request = {
          action: chosen,
          inputs,
          options: { kind: chosen, question: asked },
          request_revision: 1,
          expected_content_id: null,
          scope_id: null,
          outbound_consent_id: null,
        };
      } else {
        request = buildDocumentRequest(chosen as DocumentActionId, inputs, {
          question: options.question,
          targetLanguage: options.target,
        });
      }
      const job = await startAiAction(request);
      const produced = await job.completion;
      if (!mounted.current || generation.current !== runId) return;
      showResult(produced);
    } catch (failure) {
      if (!mounted.current || generation.current !== runId) return;
      setError(failure instanceof Error ? failure.message : "ai_actions.failed");
      setView("options");
    }
  }

  async function measureSource(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        } else {
          reject(new Error("ai_actions.unsupported"));
        }
      };
      image.onerror = () => reject(new Error("ai_actions.unsupported"));
      image.src = url;
    });
  }

  async function prepareImage(chosen: ImageActionId, measured: { width: number; height: number } | null) {
    const runId = ++generation.current;
    setView("busy");
    setBusyText(t("aiActions.preview"));
    setError(null);
    try {
      const inputs = await acquireInputs(1);
      if (!mounted.current || generation.current !== runId) return;
      setView("none");
      setPreview({
        action: chosen,
        input: inputs[0],
        expectedContentId: documentId ? expectedContentId : null,
        sourceSize: measured,
      });
    } catch (failure) {
      if (!mounted.current || generation.current !== runId) return;
      setError(failure instanceof Error ? failure.message : "ai_actions.failed");
      setView("menu");
    }
  }

  async function prepareUpscale() {
    const runId = ++generation.current;
    setView("busy");
    setBusyText(t("aiActions.preview"));
    setError(null);
    try {
      let input: ConversionInput;
      let applyDocument: string | null = null;
      let expected: string | null = null;
      if (captureSnapshot) {
        const snapshot = await captureSnapshot();
        input = {
          kind: "snapshot",
          snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id,
          revision: snapshot.revision,
        };
        held.current = {
          ...held.current,
          snapshots: [...held.current.snapshots, snapshot.snapshot_id],
        };
        applyDocument = documentId;
        expected = expectedContentId;
      } else {
        const item = items[0];
        if (!item) throw new Error("ai_actions.invalid");
        const granted = token ?? (await fileGrant(item.path));
        if (!token) {
          const revoke = () => fileRevoke(granted);
          try {
            const authority = await authorizeSnapshotFile(granted);
            const info = await fileDetect(item.path);
            const response = await fetch(fileUrl(granted, info.name));
            if (!response.ok) throw new Error("ai_actions.invalid");
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength !== info.size || bytes.byteLength === 0) throw new Error("ai_actions.changed");
            if (typeof crypto.subtle?.digest !== "function") throw new Error("ai_actions.unsupported");
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const snapshot = await uploadSnapshot(
              {
                document_id: authority.document_id,
                revision: 1,
                content_id: hex(new Uint8Array(digest)),
                mime: authority.mime || info.mime || "application/octet-stream",
                byte_len: bytes.byteLength,
              },
              bytes,
            );
            held.current = {
              ...held.current,
              snapshots: [...held.current.snapshots, snapshot.snapshot_id],
              authorities: [...held.current.authorities, authority.document_id],
              revokes: [...held.current.revokes, revoke],
            };
            input = {
              kind: "snapshot",
              snapshot_id: snapshot.snapshot_id,
              document_id: snapshot.document_id,
              revision: snapshot.revision,
            };
            expected = snapshot.content_id;
          } catch (failure) {
            await revoke().catch(() => undefined);
            throw failure;
          }
        } else {
          const authority = await authorizeSnapshotFile(granted);
          const info = await fileDetect(item.path);
          const response = await fetch(fileUrl(granted, info.name));
          if (!response.ok) throw new Error("ai_actions.invalid");
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength !== info.size || bytes.byteLength === 0) throw new Error("ai_actions.changed");
          if (typeof crypto.subtle?.digest !== "function") throw new Error("ai_actions.unsupported");
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const snapshot = await uploadSnapshot(
            {
              document_id: authority.document_id,
              revision: 1,
              content_id: hex(new Uint8Array(digest)),
              mime: authority.mime || info.mime || "application/octet-stream",
              byte_len: bytes.byteLength,
            },
            bytes,
          );
          held.current = {
            ...held.current,
            snapshots: [...held.current.snapshots, snapshot.snapshot_id],
          };
          input = {
            kind: "snapshot",
            snapshot_id: snapshot.snapshot_id,
            document_id: snapshot.document_id,
            revision: snapshot.revision,
          };
          expected = snapshot.content_id;
        }
      }
      const measured = sourceSize ?? (sourceSizeFor ? await sourceSizeFor().catch(() => null) : null);
      if (!mounted.current || generation.current !== runId) return;
      setView("none");
      setUpscale({ input, documentId: applyDocument, expectedContentId: expected, sourceSize: measured });
    } catch (failure) {
      if (!mounted.current || generation.current !== runId) return;
      setError(failure instanceof Error ? failure.message : "ai_actions.failed");
      setView("menu");
    }
  }

  async function copyText() {
    const item = items[0];
    if (!item) return;
    const runId = ++generation.current;
    setView("busy");
    setBusyText(t("aiActions.copy_text"));
    setError(null);
    const consumer = newConsumerId();
    try {
      const job = await recognizeText({
        input: { kind: "image", path: item.path },
        language: ocrLanguage ?? "auto",
        consumer_id: consumer,
        rotation: 0,
        request_revision: 1,
      });
      const page = await job.completion;
      if (!page.text) throw new Error("ai_actions.no_sources");
      await navigator.clipboard.writeText(page.text);
      if (!mounted.current || generation.current !== runId) return;
      onNotify?.(t("aiActions.copy_text"));
      closeAll();
    } catch (failure) {
      if (!mounted.current || generation.current !== runId) return;
      setError(failure instanceof Error ? failure.message : "ai_actions.failed");
      setView("menu");
    } finally {
      await releaseOcr(consumer).catch(() => undefined);
    }
  }

  async function run(chosen: AiActionId) {
    setError(null);
    if (chosen === "copy_text") {
      void copyText();
      return;
    }
    if (chosen === "upscale") {
      void prepareUpscale();
      return;
    }
    if (chosen === "remove_background" || chosen === "blur_background" || chosen === "erase_object") {
      let measured = sourceSize;
      if (chosen === "erase_object" && !measured) {
        measured = sourceSizeFor ? await sourceSizeFor().catch(() => null) : null;
        if (!measured && token && items[0]) {
          measured = await measureSource(fileUrl(token, items[0].name)).catch(() => null);
        }
        if (!measured) {
          setError("ai_actions.unsupported");
          return;
        }
      }
      void prepareImage(chosen, measured);
      return;
    }
    if (chosen === "describe_image") {
      void startTextAction(chosen, { question: t("aiActions.describe_image") });
      return;
    }
    if (chosen === "ask_image") {
      setAction(chosen);
      setQuestion("");
      setView("options");
      return;
    }
    if (chosen === "translate" || chosen === "ask_file") {
      setAction(chosen);
      setQuestion("");
      setView("options");
      return;
    }
    void startTextAction(chosen, {});
  }

  async function saveCopy(produced: AiActionResult) {
    if (produced.payload.kind === "image" || produced.sensitive) throw new Error("ai_actions.unsupported");
    const base = items[0]?.name.replace(/\.[^.]+$/, "") || t("aiActions.title");
    const path = await pickSavePath(t("aiActions.saveCopy"), `${base}.txt`, t("speech.text"));
    if (!path) return;
    const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    if (separator <= 0) throw new Error("ai_actions.invalid");
    const destDir = path.slice(0, separator);
    const stem = path.slice(separator + 1).replace(/\.[^.]+$/, "");
    const request: ConversionRequest = {
      inputs: [],
      converter_id: "ai-action-result",
      options: {
        kind: "document",
        value: { include_images: false, page_size: "source", margin_mm: 0, sanitize: true, encoding: "utf8" },
      },
      dest_dir: destDir,
      keep_original: true,
      accepted_losses: [],
      accepted_warning_codes: [],
      request_revision: 1,
      naming: { pattern: stem, date_utc: new Date().toISOString(), start_index: 1 },
    };
    const job = await exportAiActionResult(produced.id, request);
    await job.completion;
    onNotify?.(t("aiActions.saveCopy"));
  }

  async function applyImage(produced: AiActionResult) {
    if (!documentId || !expectedContentId || produced.payload.kind !== "image") {
      throw new Error("ai_actions.unsupported");
    }
    await applyAiImageResult(documentId, expectedContentId, produced.id);
    onNotify?.(t("common.apply"));
    closeAll();
  }

  const context = contextFor(items, inputKind);
  const canRunOption =
    action === "translate"
      ? isValidTargetLanguage(targetLanguage.trim())
      : question.trim().length > 0 && Array.from(question.trim()).length <= AI_ACTION_MAX_QUESTION;
  const triggerLabel = t("aiActions.title");

  return (
    <>
      {trigger === "icon" ? (
        <IconButton
          icon={Sparkles}
          labelKey="aiActions.title"
          onClick={show}
          disabled={disabled || items.length === 0}
        />
      ) : (
        <Button
          variant="subtle"
          onClick={show}
          disabled={disabled || items.length === 0}
          aria-label={triggerLabel}
        >
          <Sparkles size={16} aria-hidden="true" />
          {triggerLabel}
        </Button>
      )}

      {open && view === "menu" ? (
        <Dialog title={t("aiActions.title")} onClose={closeAll} className="adp-ai-actions-dialog">
          {rows === null ? (
            <Skeleton variant="rows" count={3} />
          ) : (
            <AiActionMenu
              context={{ ...context, capabilities: rows }}
              onRun={run}
              onOpenStorage={onOpenStorage}
              onOpenHelp={onOpenHelp}
            />
          )}
          {error ? <p className="adp-ai-host-error" role="alert">{error}</p> : null}
          <p className="adp-ai-host-note">{t("aiActions.check")}</p>
        </Dialog>
      ) : null}

      {open && view === "options" && action ? (
        <Dialog title={t(`aiActions.${action}`)} onClose={() => setView("menu")} className="adp-ai-options-dialog">
          {action === "translate" ? (
            <label className="adp-ai-option">
              <span>{t("aiActions.targetLanguage")}</span>
              <TextInput
                value={targetLanguage}
                onChange={setTargetLanguage}
                ariaLabel={t("aiActions.targetLanguage")}
                maxLength={35}
              />
            </label>
          ) : (
            <label className="adp-ai-option">
              <span>{t("aiActions.question")}</span>
              <TextInput
                value={question}
                onChange={setQuestion}
                ariaLabel={t("aiActions.question")}
                maxLength={AI_ACTION_MAX_QUESTION}
              />
            </label>
          )}
          {error ? <p className="adp-ai-host-error" role="alert">{error}</p> : null}
          <div className="adp-dialog-actions">
            <Button
              variant="primary"
              disabled={!canRunOption}
              onClick={() => {
                if (!action) return;
                if (action === "translate") void startTextAction(action, { target: targetLanguage.trim() });
                else void startTextAction(action, { question: question.trim() });
              }}
            >
              {t("aiActions.preview")}
            </Button>
            <Button onClick={() => setView("menu")}>{t("common.cancel")}</Button>
          </div>
        </Dialog>
      ) : null}

      {open && view === "busy" ? (
        <Dialog title={t("aiActions.title")} onClose={closeAll}>
          <p role="status">{busyText || t("aiActions.preview")}</p>
        </Dialog>
      ) : null}

      {open && preview ? (
        <ImageEffectPreview
          input={preview.input}
          action={preview.action}
          sourceUrl={token && items[0] ? fileUrl(token, items[0].name) : undefined}
          sourceSize={preview.sourceSize ?? sourceSize}
          expectedContentId={preview.expectedContentId}
          resultUrlFor={(produced) => (result && produced.id === result.id ? afterUrl : null)}
          onResult={showResult}
          onCancel={closeAll}
          onOpenHelp={onOpenHelp}
        />
      ) : null}

      {open && upscale ? (
        <UpscaleDialog
          input={upscale.input}
          documentId={upscale.documentId}
          expectedContentId={upscale.expectedContentId}
          sourceSize={upscale.sourceSize}
          beforeUrl={token && items[0] ? fileUrl(token, items[0].name) : null}
          onClose={() => {
            setUpscale(null);
            setView("menu");
          }}
          onApplied={() => {
            onNotify?.(t("common.apply"));
            closeAll();
          }}
          onOpenHelp={onOpenHelp}
          onOpenStorage={onOpenStorage}
        />
      ) : null}

      {open && result ? (
        <Dialog title={t("aiActions.title")} onClose={closeAll} className="adp-ai-result-dialog">
          <div className="adp-ai-result-host">
            <AiResultView
              result_id={result.id}
              active
              onOpenHelp={onOpenHelp}
              onSaveCopy={
                result.payload.kind === "image" || result.sensitive
                  ? undefined
                  : async (produced) => {
                      try {
                        await saveCopy(produced);
                      } catch (failure) {
                        setError(failure instanceof Error ? failure.message : "ai_actions.failed");
                      }
                    }
              }
              onRetry={() => {
                const retry = result.action;
                // Retry is never automatic and never reuses the old lease.
                void releaseEverything().then(() => {
                  if (!mounted.current) return;
                  setResult(null);
                  setView("menu");
                  onNotify?.(t("assistant.retry"));
                  void run(retry);
                });
              }}
              onDiscard={closeAll}
            />
          </div>
          {result.payload.kind === "image" && documentId && expectedContentId ? (
            <div className="adp-dialog-actions">
              <Button
                variant="primary"
                onClick={() => {
                  void applyImage(result).catch((failure: unknown) => {
                    setError(failure instanceof Error ? failure.message : "ai_actions.failed");
                  });
                }}
              >
                {t("common.apply")}
              </Button>
            </div>
          ) : null}
          {error ? <p className="adp-ai-host-error" role="alert">{error}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}

export default AiActionsLauncher;
