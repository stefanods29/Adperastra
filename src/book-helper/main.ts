import { onHelperRequest, sendHelperReply } from "../services/helperBridge";
import type { HelperAction, HelperRequestEnvelope } from "../services/helperBridge";
import type { BookDecodeBudget } from "./boundedUnzlib";
import { BookParser, openBook } from "./bookParser";
import type {
  BookContentsReply,
  BookContentsRequest,
  BookOpenReply,
  BookOpenRequest,
  BookPageReply,
  BookPageRequest,
} from "./types";

/** The trusted helper entry for e-books. It only handles `book.*` actions;
 * the parent never sends a path, a raw file or a URL that could fetch another
 * source. */

const BUDGET_BYTES = 512 * 1024 * 1024;

let parser: BookParser | null = null;

const decodedBudget: BookDecodeBudget = {
  remaining_bytes: BUDGET_BYTES,
  cancelled: () => false,
};

function errorCode(error: unknown): string {
  if (error instanceof Error && /^extra_view\./.test(error.message)) {
    return error.message;
  }
  return "extra_view.corrupt";
}

async function replyError(request: HelperRequestEnvelope<unknown>, code: string): Promise<void> {
  await sendHelperReply({
    protocol_version: 1,
    status: "error",
    request_id: request.request_id,
    error_code: code,
  });
}

async function replyOk<T>(request: HelperRequestEnvelope<unknown>, payload: T): Promise<void> {
  await sendHelperReply({
    protocol_version: 1,
    status: "ok",
    request_id: request.request_id,
    payload,
    outputs: [],
  });
}

function isBookAction(value: unknown): value is HelperAction {
  return value === "book.open" || value === "book.page" || value === "book.contents";
}

async function setup(): Promise<void> {
  await onHelperRequest<unknown>({
    action: isBookAction,
    handler: async (request) => {
    if (request.protocol_version !== 1) {
      await replyError(request, "extra_view.bad_request");
      return;
    }
    try {
      switch (request.action) {
        case "book.open": {
          const payload = request.payload as BookOpenRequest;
          parser = await openBook(payload, {
            grants: request.inputs,
            decodedBudget,
          });
          await replyOk<BookOpenReply>(request, parser.openReply);
          return;
        }
        case "book.page": {
          if (!parser) throw new Error("extra_view.changed");
          const payload = request.payload as BookPageRequest;
          const page = await parser.page(
            payload.section,
            payload.page,
            payload.entries ?? [],
          );
          await replyOk<BookPageReply>(request, page);
          return;
        }
        case "book.contents": {
          if (!parser) throw new Error("extra_view.changed");
          const payload = request.payload as BookContentsRequest;
          const contents = parser.contents(payload.cursor, payload.limit);
          await replyOk<BookContentsReply>(request, contents);
          return;
        }
        default:
          await replyError(request, "extra_view.bad_request");
      }
    } catch (error) {
      await replyError(request, errorCode(error));
    }
    },
  });
}

void setup();
