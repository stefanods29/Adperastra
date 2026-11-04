import { describe, expect, it, vi } from "vitest";
import type { JobHandle } from "../services/jobs";
import type { PdfSearchPage } from "../services/pdf";
import {
  boundedExcerpt,
  matchKey,
  mergeMatches,
  PdfSearchController,
  pdfSearchKey,
} from "../handlers/pdf/pdfSearch";

/** The search controller of Step 07d T5: a cursor is bound to one exact
 * query, and changing the query throws the old matches away at once. */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function page(matches: PdfSearchPage["matches"], next: string | null = null): PdfSearchPage {
  return { matches, next_cursor: next, complete: next === null, scanned_pages: 1, total_pages: 10 };
}

function match(page: number, run: number, offset: number, excerpt = "hello world"): PdfSearchPage["matches"][number] {
  return { page, run, offset, length: 5, excerpt };
}

describe("pdf search", () => {
  it("clears the old matches the moment the query changes", async () => {
    const first = deferred<JobHandle<PdfSearchPage>>();
    const firstJob = { id: "a", cancel: vi.fn(async () => undefined), completion: ready(page([match(1, 0, 0)])) };
    const search = vi.fn().mockReturnValue(first.promise);
    const snapshots: { query: string; matches: number }[] = [];
    const controller = new PdfSearchController({ search }, (snapshot) => {
      snapshots.push({ query: snapshot.query, matches: snapshot.matches.length });
    });

    controller.start("session", "source", "hello", false);
    first.resolve(firstJob);
    await vi.waitFor(() => expect(controller.current.matches).toHaveLength(1));

    const second = deferred<JobHandle<PdfSearchPage>>();
    const secondJob = { id: "b", cancel: vi.fn(async () => undefined), completion: ready(page([match(4, 1, 2, "other")])) };
    search.mockReturnValue(second.promise);
    controller.start("session", "source", "other", false);
    // The old matches are gone before the new answer arrives.
    expect(controller.current.matches).toHaveLength(0);
    expect(controller.current.query).toBe("other");
    expect(controller.current.scanning).toBe(true);

    second.resolve(secondJob);
    await vi.waitFor(() => expect(controller.current.matches).toHaveLength(1));
    expect(controller.current.matches[0].page).toBe(4);
  })

  it("drops an answer that belongs to an older query", async () => {
    const first = deferred<JobHandle<PdfSearchPage>>();
    const cancel = vi.fn(async () => undefined);
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(
      Promise.resolve({ id: "new", cancel: vi.fn(async () => undefined), completion: ready(page([match(9, 0, 0)])) }),
    );
    const controller = new PdfSearchController({ search }, () => undefined);

    controller.start("session", "source", "old", false);
    controller.start("session", "source", "new", false);
    first.resolve({ id: "old", cancel, completion: ready(page([match(1, 0, 0)])) });
    await vi.waitFor(() => expect(controller.current.matches).toHaveLength(1));
    expect(controller.current.matches[0].page).toBe(9);
    expect(cancel).toHaveBeenCalled();
  })

  it("keeps a cursor tied to the exact query and case rule", () => {
    const a = pdfSearchKey("session", "source", "hello", false);
    const b = pdfSearchKey("session", "source", "hello", true);
    const c = pdfSearchKey("session", "source", "other", false);
    expect(new Set([a, b, c]).size).toBe(3);
  })

  it("merges answers without repeating a match", () => {
    const merged = mergeMatches([match(1, 0, 0)], [match(1, 0, 0), match(1, 0, 6)]);
    expect(merged).toHaveLength(2);
    expect(merged.map(matchKey)).toEqual(["1:0:0:5", "1:0:6:5"]);
    expect(boundedExcerpt("  a   very\nlong   line  ", 8)).toBe("a very …");
  })

  it("asks for the next chunk only at the end of the loaded matches", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        id: "first",
        cancel: vi.fn(async () => undefined),
        completion: ready(page([match(1, 0, 0)], "cursor-1")),
      })
      .mockResolvedValueOnce({
        id: "second",
        cancel: vi.fn(async () => undefined),
        completion: ready(page([match(2, 0, 0)])),
      });
    const controller = new PdfSearchController({ search }, () => undefined);
    controller.start("session", "source", "hello", false);
    await vi.waitFor(() => expect(controller.current.matches).toHaveLength(1));
    controller.next();
    expect(controller.current.current).toBe(0);
    controller.next();
    await vi.waitFor(() => expect(controller.current.matches).toHaveLength(2));
    expect(search.mock.calls[1][3]).toBe("cursor-1");
    expect(controller.current.complete).toBe(true);
  })
});

function ready<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}
