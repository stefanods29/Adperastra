import { readDocumentStatistics as readEngineStatistics } from "../../services/officeEdit";
import type { DocumentStatistics } from "../types";

export function readDocumentStatistics(sessionId: string): Promise<DocumentStatistics> {
  return readEngineStatistics(sessionId);
}
