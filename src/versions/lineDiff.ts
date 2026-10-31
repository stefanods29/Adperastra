// Line differences between two texts (Step 06b): Myers' algorithm, capped. Pure.

export interface DiffOp {
  kind: "same" | "added" | "removed";
  text: string;
}

export type DiffRow = DiffOp | { kind: "skip"; count: number };

/** More changes than this are not shown; the version itself can be opened. */
export const MAX_DIFF_EDITS = 4000;

/** Unchanged lines kept on each side of a change. */
export const CONTEXT_LINES = 3;

/** Split on CRLF, CR or LF. A final line break adds no empty last line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** One layer of Myers' algorithm: x for k = -d, -d + 2, ..., d. */
function valueAt(layer: Int32Array | undefined, d: number, k: number): number {
  if (!layer) return 0;
  const index = (k + d) / 2;
  if (index < 0 || index >= layer.length || !Number.isInteger(index)) return 0;
  return layer[index];
}

/**
 * Myers' greedy O(ND) diff on lines. `null` when the edit distance would
 * exceed `MAX_DIFF_EDITS`. Removed lines come before added lines within a
 * change.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffOp[] | null {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const trace: Int32Array[] = [];
  let endD = -1;
  for (let d = 0; d <= max; d += 1) {
    if (d > MAX_DIFF_EDITS) return null;
    const layer = new Int32Array(d + 1);
    let done = false;
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) {
        x = 0;
      } else {
        const prev = trace[d - 1];
        const prevD = d - 1;
        const down = valueAt(prev, prevD, k + 1);
        const right = valueAt(prev, prevD, k - 1);
        if (k === -d || (k !== d && right < down)) x = down;
        else x = right + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      layer[(k + d) / 2] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
    trace.push(layer);
    if (done) {
      endD = d;
      break;
    }
  }
  if (endD < 0) return null;

  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = endD; d > 0; d -= 1) {
    const prev = trace[d - 1];
    const prevD = d - 1;
    const k = x - y;
    const down = valueAt(prev, prevD, k + 1);
    const right = valueAt(prev, prevD, k - 1);
    const prevK = k === -d || (k !== d && right < down) ? k + 1 : k - 1;
    const prevX = valueAt(prev, prevD, prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: "same", text: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (x === prevX) {
      ops.push({ kind: "added", text: after[y - 1] });
      y -= 1;
    } else {
      ops.push({ kind: "removed", text: before[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: "same", text: before[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    ops.push({ kind: "removed", text: before[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ kind: "added", text: after[y - 1] });
    y -= 1;
  }
  ops.reverse();
  return ops;
}

/**
 * Keep every change plus `CONTEXT_LINES` unchanged lines around it; each
 * other run of unchanged lines becomes one `skip` row. No changes: no rows.
 */
export function withContext(ops: readonly DiffOp[]): DiffRow[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  let changes = 0;
  ops.forEach((op, index) => {
    if (op.kind === "same") return;
    changes += 1;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, index + CONTEXT_LINES);
    for (let i = from; i <= to; i += 1) keep[i] = true;
  });
  if (changes === 0) return [];

  const rows: DiffRow[] = [];
  let index = 0;
  while (index < ops.length) {
    if (keep[index]) {
      rows.push(ops[index]);
      index += 1;
      continue;
    }
    let count = 0;
    while (index < ops.length && !keep[index]) {
      count += 1;
      index += 1;
    }
    rows.push({ kind: "skip", count });
  }
  return rows;
}
