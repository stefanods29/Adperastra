import { createContext, useContext } from "react";
import type { AnnouncementQueue } from "./announcements";

/** The app's one announcement queue (Step 10f E5). Views and lists read it
 * here instead of taking a queue prop through every host; a standalone
 * preview without a provider keeps silent. */
const AnnouncementContext = createContext<AnnouncementQueue | null>(null);

export function useAnnouncementsOptional(): AnnouncementQueue | null {
  return useContext(AnnouncementContext);
}

export default AnnouncementContext;
