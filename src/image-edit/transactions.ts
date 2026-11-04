import { commitImageModel } from "./ImageDocument";
import type { ImageModel } from "./types";

/** E6: the single commit path for trusted later modules (18a/18b/14c).
 * The compare-and-commit happens inside the document controller; this
 * callback never crosses IPC and no untyped operation object is serialized. */
export async function commitImageTransaction(
  documentId: string,
  expectedContentId: string,
  transform: (current: Readonly<ImageModel>) => ImageModel,
  changedBytes = 0,
): Promise<void> {
  if (typeof documentId !== "string" || documentId.length === 0) throw new Error("image_edit.bad_request");
  if (typeof expectedContentId !== "string" || expectedContentId.length === 0) throw new Error("image_edit.bad_request");
  if (typeof transform !== "function") throw new Error("image_edit.bad_request");
  await commitImageModel(documentId, expectedContentId, transform, changedBytes);
}
