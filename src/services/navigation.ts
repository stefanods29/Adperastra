/** Navigation state for one Explorer tab (Step 02, slice 3). */

export type ExplorerLocation =
  | { type: "home" }
  | { type: "folder"; path: string }
  | { type: "drives" }
  | { type: "gallery" }
  | { type: "network" };

export interface NavHistory {
  back: ExplorerLocation[];
  current: ExplorerLocation;
  forward: ExplorerLocation[];
}

export function locationKey(location: ExplorerLocation): string {
  return location.type === "folder" ? `folder:${location.path.toLowerCase()}` : location.type;
}

export function createHistory(initial: ExplorerLocation): NavHistory {
  return { back: [], current: initial, forward: [] };
}

export function navigate(history: NavHistory, location: ExplorerLocation): NavHistory {
  if (locationKey(history.current) === locationKey(location)) return history;
  return { back: [...history.back, history.current], current: location, forward: [] };
}

export function goBack(history: NavHistory): NavHistory {
  const previous = history.back[history.back.length - 1];
  if (!previous) return history;
  return {
    back: history.back.slice(0, -1),
    current: previous,
    forward: [history.current, ...history.forward],
  };
}

export function goForward(history: NavHistory): NavHistory {
  const next = history.forward[0];
  if (!next) return history;
  return {
    back: [...history.back, history.current],
    current: next,
    forward: history.forward.slice(1),
  };
}

export function canGoBack(history: NavHistory): boolean {
  return history.back.length > 0;
}

export function canGoForward(history: NavHistory): boolean {
  return history.forward.length > 0;
}