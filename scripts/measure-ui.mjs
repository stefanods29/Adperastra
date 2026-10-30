// Drives the packaged app through the WebView2 debugging port (see
// scripts/measure-ui.ps1). Every timing runs inside the page: the action
// is dispatched, then the clock stops at the next painted frame (two
// animation frames), which is what the user sees. Median of RUNS runs.
//
// node scripts/measure-ui.mjs <port> <demoFolder> <bigFolder> <full|screenshots> <outJson|""> <shotDir|""> <lang> <theme> [step]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const args = process.argv.slice(2).map((value) => (value === "-" ? "" : value));
const [port, demo, big, mode, outFile, shotDir, lang, theme, stepId] = args;
if (mode === "full" && outFile && !stepId) throw new Error("measure-ui.mjs needs the step id (9th argument)");
const RUNS = 7;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Text samples for the 04b measurements: a 5 MB log and a Markdown page. */
function writeTextSamples(folder) {
  const lines = [];
  for (let index = 0; lines.join("\n").length < 5 * 1024 * 1024; index += 1000) {
    for (let line = index; line < index + 1000; line += 1) {
      lines.push(`2026-10-28 12:00:${String(line % 60).padStart(2, "0")} INFO  worker-${line % 8} processed item ${line} in ${line % 97} ms`);
    }
  }
  writeFileSync(join(folder, "server-5mb.log"), lines.join("\r\n"));
  writeFileSync(
    join(folder, "guide.md"),
    ["# Project guide", "", "Some **bold** text and a [link](https://example.com).", "", "## Steps", "", "1. One", "2. Two", "", "| Name | Size |", "|---|---|", "| a | 1 |", "", "```js", "const x = 1;", "```"].join("\n"),
  );
}

/** Step 04c samples: a 10 s tone as WAV, and a Markdown file marked as
 * downloaded from the internet (its Zone.Identifier stream). */
function writeMediaSamples(folder) {
  const rate = 44100;
  const samples = rate * 10;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(folder, "tone-10s.wav"), Buffer.concat([header, data]));
  writeFileSync(join(folder, "downloaded.md"), "# Downloaded notes\n\nA [web link](https://example.com).\n");
  try {
    writeFileSync(join(folder, "downloaded.md:Zone.Identifier"), "[ZoneTransfer]\r\nZoneId=3\r\n");
  } catch {
    // Not NTFS: the protected view screenshot shows no bar.
  }
}

/** A real PNG (a color gradient), so "open image" measures a real decode. */
function writeGradientPng(path, width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = Math.round((x / width) * 255);
      raw[offset + 1] = Math.round((y / height) * 255);
      raw[offset + 2] = 192;
    }
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  return { send, close: () => socket.close() };
}

const cdp = await connect();
async function page(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    console.error("page error:", result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

await page(`window.__m = {
  frame: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  async time(fn) { const t0 = performance.now(); fn(); await this.frame(); return performance.now() - t0; },
  async timeUntil(fn, done) { const t0 = performance.now(); fn(); while (!done()) { if (performance.now() - t0 > 20000) throw new Error('timeUntil timeout'); await new Promise((r) => requestAnimationFrame(r)); } await this.frame(); return performance.now() - t0; },
  async waitFor(pred, ms = 20000) { const t0 = performance.now(); while (!pred()) { if (performance.now() - t0 > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } },
  rows: () => [...document.querySelectorAll(".adp-filelist-scroll [role=option]")],
  list: () => document.querySelector(".adp-filelist-scroll"),
  key(target, init) { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); },
  click(el, init = {}) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init })); },
  context(el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 10 })); },
  closeMenus() { for (const m of document.querySelectorAll(".adp-ctxmenu")) m.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); },
  // Text buttons in the command bar, in order: New, Sort, View, Details.
  menuButton(index) { return document.querySelectorAll(".adp-commandbar .adp-cmd-text")[index]; },
  // Step 05c: Settings > Layout fields, and the Settings and Explorer tabs.
  layoutField(field, value) { const select = document.querySelector('select[data-layout-field="' + field + '"]'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); return true; },
  openSettings() { document.querySelectorAll(".adp-button-row button")[1]?.click(); },
  openExplorer() { document.querySelector("[role='tab']")?.click(); },
}; true`);
await page(`window.__m.waitFor(() => document.querySelector(".adp-explorer"))`);

async function key(keyName, code, vk, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}

/** The address bar is editable inside a folder, so start from the first
 * drive, then type the path into the address box and submit it. */
async function openFolder(path, settleMs = 500) {
  const name = path.split("\\").pop();
  await page(`(async () => {
    window.__m.closeMenus();
    if (!document.querySelector(".adp-address-box")?.textContent.includes(":")) {
      await window.__m.waitFor(() => document.querySelector(".adp-nav-drive"));
      document.querySelector(".adp-nav-drive").click();
      await window.__m.waitFor(() => window.__m.rows().length > 0);
    }
    document.querySelector(".adp-address-spacer").click();
    await window.__m.waitFor(() => document.querySelector(".adp-address-input"));
    const input = document.querySelector(".adp-address-input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(path)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form.requestSubmit();
    try {
      await window.__m.waitFor(() => document.querySelector(".adp-address-box")?.textContent.includes(${JSON.stringify(name)}) && window.__m.rows().length > 0);
    } catch (error) {
      // Say what the page showed instead of a bare timeout.
      throw new Error("opening " + ${JSON.stringify(name)} + " timed out: " + JSON.stringify({
        address: document.querySelector(".adp-address-box")?.textContent ?? null,
        editing: !!document.querySelector(".adp-address-input"),
        rows: window.__m.rows().length,
        dialog: document.querySelector("[role=dialog]")?.textContent?.slice(0, 120) ?? null,
        status: document.querySelector(".adp-statusbar")?.textContent ?? null,
      }));
    }
    return true;
  })()`);
  await sleep(settleMs);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
async function measure(name, setup, action, cleanup = "true") {
  const values = [];
  for (let run = 0; run < RUNS; run += 1) {
    await page(setup);
    await sleep(60);
    values.push(await page(`window.__m.time(() => { ${action} })`));
    await page(cleanup);
    await sleep(60);
  }
  const result = { name, median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
  console.log(`${name}: median ${result.median_ms} ms (max ${result.max_ms})`);
  return result;
}

async function shot(name) {
  if (!shotDir) return;
  mkdirSync(shotDir, { recursive: true });
  await page(`window.__m.frame()`);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = join(shotDir, `${name}-${lang}-${theme}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`screenshot ${file}`);
}

writeGradientPng(join(demo, "photo-1920.png"), 1920, 1080);
writeTextSamples(demo);
writeMediaSamples(demo);
await openFolder(demo);
const results = [];

if (mode === "full") {
  results.push(await measure("select item (click)", `window.__m.closeMenus(); true`, `window.__m.click(window.__m.rows()[2])`, `window.__m.click(window.__m.list()); true`));
  results.push(await measure("add item (Ctrl+click)", `window.__m.click(window.__m.rows()[1]); true`, `window.__m.click(window.__m.rows()[4], { ctrlKey: true })`));
  results.push(await measure("type-ahead jump", `window.__m.click(window.__m.rows()[0]); window.__m.list().focus(); true`, `window.__m.key(window.__m.list(), { key: "p" })`));
  results.push(await measure("right-click menu on a file", `window.__m.click(window.__m.rows()[3]); true`, `window.__m.context(window.__m.rows()[3])`, `window.__m.closeMenus(); true`));
  results.push(await measure("right-click menu on empty space", `true`, `window.__m.list().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 600, clientY: 700 }))`, `window.__m.closeMenus(); true`));
  results.push(await measure("command bar View menu", `true`, `window.__m.menuButton(2).click()`, `window.__m.closeMenus(); true`));
  results.push(await measure("rename box (F2)", `window.__m.click(window.__m.rows()[5]); window.__m.list().focus(); true`, `window.__m.key(window.__m.list(), { key: "F2" })`, `document.querySelector(".adp-rename-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`));
  // Dates and attributes come from Windows a moment after the click.
  {
    const values = [];
    for (let run = 0; run < RUNS; run += 1) {
      await page(`window.__m.click(window.__m.rows()[${run % 2 === 0 ? 7 : 8}]); true`);
      await sleep(150);
      values.push(
        await page(`window.__m.timeUntil(() => window.__m.click(window.__m.rows()[${run % 2 === 0 ? 8 : 7}]), () => { const cells = [...document.querySelectorAll(".adp-details-grid dd")]; return cells.length > 0 && !document.querySelector(".adp-details-skeleton") && cells[cells.length - 1].textContent.trim().length > 0; })`),
      );
    }
    const result = { name: "details pane filled (dates and attributes)", median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
    console.log(`${result.name}: median ${result.median_ms} ms (max ${result.max_ms})`);
    results.push(result);
  }
  results.push(
    await measure(
      "details pane hide/show (Alt+Shift+P)",
      `true`,
      `window.__m.key(window, { key: "P", altKey: true, shiftKey: true })`,
      `window.__m.key(window, { key: "P", altKey: true, shiftKey: true }); true`,
    ),
  );

  // The 100,000-item folder streams in; give it time to finish loading.
  await openFolder(big, 4000);
  results.push(await measure("100k folder: select item (click)", `true`, `window.__m.click(window.__m.rows()[3])`));
  results.push(await measure("100k folder: arrow key move", `window.__m.list().focus(); true`, `window.__m.key(window.__m.list(), { key: "ArrowDown" })`));
  results.push(await measure("100k folder: select all (Ctrl+A)", `window.__m.click(window.__m.rows()[0]); window.__m.list().focus(); true`, `window.__m.key(window.__m.list(), { key: "a", ctrlKey: true })`));
  results.push(await measure("100k folder: right-click with all selected", `window.__m.list().focus(); window.__m.key(window.__m.list(), { key: "a", ctrlKey: true }); true`, `window.__m.context(window.__m.rows()[2])`, `window.__m.closeMenus(); true`));
  results.push(await measure("100k folder: Shift+click range", `window.__m.click(window.__m.rows()[0]); true`, `window.__m.click(window.__m.rows()[20], { shiftKey: true })`));
  // Step 05a: the views. Shortcuts read the key's position, so `code` is
  // what matters; the typed character is the one Shift produces.
  results.push(await measure("100k folder: switch to Large icons (Ctrl+Shift+2)", `true`, `window.__m.key(window, { key: "@", code: "Digit2", ctrlKey: true, shiftKey: true })`, `window.__m.key(window, { key: "^", code: "Digit6", ctrlKey: true, shiftKey: true }); true`));
  results.push(await measure("100k folder: arrow key move in Large icons", `window.__m.key(window, { key: "@", code: "Digit2", ctrlKey: true, shiftKey: true }); window.__m.click(window.__m.rows()[0]); window.__m.list().focus(); true`, `window.__m.key(window.__m.list(), { key: "ArrowRight" })`, `window.__m.key(window, { key: "^", code: "Digit6", ctrlKey: true, shiftKey: true }); true`));
  results.push(await measure("100k folder: switch to List (Ctrl+Shift+5)", `true`, `window.__m.key(window, { key: "%", code: "Digit5", ctrlKey: true, shiftKey: true })`, `window.__m.key(window, { key: "^", code: "Digit6", ctrlKey: true, shiftKey: true }); true`));
  // Smooth tier: scroll the 100k list one wheel-step per frame for 2 s and
  // record every frame interval. The display's own frame time is the median
  // interval; a frame slower than 1.5x of it is a dropped frame.
  const scroll = await page(`(async () => {
    const list = window.__m.list(); list.scrollTop = 0; await window.__m.frame();
    const gaps = []; let last = performance.now(); const end = last + 2000;
    while (performance.now() < end) {
      list.scrollTop += 120;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now(); gaps.push(now - last); last = now;
    }
    gaps.sort((a, b) => a - b);
    const at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
    const display = at(0.5);
    return { frames: gaps.length, display_ms: display, p95_ms: at(0.95), max_ms: gaps[gaps.length - 1], dropped: gaps.filter((g) => g > display * 1.5).length };
  })()`);
  results.push({ name: "100k folder: scroll frame time (p95)", median_ms: Math.round(scroll.p95_ms * 10) / 10, p95_frame_ms: Math.round(scroll.p95_ms * 10) / 10, max_ms: Math.round(scroll.max_ms * 10) / 10, runs: scroll.frames, display_frame_ms: Math.round(scroll.display_ms * 10) / 10, dropped_frames: scroll.dropped, tier: "smooth" });
  console.log(`100k folder: scroll ${scroll.frames} frames, display ${scroll.display_ms.toFixed(1)} ms, p95 ${scroll.p95_ms.toFixed(1)} ms, dropped ${scroll.dropped}`);
  const menuMs = await page(`Number(document.querySelector(".adp-explorer").dataset.lastMenuOpenMs ?? -1)`);
  console.log(`last instrumented menu open: ${menuMs} ms`);

  // Step 03b: file operations, driven through the app's own commands
  // with hard deadlines (a failure is recorded, never a hang). These
  // mutate the demo folder and clean up after themselves with node fs.
  const cleanup03b = () => {
    for (const target of [
      join(demo, "BenchCopy"),
      join(demo, "Invoices", "notes.txt"),
      join(demo, "Invoices", "notes (2).txt"),
    ]) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
  try {
    cleanup03b();
    await openFolder(demo);
    const timed = async (name, expression) => {
      try {
        const value = await page(expression);
        const result = { name, median_ms: typeof value === "number" ? Math.round(value * 10) / 10 : null, max_ms: typeof value === "number" ? Math.round(value * 10) / 10 : null, runs: 1, note: typeof value === "number" ? undefined : String(value) };
        console.log(`${name}: ${result.median_ms ?? result.note}`);
        results.push(result);
      } catch (error) {
        console.log(`${name}: FAILED ${error.message ?? error}`);
        results.push({ name, median_ms: null, max_ms: null, runs: 1, note: String(error.message ?? error) });
      }
      await sleep(300);
    };
    // Instant tier: the New menu in the command bar.
    await timed("command bar New menu", `window.__m.time(() => { window.__m.menuButton(0).click(); })`);
    await page(`window.__m.closeMenus(); true`);
    // Fast tier: a small copy job (all demo files) start-to-report.
    await timed("copy demo files (job, start to report)", `(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const fs = ${JSON.stringify(["Q4 Budget 2026.xlsx", "Meeting Notes.docx", "notes.txt"])};
      const dest = ${JSON.stringify(join(demo, "BenchCopy"))};
      const t0 = performance.now();
      const id = "bench-copy";
      await invoke("file_op_start", { request: { kind: "copy", sources: fs.map((f) => ${JSON.stringify(demo)} + "\\\\" + f), dest_dir: dest, conflict: "skip" }, requestId: id });
      for (let i = 0; i < 200; i += 1) {
        const poll = await invoke("file_op_poll", { requestId: id });
        if (poll.done) return performance.now() - t0;
        await new Promise((r) => setTimeout(r, 50));
      }
      return "timeout";
    })()`);
    // Recycle + restore round trip through the job commands.
    await timed("recycle + restore one file (jobs)", `(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const target = ${JSON.stringify(join(demo, "BenchCopy", "notes.txt"))};
      const run = async (kind, sources) => {
        const id = "bench-" + kind;
        await invoke("file_op_start", { request: { kind, sources, dest_dir: null, conflict: "skip" }, requestId: id });
        for (let i = 0; i < 200; i += 1) {
          const poll = await invoke("file_op_poll", { requestId: id });
          if (poll.done) return poll.report;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("timeout");
      };
      const t0 = performance.now();
      await run("recycle", [target]);
      await run("restore", [target]);
      return performance.now() - t0;
    })()`);
    // Keep both + Undo: the numbered copy is created next to the original
    // and Undo sends only that copy to the Recycle Bin.
    await timed("copy with Keep both, then undo it (jobs)", `(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const source = ${JSON.stringify(join(demo, "notes.txt"))};
      const dest = ${JSON.stringify(join(demo, "BenchCopy"))};
      const run = async (request) => {
        const id = "bench-" + request.kind + "-" + Math.random().toString(36).slice(2);
        await invoke("file_op_start", { request: { dest_dir: null, conflict: "skip", ...request }, requestId: id });
        for (let i = 0; i < 200; i += 1) {
          const poll = await invoke("file_op_poll", { requestId: id });
          if (poll.error) throw new Error(poll.error);
          if (poll.done) return poll.report;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("timeout");
      };
      const t0 = performance.now();
      const copied = await run({ kind: "copy", sources: [source], dest_dir: dest, conflict: "keepBoth" });
      const created = (copied.created ?? [])[0];
      if (!created) return "kept copy not reported: " + JSON.stringify(copied);
      const recycled = await run({ kind: "recycle", sources: [created.to] });
      if (recycled.completed.length !== 1) return "undo failed: " + JSON.stringify(recycled);
      return performance.now() - t0;
    })()`);
    cleanup03b();
  } catch (error) {
    console.log(`step 03b measurements failed: ${error.message ?? error}`);
  }



  // Step 04a: open a real image in a file tab, and switch tabs.
  try {
    await openFolder(demo);
    const openValues = [];
    for (let run = 0; run < 5; run += 1) {
      openValues.push(
        await page(`window.__m.timeUntil(
          () => [...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
          () => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null)`),
      );
      await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
      await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
      await sleep(200);
    }
    const opened = { name: "open a 1920x1080 PNG in a tab (first view)", median_ms: Math.round(median(openValues) * 10) / 10, max_ms: Math.round(Math.max(...openValues) * 10) / 10, runs: openValues.length };
    console.log(`${opened.name}: median ${opened.median_ms} ms (max ${opened.max_ms})`);
    results.push(opened);
    await page(`[...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); true`);
    await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null)`);
    results.push(
      await measure(
        "switch tab (image tab to Explorer)",
        `true`,
        `document.querySelectorAll(".adp-tab")[0].click()`,
        `document.querySelectorAll(".adp-tab")[1].click(); true`,
      ),
    );
    await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
  } catch (error) {
    console.log(`step 04a measurements failed: ${error.message ?? error}`);
  }

  // Step 04b: open a 5 MB log in the text viewer, and a Markdown page.
  try {
    await openFolder(demo);
    const firstView = async (name, fileName, done) => {
      const values = [];
      for (let run = 0; run < 5; run += 1) {
        values.push(
          await page(`window.__m.timeUntil(
            () => [...window.__m.rows()].find((r) => r.textContent.includes(${JSON.stringify(fileName)})).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
            () => (${done})())`),
        );
        await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
        await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
        await sleep(200);
      }
      const result = { name, median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
      console.log(`${name}: median ${result.median_ms} ms (max ${result.max_ms})`);
      results.push(result);
    };
    await firstView(
      "open a 5 MB log in the text viewer (first view)",
      "server-5mb.log",
      `() => (document.querySelector(".adp-filetab:not([hidden]) .cm-content")?.textContent ?? "").includes("processed item")`,
    );
    await firstView(
      "open a Markdown file (first view)",
      "guide.md",
      `() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null`,
    );
  } catch (error) {
    console.log(`step 04b measurements failed: ${error.message ?? error}`);
  }

  // Step 04c: open a WAV file in the player (until its length is known).
  try {
    await openFolder(demo);
    const values = [];
    for (let run = 0; run < 5; run += 1) {
      values.push(
        await page(`window.__m.timeUntil(
          () => [...window.__m.rows()].find((r) => r.textContent.includes("tone-10s.wav")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
          () => (document.querySelector(".adp-filetab:not([hidden]) audio")?.readyState ?? 0) >= 1)`),
      );
      await page(`window.__m.key(window, { key: "w", ctrlKey: true }); true`);
      await page(`window.__m.waitFor(() => document.querySelector(".adp-tabpane:not([hidden])") !== null)`);
      await sleep(200);
    }
    const result = { name: "open a WAV file in the player (first view)", median_ms: Math.round(median(values) * 10) / 10, max_ms: Math.round(Math.max(...values) * 10) / 10, runs: values.length };
    console.log(`${result.name}: median ${result.median_ms} ms (max ${result.max_ms})`);
    results.push(result);
  } catch (error) {
    console.log(`step 04c measurements failed: ${error.message ?? error}`);
  }

  // Classic menu: time until the helper's menu is on screen. The runner
  // closes it afterwards.
  await openFolder(demo);
  const classic = await page(`(async () => {
    const path = ${JSON.stringify(join(demo, "notes.txt"))};
    const t0 = performance.now();
    try { await window.__TAURI_INTERNALS__.invoke("show_classic_menu", { paths: [path], background: false, x: 400, y: 300 }); return performance.now() - t0; }
    catch (error) { return "error: " + error; }
  })()`);
  console.log(`classic menu ready: ${classic}`);
  results.push({ name: "Show more options (classic menu, separate process)", median_ms: typeof classic === "number" ? Math.round(classic) : null, runs: 1, note: String(classic) });
  await sleep(800);
  // Close the classic menu by ending its helper process.
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$testId = 0; if (-not [int]::TryParse($env:ADPERASTRA_TEST_APP_PID, [ref]$testId) -or $testId -le 0) { throw 'Missing test app process id' }; Get-CimInstance Win32_Process -Filter \"ParentProcessId=$testId\" | Where-Object { $_.CommandLine -like '*--classic-menu*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ]);
  await sleep(500);

}

if (outFile && results.length > 0) {
  const record = {
    date: new Date().toISOString(),
    step: stepId,
    build: "release (tauri build --no-bundle)",
    method: "Inside the packaged app's page: action dispatched, clock stopped at the next painted frame (two animation frames). Median of 7 runs.",
    language: lang,
    theme,
    results,
  };
  writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");
  console.log(`saved ${outFile}`);
}

if (shotDir) {
  // One user action per step, with a painted frame in between, like a
  // person clicking.
  const step = async (code) => {
    await page(`(async () => { ${code}; await window.__m.frame(); return true; })()`);
    await sleep(150);
  };
  if (mode !== "full") {
    // Home shows the demo files as Favorites (the Recent list would show
    // this PC's real recent files).
    const favorites = ["Q4 Budget 2026.xlsx", "Project Overview.pptx", "Meeting Notes.docx", "Website Homepage.png", "Product Demo.mp4", "Brand Guidelines.pdf", "Logo - Final.png"];
    for (const name of favorites) {
      await page(`window.__TAURI_INTERNALS__.invoke("add_favorite", { path: ${JSON.stringify(join(demo, name))} }).then(() => true)`);
    }
    await step(`[...document.querySelectorAll(".adp-explorer-nav button")][0].click()`);
    await sleep(400);
    await step(`document.querySelectorAll(".adp-segment-btn")[1].click()`);
    await sleep(600);
    await step(`window.__m.click(window.__m.rows()[0])`);
    await step(`document.activeElement?.blur()`);
    await sleep(300);
    await shot("00-home");
  }
  await openFolder(demo);
  // The Details pane is on in the test settings; keep it on for screenshots.
  await step(`if (!document.querySelector(".adp-details-pane")) window.__m.key(window, { key: "P", altKey: true, shiftKey: true })`);
  await step(`window.__m.closeMenus()`);
  await step(`window.__m.click(window.__m.rows()[2])`);
  await step(`document.activeElement?.blur()`);
  await sleep(300);
  await shot("01-folder-details");
  await step(`window.__m.context(window.__m.rows()[2])`);
  await sleep(200);
  await shot("02-item-menu");
  await step(`window.__m.closeMenus()`);
  await step(`window.__m.list().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 520, clientY: 640 }))`);
  await step(`document.querySelector(".adp-ctxmenu").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`);
  await step(`document.querySelector(".adp-ctxmenu").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  await sleep(200);
  await shot("03-background-menu-view");
  await step(`window.__m.closeMenus()`);
  await step(`window.__m.closeMenus()`);
  await step(`window.__m.click(window.__m.rows()[1])`);
  await step(`window.__m.click(window.__m.rows()[4], { ctrlKey: true })`);
  await step(`window.__m.click(window.__m.rows()[6], { ctrlKey: true })`);
  await sleep(200);
  await shot("04-multi-select");
  await step(`window.__m.click(window.__m.rows()[6])`);
  await step(`window.__m.list().focus()`);
  await step(`window.__m.key(window.__m.list(), { key: "F2" })`);
  await cdp.send("Input.insertText", { text: "Budget?" });
  await sleep(300);
  await shot("05-rename-problem");
  await step(`document.querySelector(".adp-rename-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await step(`window.__m.menuButton(1).click()`);
  await sleep(200);
  await shot("06-sort-menu");
  await step(`window.__m.closeMenus()`);
  // Step 03b screens: undo toast, permanent-delete warning, conflict,
  // Recent actions, and the jobs panel.
  await step(`window.__m.click([...window.__m.rows()].find((r) => r.textContent.includes("notes.txt")))`);
  await step(`window.__m.key(window, { key: "Delete" })`);
  await sleep(300);
  await shot("07-delete-toast");
  await step(`[...document.querySelectorAll(".adp-toast button")].find((b) => b.querySelector("span"))?.click()`);
  await page(`window.__m.waitFor(() => window.__m.rows().some((r) => r.textContent.includes("notes.txt")), 15000)`);
  await sleep(300);
  await step(`window.__m.click([...window.__m.rows()].find((r) => r.textContent.includes("notes.txt")))`);
  await step(`window.__m.key(window, { key: "Delete", shiftKey: true })`);
  await sleep(300);
  await shot("08-permanent-delete");
  await step(`document.querySelector(".adp-dialog-actions .adp-btn--primary")?.click()`);
  await page(`window.__TAURI_INTERNALS__.invoke("clipboard_set_files", { paths: [${JSON.stringify(join(demo, "notes.txt"))}], cut: false }).then(() => true)`);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("Invoices")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await sleep(700);
  await step(`window.__m.key(window, { key: "v", ctrlKey: true })`);
  await sleep(700);
  await step(`window.__m.key(window, { key: "v", ctrlKey: true })`);
  await sleep(400);
  await shot("09-conflict");
  await step(`document.querySelectorAll(".adp-dialog-actions .adp-btn")[1]?.click()`);
  await sleep(300);
  await step(`document.querySelectorAll(".adp-commandbar .adp-cmd-icon")[6]?.click()`);
  await sleep(300);
  await step(`[...document.querySelectorAll(".adp-ctxmenu-item")].pop()?.click()`);
  await sleep(300);
  await shot("10-recent-actions");
  await step(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  // A real UI copy of the 100k corpus folder into Archive 2025: long
  // enough for the jobs panel to open over it; cancelled right after.
  await openFolder(join(big, ".."), 4000);
  await step(`window.__m.click([...window.__m.rows()].find((r) => r.textContent.includes("folder-100k")))`);
  await step(`window.__m.key(window, { key: "c", ctrlKey: true })`);
  await sleep(400);
  await openFolder(demo);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("Archive 2025")).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await sleep(600);
  await step(`window.__m.key(window, { key: "v", ctrlKey: true })`);
  await sleep(4500);
  await shot("11-jobs-panel");
  await step(`document.querySelector(".adp-jobs-panel .adp-job-row .adp-btn")?.click()`);
  await sleep(800);
  // Folder conflict: Merge is the primary action. The source folder is
  // outside the demo folder so this is a real name clash, not a paste here.
  const folderSource = join(demo, "..", "adperastra-demo-folder-source");
  try { rmSync(folderSource, { recursive: true, force: true }); } catch { /* best effort */ }
  mkdirSync(join(folderSource, "Invoices"), { recursive: true });
  writeFileSync(join(folderSource, "Invoices", "new.txt"), "new");
  await openFolder(folderSource);
  await step(`window.__m.click([...window.__m.rows()].find((r) => r.textContent.includes("Invoices")))`);
  await step(`window.__m.key(window, { key: "c", ctrlKey: true })`);
  await sleep(300);
  await openFolder(demo);
  await sleep(300);
  await step(`window.__m.key(window, { key: "v", ctrlKey: true })`);
  await sleep(600);
  await shot("12-conflict-folder");
  await step(`document.querySelector(".adp-dialog-actions .adp-btn")?.click()`);
  await sleep(300);
  try { rmSync(folderSource, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(demo, "Archive 2025", "folder-100k"), { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(demo, "Invoices", "notes.txt"), { force: true }); } catch { /* best effort */ }
  // Step 04a: an image open in a file tab.
  await openFolder(demo);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("photo-1920.png"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-image-stage[style]") !== null, 15000)`);
  await sleep(300);
  await shot("12-image-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  // Step 04b: the text viewer with its ribbon, and a Markdown page.
  await openFolder(demo);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("server-5mb.log"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => (document.querySelector(".adp-filetab:not([hidden]) .cm-content")?.textContent ?? "").includes("processed item"), 15000)`);
  await sleep(300);
  await shot("13-text-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("guide.md"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null, 15000)`);
  await sleep(300);
  await shot("14-markdown-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  // Step 04c: the audio player, and a downloaded file in protected view.
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("tone-10s.wav"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => (document.querySelector(".adp-filetab:not([hidden]) audio")?.readyState ?? 0) >= 1, 15000)`);
  await sleep(300);
  await shot("15-audio-tab");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("downloaded.md"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await page(`window.__m.waitFor(() => document.querySelector(".adp-filetab:not([hidden]) .adp-markdown-frame")?.contentDocument?.querySelector("main h1") != null, 15000)`);
  await sleep(300);
  await shot("16-protected-view");
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  // Step 05a: the views, and the View menu in the chosen order.
  await step(`window.__m.key(window, { key: "@", code: "Digit2", ctrlKey: true, shiftKey: true })`);
  await step(`window.__m.click(window.__m.rows()[2])`);
  await step(`document.activeElement?.blur()`);
  await sleep(300);
  await shot("17-large-icons");
  await step(`window.__m.key(window, { key: "&", code: "Digit7", ctrlKey: true, shiftKey: true })`);
  await shot("18-tiles");
  await step(`window.__m.key(window, { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true })`);
  await shot("19-content");
  await step(`window.__m.key(window, { key: "%", code: "Digit5", ctrlKey: true, shiftKey: true })`);
  await shot("20-list");
  await step(`window.__m.menuButton(2).click()`);
  await sleep(200);
  await shot("21-view-menu");
  await step(`window.__m.closeMenus()`);
  await step(`window.__m.key(window, { key: "^", code: "Digit6", ctrlKey: true, shiftKey: true })`);

  // Step 05c: the toolbar, the tabs and the panes in every place.
  // "settings" = open Settings, set the layout fields, come back.
  const settings = async (fields) => {
    await step(`window.__m.openSettings()`);
    await sleep(300);
    for (const [field, value] of fields) {
      await step(`window.__m.layoutField(${JSON.stringify(field)}, ${JSON.stringify(value)})`);
    }
    await step(`window.__m.openExplorer()`);
    await sleep(400);
  };
  await step(`window.__m.openSettings()`);
  await sleep(300);
  const rememberedDetails = await page(`document.querySelector('select[data-layout-field="details_pane"]')?.value ?? "hidden"`);
  await step(`window.__m.openExplorer()`);
  await sleep(400);
  await settings([["toolbar_position", "left"]]);
  await shot("24-toolbar-left");
  await settings([
    ["toolbar_position", "bottom"],
    ["toolbar_mode", "iconsOnly"],
  ]);
  await shot("25-toolbar-bottom-icons");
  await settings([
    ["toolbar_position", "top"],
    ["toolbar_mode", "full"],
    ["tab_bar_position", "left"],
  ]);
  await shot("26-tabs-left");
  await settings([
    ["tab_bar_position", "top"],
    ["nav_pane_position", "right"],
    ["details_pane", "bottom"],
  ]);
  await step(`window.__m.click(window.__m.rows()[2])`);
  await sleep(200);
  await shot("27-panes-moved");
  // The file operations screens deleted the demo's notes.txt for good.
  if (!existsSync(join(demo, "notes.txt"))) writeFileSync(join(demo, "notes.txt"), "notes");
  await openFolder(demo);
  await settings([
    ["nav_pane_position", "left"],
    ["details_pane", rememberedDetails],
    ["toolbar_position", "right"],
    ["toolbar_mode", "iconsOnly"],
  ]);
  await step(`[...window.__m.rows()].find((r) => r.textContent.includes("notes.txt"))?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))`);
  await sleep(800);
  await step(`document.querySelector(".adp-flyout-btn")?.click()`);
  await shot("28-ribbon-right-icons");
  await step(`window.__m.key(window, { key: "Escape" })`);
  await step(`window.__m.key(window, { key: "w", ctrlKey: true })`);
  await settings([["preset", "builtin:classic"]]);
  await shot("29-classic");
  await step(`window.__m.openSettings()`);
  await sleep(300);
  await shot("30-layout-settings");
  await step(`window.__m.layoutField("preset", "builtin:standard")`);
  await step(`window.__m.openExplorer()`);
}

cdp.close();
