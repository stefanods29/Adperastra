// Drives the packaged app through the WebView2 debugging port (see
// scripts/measure-ui.ps1). Every timing runs inside the page: the action
// is dispatched, then the clock stops at the next painted frame (two
// animation frames), which is what the user sees. Median of RUNS runs.
//
// node scripts/measure-ui.mjs <port> <demoFolder> <bigFolder> <full|screenshots> <outJson|""> <shotDir|""> <lang> <theme>
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).map((value) => (value === "-" ? "" : value));
const [port, demo, big, mode, outFile, shotDir, lang, theme] = args;
const RUNS = 7;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

await page(`window.__m = {
  frame: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  async time(fn) { const t0 = performance.now(); fn(); await this.frame(); return performance.now() - t0; },
  async timeUntil(fn, done) { const t0 = performance.now(); fn(); while (!done()) await new Promise((r) => requestAnimationFrame(r)); await this.frame(); return performance.now() - t0; },
  async waitFor(pred, ms = 20000) { const t0 = performance.now(); while (!pred()) { if (performance.now() - t0 > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } },
  rows: () => [...document.querySelectorAll(".adp-filelist-scroll [role=option]")],
  list: () => document.querySelector(".adp-filelist-scroll"),
  key(target, init) { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); },
  click(el, init = {}) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init })); },
  context(el) { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 10 })); },
  closeMenus() { for (const m of document.querySelectorAll(".adp-ctxmenu")) m.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); },
  // Text buttons in the command bar, in order: New, Sort, View, Details.
  menuButton(index) { return document.querySelectorAll(".adp-commandbar .adp-cmd-text")[index]; },
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
    await window.__m.waitFor(() => document.querySelector(".adp-address-box")?.textContent.includes(${JSON.stringify(name)}) && window.__m.rows().length > 0);
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
  const menuMs = await page(`Number(document.querySelector(".adp-explorer").dataset.lastMenuOpenMs ?? -1)`);
  console.log(`last instrumented menu open: ${menuMs} ms`);

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
    "Get-CimInstance Win32_Process -Filter \"Name = 'Adperastra.exe'\" | Where-Object { $_.CommandLine -like '*--classic-menu*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ]);
  await sleep(500);

  // Step 03b: file operations. These mutate the demo folder, so they run
  // once (not a median loop) and clean up after themselves with node fs.
  const cleanup03b = () => {
    for (const target of [
      join(demo, "New folder"),
      join(demo, "Invoices", "notes.txt"),
      join(demo, "Invoices", "notes (2).txt"),
      join(demo, "folder-100k"),
    ]) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
  cleanup03b();
  await openFolder(demo);
  const once = async (name, action, donePredicate) => {
    const value = await page(`window.__m.timeUntil(() => { ${action} }, () => (${donePredicate}))`);
    const result = { name, median_ms: Math.round(value * 10) / 10, max_ms: Math.round(value * 10) / 10, runs: 1 };
    console.log(`${name}: ${result.median_ms} ms`);
    results.push(result);
    await sleep(300);
  };
  // Ctrl+Shift+N creates a folder and opens its rename box.
  await once(
    "new folder + rename box (Ctrl+Shift+N)",
    `window.__m.key(window, { key: "N", ctrlKey: true, shiftKey: true })`,
    `Boolean(document.querySelector(".adp-rename-input"))`,
  );
  await page(`document.querySelector(".adp-rename-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true`);
  await sleep(400);
  // Delete a file (Recycle Bin) and undo it from the toast.
  await page(`window.__m.click([...window.__m.rows()].find((r) => r.textContent.includes("notes.txt"))); true`);
  await once(
    "delete + undo toast",
    `window.__m.key(window, { key: "Delete" })`,
    `Boolean(document.querySelector(".adp-toast"))`,
  );
  await once(
    "undo from toast (file returns)",
    `[...document.querySelectorAll(".adp-toast button")].find((b) => b.querySelector("span"))?.click()`,
    `window.__m.rows().some((r) => r.textContent.includes("notes.txt"))`,
  );
  // Pasting onto an existing name (from another folder) asks first.
  await page(`window.__TAURI_INTERNALS__.invoke("clipboard_set_files", { paths: [${JSON.stringify(join(demo, "notes.txt"))}], cut: false }).then(() => true)`);
  await page(`window.__m.click(window.__m.rows()[0]); true`);
  await page(`(async () => { const row = [...window.__m.rows()].find((r) => r.textContent.includes("Invoices")); row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); return true; })()`);
  await sleep(700);
  await page(`window.__m.key(window, { key: "v", ctrlKey: true }); true`);
  await sleep(700);
  await once(
    "conflict dialog on paste",
    `window.__m.key(window, { key: "v", ctrlKey: true })`,
    `Boolean(document.querySelector(".adp-dialog"))`,
  );
  await page(`document.querySelectorAll(".adp-dialog-actions .adp-btn")[1]?.click(); true`);
  await sleep(400);
  cleanup03b();
}

if (outFile && results.length > 0) {
  const record = {
    date: new Date().toISOString(),
    step: "03b",
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
  await sleep(400);
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
  await page(`window.__TAURI_INTERNALS__.invoke("file_op_start", { request: { kind: "copy", sources: [${JSON.stringify(big)}], dest_dir: ${JSON.stringify(demo)}, conflict: "skip" }, requestId: "shot-job" }).then(() => true)`);
  await sleep(1200);
  await shot("11-jobs-panel");
  await page(`window.__TAURI_INTERNALS__.invoke("file_op_cancel", { requestId: "shot-job" }).then(() => true).catch(() => true)`);
  await sleep(600);
  try { rmSync(join(demo, "folder-100k"), { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(demo, "Invoices", "notes.txt"), { force: true }); } catch { /* best effort */ }
}

cdp.close();
