import { invoke } from "@tauri-apps/api/core";

export interface BasicOfficeItem { id: string; section_id: string; text: string; address: string | null }
export interface BasicOfficePage { revision: number; section_id: string; section_index: number; next_start: number | null; has_next_section: boolean; items: BasicOfficeItem[] }

export function officeBasicPage(sessionId: string, expectedRevision: number, sectionIndex: number, start: number): Promise<BasicOfficePage> {
  return invoke("office_edit_basic_page", { sessionId, expectedRevision, sectionIndex, start });
}
