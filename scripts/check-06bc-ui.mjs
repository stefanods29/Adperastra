// Scoped release-app verification for 06b/06c. measure-ui.ps1 -Review06bc
// supplies fresh retained folders; this runner never deletes files or folders.
// Only these newly generated fixtures and result files may be overwritten.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [port, demo, output, shots, language, theme] = process.argv.slice(2).map((v) => v === "-" ? "" : v);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const texts = JSON.parse(readFileSync(join(root, "src/i18n/locales", `${language}.json`), "utf8"));
const t = (key) => key.split(".").reduce((value, part) => value[part], texts);
const original = "Project notes\r\n\r\nThe first saved paragraph.\r\n";
const file = join(demo, "notes.txt");
writeFileSync(file, original);
const results = [], checks = [], consoleMessages = [];
const RUNS = 7;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === "page" && /^https?:\/\/tauri\.localhost\/?/.test(item.url));
if (!target) throw new Error("No packaged Adperastra page on the test debugging port");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const requests = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) requests.get(message.id)?.(message);
  else if (message.method === "Runtime.exceptionThrown" ||
    message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type) ||
    message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
    if (consoleMessages.length < 100) consoleMessages.push(message);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
  requests.set(id, (message) => {
    clearTimeout(timer); requests.delete(id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const page = async (expression) => {
  const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
};
const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
const luminance = (color) => {
  const values = color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const rgb = color.startsWith("color(srgb") ? values : values.map(v => v / 255);
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};
const button = (label, scope = "document") => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const press = (key, ctrl = false) => page(`window.__review.key(window, ${JSON.stringify(key)}, ${ctrl}); true`);
const wait = (expression) => page(`window.__review.wait(() => (${expression}))`);
const closeDialog = async () => { await page("window.__review.key(document,'Escape'); true"); await wait("!document.querySelector('[role=dialog]')"); };
const measure = async (name, action, done, setup = "true", cleanup = "true") => {
  const values = [];
  for (let run = 0; run < RUNS; run++) {
    await page(setup); await delay(60);
    values.push(await page(`window.__review.time(() => { ${action} }, () => (${done}))`));
    await page(cleanup); await delay(60);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const result = { name, median_ms: +sorted[3].toFixed(1), max_ms: +Math.max(...values).toFixed(1), runs: RUNS };
  results.push(result); console.log(JSON.stringify(result));
};
const shot = async (step, name) => {
  if (!shots) return;
  const folder = join(shots, `step-${step}`);
  mkdirSync(folder, { recursive: true });
  await page("window.__review.frame()");
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(folder, `${name}-${language}-${theme}.png`), Buffer.from(data, "base64"));
};
let passed = false;
let functionalPassed = false;
let failure = null;
try {
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await page(`window.__review = {
    frame: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    async wait(test) { const start = performance.now(); while (!test()) { if (performance.now()-start > 20000) throw new Error('UI condition timed out'); await new Promise(r => setTimeout(r, 20)); } },
    async time(action, done) { const start = performance.now(); action(); await this.wait(done); await this.frame(); return performance.now()-start; },
    key(target, key, ctrlKey = false) { target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })); },
    rows: () => [...document.querySelectorAll('.adp-filelist-scroll [role=option]')],
    note: () => [...document.querySelectorAll('.adp-filelist-scroll [role=option]')].find(r => r.textContent.includes('notes.txt')),
    context() { const el=this.note(), box=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{ bubbles:true,cancelable:true,clientX:box.left+40,clientY:box.top+10 })); },
    closeMenus() { for (const menu of [...document.querySelectorAll('.adp-ctxmenu')].reverse()) this.key(menu, 'Escape'); },
    menu: () => document.querySelectorAll('.adp-commandbar .adp-cmd-text')[0],
  }; true`);
  await wait("document.querySelector('.adp-explorer') && document.querySelector('.adp-nav-drive')");
  await page("document.querySelector('.adp-nav-drive').click(); true");
  await wait("document.querySelector('.adp-address-spacer') && window.__review.rows().length > 0");
  await page("document.querySelector('.adp-address-spacer').click(); true");
  await wait("document.querySelector('.adp-address-input')");
  await page(`(() => { const input=document.querySelector('.adp-address-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(demo)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.form.requestSubmit(); return true; })()`);
  await wait("window.__review.note()");
  await page("window.__review.note().dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})); true");
  await wait("document.querySelector('.adp-filetab:not([hidden]) .cm-content[contenteditable=true]')");
  const saveValues = [];
  for (let run=0; run<RUNS; run++) {
    await page("document.querySelector('.adp-filetab:not([hidden]) .cm-content').focus(); true");
    if (run === 0) await page("window.__review.key(document.querySelector('.adp-filetab:not([hidden]) .cm-content'),'a',true); true");
    await send("Input.insertText", { text: run === 0 ? "Updated project notes\nRevision 1\n" : `Revision ${run + 1}\n` });
    await wait("document.querySelector('.adp-tab-dirty')");
    saveValues.push(await page("window.__review.time(() => window.__review.key(window,'s',true), () => !document.querySelector('.adp-tab-dirty'))"));
    check(readFileSync(file,"utf8").includes(`Revision ${run+1}`), `saved revision ${run+1} reached disk`);
  }
  const sorted = [...saveValues].sort((a,b)=>a-b);
  results.push({ name: "save a small text file with version history (Ctrl+S)", median_ms:+sorted[3].toFixed(1), max_ms:+Math.max(...saveValues).toFixed(1), runs:RUNS });
  const beforeRestore = readFileSync(file,"utf8");
  await page(`${button(t("commands.versionHistory"), "document.querySelector('.adp-filetab:not([hidden])')")}.click(); true`);
  await wait("document.querySelectorAll('.adp-versions-list [role=option]').length >= 7");
  await page("[...document.querySelectorAll('.adp-versions-list [role=option]')].at(-1).click(); true");
  await wait("document.querySelector('.adp-diff-row--removed, .adp-diff-row--added')");
  await shot("06b","42-version-history");
  const diffColors = await page("[...document.querySelectorAll('.adp-diff-row--added,.adp-diff-row--removed')].map(e=>({kind:e.className,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}))");
  for (const kind of ["added", "removed"]) {
    const row = diffColors.find(row => row.kind.includes(`--${kind}`));
    check(Boolean(row), `diff contains ${kind} lines`);
    const foreground = luminance(row.color), background = luminance(row.background);
    const contrast = (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
    check(contrast >= 4.5, `${kind} text contrast ${contrast.toFixed(2)}:1 (minimum 4.5:1)`);
  }
  const historyOverflow = await page("[...document.querySelectorAll('[role=dialog], .adp-versions-detail')].map(e=>({class:e.className,extra:e.scrollWidth-e.clientWidth})).filter(e=>e.extra>2)");
  check(historyOverflow.length === 0, `history horizontal bounds: ${JSON.stringify(historyOverflow)}`);
  await page(`${button(t("versions.thisVersion"))}.click(); true`);
  await wait("document.querySelector('.adp-versions-text')");
  check((await page("document.querySelector('.adp-versions-text').textContent")).replaceAll('\r','') === original.replaceAll('\r',''), "oldest version preview matches original bytes");
  await shot("06b","43-version-text");
  await page(`${button(t("versions.restore"))}.click(); true`);
  await wait("document.querySelectorAll('[role=dialog]').length === 2");
  await page(`${button(t("versions.restore"), "[...document.querySelectorAll('[role=dialog]')].at(-1)")}.click(); true`);
  await wait(`${button(t("commands.undo"))} && !${button(t("commands.undo"))}.disabled`);
  check(readFileSync(file,"utf8") === original,"restore kept the selected original version");
  await page(`${button(t("commands.undo"))}.click(); true`);
  await wait(`!${button(t("commands.undo"))} && [...document.querySelectorAll('.adp-versions-detail button')].every(b => !b.disabled)`);
  check(readFileSync(file,"utf8") === beforeRestore,"editor Undo restored exact pre-restore bytes");
  await closeDialog(); await press("w",true);
  await wait("window.__review.note() && !document.querySelector('.adp-filetab:not([hidden])')");
  const historyItem = `[...document.querySelectorAll('.adp-ctxmenu [role=menuitem]')].find(b => b.textContent.trim() === ${JSON.stringify(t("commands.versionHistory"))})`;
  await measure("open the version history (right-click menu)", `${historyItem}.click()`, "document.querySelector('.adp-versions-list [role=option]')", "window.__review.context(); true", "window.__review.key(document,'Escape'); true");
  await wait("!document.querySelector('[role=dialog]')");
  await measure("command bar New menu (with templates)", "window.__review.menu().click()", "document.querySelector('.adp-ctxmenu')", "true", "window.__review.closeMenus(); true");
  await page("window.__review.menu().click(); true"); await delay(200); await shot("06c","44-new-menu");
  await page("[...document.querySelectorAll('.adp-ctxmenu [role=menuitem]')].at(-1).click(); true");
  await wait("document.querySelectorAll('.adp-templates-row').length === 6");
  await delay(200); await shot("06c","45-template-window");
  check(await page("Math.abs(document.querySelector('.adp-templates-dialog').getBoundingClientRect().width-Math.min(640,innerWidth*.92)) < 2"),"template dialog uses its planned 640px width within the viewport");
  const overflow = await page("[...document.querySelectorAll('[role=dialog], .adp-versions-detail, .adp-templates-list')].map(e=>({class:e.className,extra:e.scrollWidth-e.clientWidth})).filter(e=>e.extra>2)");
  check(overflow.length === 0, `dialog horizontal bounds: ${JSON.stringify(overflow)}`);
  await page("document.querySelectorAll('.adp-templates-row')[4].focus(); true");
  check(await page("document.querySelectorAll('.adp-templates-row')[4].getAttribute('aria-selected') === 'true'"),"keyboard focus selected the meeting template");
  const meeting = `${t("templates.meeting.name")}.md`;
  await page("window.__review.key(document.activeElement,'Enter'); true");
  await wait("!document.querySelector('[role=dialog]')");
  check(readFileSync(join(demo,meeting),"utf8").includes("#"),"focused template created its Markdown file");
  check(readFileSync(file,"utf8")===beforeRestore,"template creation left the original document unchanged");
  functionalPassed = true;
  check(consoleMessages.length === 0, "no captured runtime console warnings or errors");
  passed = true;
  console.log(`Verified ${checks.length} checks in ${language}/${theme}`);
} catch (error) {
  failure = String(error.message ?? error);
  throw error;
} finally {
  if (output) {
    mkdirSync(dirname(output), {recursive:true});
    const record = {date:new Date().toISOString(),step:"06b+06c",build:"release (tauri build --no-bundle)",scope:"Only 06b/06c interactions; earlier-step speed regression suite and owner hand checks remain pending",method:"7 runs; action to ready condition and two painted frames",language,theme,fixture:demo,passed,functional_passed:functionalPassed,console_clean:consoleMessages.length===0,failure,results,checks,consoleMessages};
    writeFileSync(output,JSON.stringify(record, (_key,value) => typeof value === "string" ? value.replace(/nonce-\d+/g,"nonce-[redacted]") : value,2)+"\n");
  }
  socket.close();
}
