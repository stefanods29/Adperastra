import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../services/jobs", () => ({ runJob: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";
import type { JobHandle } from "../services/jobs";
import { runJob } from "../services/jobs";
import type { SearchPage, SearchQuery, SearchResult } from "../services/search";
import type { TagCatalog } from "../services/tags";
import {
  calendarGrid,
  dayBounds,
  addFilter,
  indexedViewDropTarget,
  localDateKey,
  localMonthKey,
  monthBounds,
  queryIndexedView,
  timelineBucketId,
  undatedBucket,
  bucketLabel,
  DEFAULT_ENABLED_VIEWS,
  DEFAULT_VIEWS_SETTINGS,
  normalizeViewsSettings,
  type IndexedViewPage,
  type IndexedViewQuery,
  type ViewBucket,
} from "../services/smartViews";
import { HomeSectionRegistry, NavigationRegistry } from "../shell/registries";
import CalendarView from "../views/CalendarView";
import SmartFolderView from "../views/SmartFolderView";
import TimelineView from "../views/TimelineView";
import {
  registerSmartFoldersHome,
  registerTaggedFilesHome,
  registerTagNavigation,
  registerViewsNavigation,
} from "../views/viewRegistrations";

const mockedInvoke = vi.mocked(invoke);
const mockedRunJob = vi.mocked(runJob);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedRunJob.mockReset();
});

function emptyQuery(text = "port"): SearchQuery {
  return {
    mode: "name",
    text,
    roots: [],
    filter: null,
    regex_scope: "name",
    match_case: false,
    sort: { key: "modified", direction: "descending" },
  };
}

function emptyPage(): IndexedViewPage {
  return { buckets: [], results: [], complete: true, generation: 3 };
}

function handleOf<T>(result: T): JobHandle<T> {
  return {
    id: "indexedview-test",
    cancel: vi.fn(async () => undefined),
    completion: Promise.resolve(result),
  };
}

function pendingHandle<T>(): { handle: JobHandle<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const completion = new Promise<T>((settle) => {
    resolve = settle;
  });
  return {
    handle: {
      id: "indexedview-test",
      cancel: vi.fn(async () => undefined),
      completion,
    },
    resolve,
  };
}

function result(name: string, modifiedUnix: number): SearchResult {
  return {
    item: {
      path: `C:\\Work\\${name}`,
      name,
      kind: "file",
      size: 10,
      modified_unix: modifiedUnix,
      hidden: false,
      system: false,
      is_link: false,
      online_only: false,
      file_id: null,
      file_id_stable: false,
    },
    key: {
      volume_id: "11111111",
      file_id: "aaaaaaaaaaaaaaaa",
      path_key: `c:\\work\\${name.toLowerCase()}`,
      stable: true,
    },
    found_by: "name",
    snippet: null,
    content_truncated: false,
    metadata_available: false,
    created_unix: modifiedUnix,
    date_taken_unix: null,
  };
}

function timelineResult(name: string): { page: IndexedViewPage; bucket: ViewBucket } {
  const now = Math.floor(Date.now() / 1000);
  const modified = new Date().setHours(12, 0, 0, 0) / 1000;
  const id = localDateKey(now);
  const bounds = dayBounds(id)!;
  return {
    bucket: {
      id,
      date_from_unix: bounds.from_unix,
      date_to_unix: bounds.to_unix,
      count: 1,
      total_bytes: 10,
    },
    page: {
      buckets: [
        {
          id,
          date_from_unix: bounds.from_unix,
          date_to_unix: bounds.to_unix,
          count: 1,
          total_bytes: 10,
        },
      ],
      results: [result(name, modified)],
      complete: true,
      generation: 3,
    },
  };
}

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
  });
  return {
    draw: async (next: React.ReactElement) => {
      await act(async () => {
        root?.render(next);
      });
    },
  };
}

describe("smart views", () => {
  it("querysameSearchQuery", async () => {
    mockedRunJob.mockImplementation(async (_prefix, start) => {
      await start("indexedview-test");
      return handleOf(emptyPage());
    });
    const query = emptyQuery();
    const request: IndexedViewQuery = {
      view: "timeline",
      query,
      date_source: "modified",
      group: "day",
      month: "2026-11",
    };
    const handle = await queryIndexedView(request);
    expect(handle.id).toBe("indexedview-test");
    expect(mockedRunJob).toHaveBeenCalledWith("indexedview", expect.any(Function));
    expect(mockedInvoke).toHaveBeenCalledWith("indexed_view_start", {
      requestId: "indexedview-test",
      request,
    });
    const payload = mockedInvoke.mock.calls[0][1] as { request: IndexedViewQuery };
    expect(payload.request.query).toBe(query);
  });

  it("cannotpasteintoquery", async () => {
    const query = emptyQuery("report");
    const request: IndexedViewQuery = { view: "calendar", query, month: "2026-11" };
    expect(indexedViewDropTarget(request)).toBeNull();
    expect(request.month).toBe("2026-11");

    const saved = {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Report",
      query,
      created_unix: 1,
      modified_unix: 1,
      version: 1,
    };
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "saved_searches_list") return [saved];
      return undefined;
    });
    mockedRunJob.mockImplementation(async (_prefix, start) => {
      await start("search-test");
      return handleOf(searchPage());
    });
    await render(
      <SmartFolderView
        folder={{
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Report",
          saved_search_id: saved.id,
          created_unix: 1,
          modified_unix: 1,
        }}
        active
        onOpenFile={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    expect(container!.querySelector("input, textarea, [contenteditable]")).toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("saved_searches_list");
  });

  it("localmonthboundary", () => {
    const lateOctober = new Date(2026, 9, 31, 23, 30, 0).getTime() / 1000;
    const earlyNovember = new Date(2026, 10, 1, 0, 0, 0).getTime() / 1000;
    expect(localDateKey(lateOctober)).toBe("2026-10-31");
    expect(localMonthKey(lateOctober)).toBe("2026-10");
    expect(timelineBucketId(lateOctober, "month", 1)).toBe("2026-10");
    const october = monthBounds("2026-10")!;
    const november = monthBounds("2026-11")!;
    expect(october.from_unix).toBeLessThanOrEqual(lateOctober);
    expect(october.to_unix).toBeGreaterThanOrEqual(lateOctober);
    expect(november.from_unix).toBe(earlyNovember);
    expect(lateOctober).toBeLessThan(november.from_unix);
    expect(timelineBucketId(0, "day", 1)).toBe("undated");
  });

  it("normalizes views settings per field", () => {
    const normalized = normalizeViewsSettings({
      enabled_views: { timeline: false, map: "yes" },
      date_source: "taken",
      activity_enabled: "no",
      map_online_enabled: true,
      write_embedded_tags: 1,
    });
    expect(normalized.enabled_views).toEqual({
      timeline: false,
      calendar: true,
      by_kind: true,
      recent_activity: true,
      map: false,
    });
    expect(normalized.date_source).toBe("modified");
    expect(normalized.activity_enabled).toBe(true);
    expect(normalized.map_online_enabled).toBe(true);
    expect(normalized.write_embedded_tags).toBe(false);
    const fallback = normalizeViewsSettings(null);
    expect(fallback).toEqual(DEFAULT_VIEWS_SETTINGS);
    expect(fallback).not.toBe(DEFAULT_VIEWS_SETTINGS);
    expect(fallback.enabled_views).not.toBe(DEFAULT_VIEWS_SETTINGS.enabled_views);
  });

  it("missingdateundated", async () => {
    const buckets: ViewBucket[] = [
      {
        id: "2026-11-01",
        date_from_unix: monthBounds("2026-11")!.from_unix,
        date_to_unix: monthBounds("2026-11")!.from_unix + 100,
        count: 1,
        total_bytes: 10,
      },
      { id: "undated", label_key: "views.undated", count: 2, total_bytes: 20 },
    ];
    expect(undatedBucket(buckets)?.count).toBe(2);
    expect(bucketLabel(buckets[1], "day", "en")).toBe("");

    mockedRunJob.mockImplementation(async (_prefix, start) => {
      await start("indexedview-test");
      return handleOf(
        {
          buckets,
          results: [],
          complete: true,
          generation: 3,
        } satisfies IndexedViewPage,
      );
    });
    await render(
      <TimelineView
        query={emptyQuery()}
        active
        onOpenFile={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    const undated = container!.querySelector('[data-bucket-id="undated"]');
    expect(undated).not.toBeNull();
    expect(undated!.textContent).toContain(i18n.t("views.undated"));
  });

  it("Calendar6x7", () => {
    const sunday = calendarGrid("2026-11", 0);
    const monday = calendarGrid("2026-11", 1);
    expect(sunday).toHaveLength(42);
    expect(monday).toHaveLength(42);
    expect(new Date(`${sunday[0].key}T00:00:00`).getDay()).toBe(0);
    expect(new Date(`${monday[0].key}T00:00:00`).getDay()).toBe(1);
    expect(sunday.filter((cell) => cell.in_month)).toHaveLength(30);
    expect(sunday[0].key).toBe("2026-11-01");

    const bounds = dayBounds("2026-11-02")!;
    const filtered = addFilter(null, {
      kind: "date",
      field: "modified",
      from_unix: bounds.from_unix,
      to_unix: bounds.to_unix,
    });
    expect(filtered.kind).toBe("date");
    if (filtered.kind === "date") {
      expect(filtered.from_unix).toBe(bounds.from_unix);
      expect(filtered.to_unix).toBe(bounds.to_unix);
    }
  });

  it("cancelstaleresults", async () => {
    const fresh = timelineResult("fresh.txt");
    const stale = timelineResult("stale.txt");
    const freshDeferred = pendingHandle<IndexedViewPage>();
    const staleDeferred = pendingHandle<IndexedViewPage>();
    const freshHandle = freshDeferred.handle;
    const staleHandle = staleDeferred.handle;
    mockedRunJob
      .mockImplementationOnce(async (_prefix, start) => {
        await start("indexedview-old");
        return staleHandle;
      })
      .mockImplementationOnce(async (_prefix, start) => {
        await start("indexedview-new");
        return freshHandle;
      });

    const view = await render(
      <TimelineView
        query={emptyQuery("old")}
        active
        onOpenFile={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    await view.draw(
      <TimelineView
        query={emptyQuery("new")}
        active
        onOpenFile={() => undefined}
        onOpenHelp={() => undefined}
      />,
    );
    await act(async () => {
      freshDeferred.resolve(fresh.page);
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("fresh.txt");
    await act(async () => {
      staleDeferred.resolve(stale.page);
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("fresh.txt");
    expect(container!.textContent).not.toContain("stale.txt");
    expect(staleHandle.cancel).toHaveBeenCalled();
  });

  it("Nav/Homeproviderregistration", async () => {
    const home = new HomeSectionRegistry();
    const navigation = new NavigationRegistry();
    const catalog: TagCatalog = {
      schema_version: 1,
      tags: [
        {
          id: "0f8fad1e-0001-4a3b-9c4d-000000000001",
          name: "Work",
          color: "#1565C0",
          icon_id: "tag",
          created_unix: 1,
          modified_unix: 1,
          revision: 1,
        },
      ],
      revision: 1,
      history_id: "11111111-2222-4333-8444-555555555555",
    };
    const openPath = vi.fn(async () => undefined);
    const taggedOff = registerTaggedFilesHome(home, {
      getCatalog: async () => catalog,
      taggedFiles: async () => [result("tagged.txt", 1)],
      openPath,
    });
    const foldersOff = registerSmartFoldersHome(home, {
      listFolders: async () => [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Ports",
          saved_search_id: "11111111-2222-4333-8444-555555555555",
          created_unix: 1,
          modified_unix: 1,
        },
      ],
      openPath,
      openSmartFolder: async () => undefined,
    });
    const tagsOff = registerTagNavigation(navigation, { getCatalog: async () => catalog });
    const viewsOff = registerViewsNavigation(navigation, DEFAULT_ENABLED_VIEWS);

    const provider = home.get("tagged_files");
    expect(provider?.label_key).toBe("views.taggedHome");
    const items = await provider!.load(5, new AbortController().signal);
    expect(items[0].target_id).toBe("C:\\Work\\tagged.txt");
    await provider!.activate(items[0]);
    expect(openPath).toHaveBeenCalledWith("C:\\Work\\tagged.txt");
    expect(home.get("smart_folders")?.label_key).toBe("smartFolders.title");

    expect(navigation.list().map((section) => section.id)).toEqual(["tags", "views"]);
    const tagItems = await navigation.load("tags", new AbortController().signal);
    expect(tagItems[0].target_id).toBe(`tag:${catalog.tags[0].id}`);
    const viewItems = await navigation.load("views", new AbortController().signal);
    expect(viewItems.map((item) => item.target_id)).toEqual([
      "view:timeline",
      "view:calendar",
      "view:by_kind",
      "view:recent_activity",
    ]);

    taggedOff();
    foldersOff();
    tagsOff();
    viewsOff();
    expect(home.list()).toHaveLength(0);
    expect(navigation.list()).toHaveLength(0);
  });
});

function searchPage(): SearchPage {
  return {
    results: [],
    next_cursor: null,
    generation: 3,
    total_estimate: 0,
    total_bytes: 0,
    total_exact: true,
    complete: true,
    coverage: "complete",
    skipped_count: 0,
  };
}
