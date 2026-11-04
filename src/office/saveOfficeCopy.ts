import type { DocumentHandle } from "../documents/types";
import { pickSavePath } from "../services/textFiles";

export async function saveOfficeCopy(document: DocumentHandle, title: string, filterLabel: string): Promise<void> {
  const path = await pickSavePath(title, document.info.name, filterLabel);
  if (path && !await document.saveCopy(path)) throw new Error("office_edit.unsupported");
}
