// UI-only checks against the job-owned release app and retained synthetic files.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeChecks } from "./check-07a-ipc.mjs";

const [port, demo, data, output, shots, language, theme, started, buildProfile = "release"] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const texts = JSON.parse(readFileSync(join(root, "src/i18n/locales", `${language}.json`), "utf8"));
const t = key => key.split(".").reduce((value, part) => value[part], texts);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], results = [], consoleMessages = [], externalRequests = [], failedRequests = [];
const files = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]);
const hashes = () => Object.fromEntries(files(demo).map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sourceBefore = hashes();
const settings = () => JSON.parse(readFileSync(join(data, "settings.json"), "utf8"));
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === "page" && /^https?:\/\/tauri\.localhost\/?/.test(item.url));
if (!target) throw new Error("No packaged Adperastra page on owned debugging port");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const requests = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) requests.get(message.id)?.(message);
  else if (message.method === "Runtime.exceptionThrown" || message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type) || message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
    if (consoleMessages.length < 100) consoleMessages.push(message);
  } else if (message.method === "Network.requestWillBeSent") {
    const url = message.params.request.url;
    if (/^https?:/.test(url) && !/^https?:\/\/([a-z0-9-]+\.)?localhost(?=[:/])/.test(url) && !/^https?:\/\/127\.0\.0\.1(?=[:/])/.test(url)) externalRequests.push(url);
  } else if (message.method === "Network.loadingFailed") failedRequests.push(message.params);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
  requests.set(id, message => { clearTimeout(timer); requests.delete(id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
const page = async expression => {
  const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
};
const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
const wait = expression => page(`window.__review.wait(() => (${expression}))`);
const waitDisk = async test => { const deadline = performance.now() + 10000; while (!test()) { if (performance.now() > deadline) throw new Error("Settings persistence timed out"); await delay(5); } };
const row = name => `window.__review.row(${JSON.stringify(name)})`;
const ready = name => `${row(name)}?.querySelector('img.adp-file-thumbnail')?.naturalWidth > 0`;
const key = (key, target = "window", ctrl = false, shift = false, code = "") => page(`window.__review.key(${target},${JSON.stringify(key)},${ctrl},${shift},${JSON.stringify(code)});true`);
const frame = () => page("window.__review.frame()");
const record = (name, values, extra = {}) => {
  const sorted = [...values].sort((a, b) => a - b);
  results.push({ name, median_ms: +sorted[Math.floor(sorted.length / 2)].toFixed(2), max_ms: +Math.max(...values).toFixed(2), runs: values.length, ...extra });
};
const navigate = async path => {
  await page("document.querySelector('.adp-address-spacer').click();true");
  await wait("document.querySelector('.adp-address-input')");
  await page(`(() => { const input=document.querySelector('.adp-address-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(path)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.form.requestSubmit(); return true; })()`);
};
const openSettings = async () => {
  await page(`[...document.querySelectorAll('.adp-titlebar .adp-button-row button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(t("settings.title"))}).click();true`);
  await wait("document.querySelector('.adp-settings') && !document.querySelector('.adp-settings').closest('[hidden]')");
  await page("document.getElementById('adp-settings-background').scrollIntoView({block:'start'});true");
};
const explorer = async () => { await page("document.querySelector('[role=tab]').click();true"); await wait("document.querySelector('.adp-tabpane:not([hidden]) .adp-explorer')"); };
const switchFor = key => `[...document.querySelectorAll('#adp-settings-background [role=switch]')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(t(key))})`;
const toggle = async (label, field, value) => {
  await page(`${switchFor(label)}.click();true`);
  await waitDisk(() => settings().background[field] === value);
  await frame();
  check(await page(`${switchFor(label)}.getAttribute('aria-checked') === '${value}'`), `${field} persisted and displays ${value}`);
};
const shot = async name => {
  const folder = join(shots, "step-07a"); mkdirSync(folder, { recursive: true });
  await frame();
  const { data: encoded } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(folder, `${name}-${language}-${theme}.png`), Buffer.from(encoded, "base64"), { flag: "wx" });
};
let passed = false, functionalPassed = false, failure = null, cachePhysicalBytes = null, nativeChecks = null;
try {
  for (const name of ["Runtime", "Log", "Page", "Network"]) await send(`${name}.enable`);
  await page(`window.__review={
    frame:()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),
    async wait(test){const start=performance.now();while(!test()){if(performance.now()-start>20000)throw new Error('UI condition timed out');await new Promise(r=>setTimeout(r,10));}},
    key(target,key,ctrlKey=false,shiftKey=false,code=''){target.dispatchEvent(new KeyboardEvent('keydown',{key,code,ctrlKey,shiftKey,bubbles:true,cancelable:true}));},
    rows:()=>[...document.querySelectorAll('.adp-tabpane:not([hidden]) .adp-filelist-scroll [role=option]')],
    row(name){return this.rows().find(r=>r.textContent.includes(name));}
  };true`);
  await wait("document.querySelector('.adp-explorer') && document.querySelector('.adp-nav-drive')");
  record("step07a.startup.observed", [Date.now() - Number(started)], { method: "process launch to CDP observation of Explorer; includes inspector attachment" });
  await page("document.querySelector('.adp-nav-drive').click();true");
  await wait("document.querySelector('.adp-address-spacer')");
  const coldStart = performance.now();
  await navigate(demo);
  await wait(ready("landscape.png")); await frame();
  record("step07a.thumbnail.first-visible", [performance.now() - coldStart], { cache: "fresh empty data folder; navigation to loaded image" });
  await wait(ready("portrait.jpg"));
  check(await page(`(() => { const image=${row("landscape.png")}.querySelector('img');return image.naturalWidth/image.naturalHeight===2 && image.alt==='' && image.getAttribute('aria-hidden')==='true';})()`), "landscape image has expected aspect ratio and inert accessibility");
  check(await page(`(() => { const image=${row("portrait.jpg")}.querySelector('img');return image.naturalWidth/image.naturalHeight===2;})()`), "EXIF orientation 6 transforms portrait into a landscape preview");
  await delay(500);
  check(await page(`!!${row("broken.png")} && !${row("broken.png")}.querySelector('img.adp-file-thumbnail')`), "damaged PNG retains fallback");
  check(await page(`!!${row("notes.txt")} && !${row("notes.txt")}.querySelector('img.adp-file-thumbnail')`), "unsupported text retains fallback");
  const selected = performance.now();
  await page(`${row("landscape.png")}.click();true`); await wait(`${row("landscape.png")}.getAttribute('aria-selected')==='true'`); await frame();
  record("step07a.selection", [performance.now() - selected]);
  await key("F2", "document.querySelector('.adp-tabpane:not([hidden]) .adp-filelist-scroll')"); await wait("document.querySelector('.adp-rename-input')"); await key("Escape", "document.querySelector('.adp-rename-input')");
  await wait("!document.querySelector('.adp-rename-input')"); checks.push("F2 opens inline rename and Escape cancels without writing");
  await page(`${row("landscape.png")}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:350,clientY:250}));true`);
  await wait("document.querySelector('.adp-ctxmenu')"); await key("Escape", "document.querySelector('.adp-ctxmenu')");
  checks.push("thumbnail row retains context menu");
  await shot("57-thumbnails");
  const cached = [], tabTimes = [];
  for (let index = 0; index < 7; index++) {
    await openSettings(); const start = performance.now(); await explorer();
    await wait(ready("landscape.png")); await frame();
    cached.push(performance.now() - start); tabTimes.push(cached.at(-1));
  }
  record("step07a.thumbnail.cached", cached, { cache: "warm disk; inactive Explorer reactivation to decoded image" });
  record("step07a.tab.switch", tabTimes, { method: "same warm reactivation samples as cached thumbnail" });
  await key("F5"); await wait(ready("landscape.png"));
  check(await page(`${row("landscape.png")}.getAttribute('aria-selected')==='true'`), "folder refresh retains selection and restores thumbnail");
  for (const [digit, mode] of [["3", "mediumIcons"], ["4", "smallIcons"], ["2", "largeIcons"]]) {
    await key(digit, "window", true, true, `Digit${digit}`);
    await wait(`document.querySelector('.adp-itemgrid--${mode}') && (${ready("landscape.png")})`);
    checks.push(`${mode} retains a loaded picture thumbnail`);
  }
  await openSettings();
  const pause = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now(); await toggle("settings.backgroundPaused", "paused", true); pause.push(performance.now() - start);
    await toggle("settings.backgroundPaused", "paused", false);
  }
  record("step07a.background.pause", pause, { method: "click to settings.json paused=true and painted checked switch" });
  await toggle("settings.backgroundIdle", "only_idle", true);
  await toggle("settings.backgroundIdle", "only_idle", false);
  await toggle("settings.backgroundAc", "only_ac", true);
  await toggle("settings.backgroundAc", "only_ac", false);
  await page("const cache=document.querySelector('#adp-background-cache');cache.value='256';cache.dispatchEvent(new Event('change',{bubbles:true}));true");
  await waitDisk(() => settings().cache.max_mb === 256); checks.push("cache size limit persisted through UI");
  await shot("58-background-work");
  const overflow = await page("[...document.querySelectorAll('#adp-settings-background,.adp-settings-content')].map(e=>({class:e.className,extra:e.scrollWidth-e.clientWidth})).filter(e=>e.extra>2)");
  check(overflow.length === 0, `background settings horizontal bounds: ${JSON.stringify(overflow)}`);
  await toggle("settings.backgroundPaused", "paused", true); await explorer();
  const browse = performance.now(); await navigate(join(demo, "many")); await wait("window.__review.rows().some(r=>r.textContent.includes('picture-'))"); await frame();
  record("step07a.browse.1000", [performance.now() - browse], { state: "paused thumbnails; enumerate and first painted rows" });
  await delay(250);
  check(await page("document.querySelectorAll('.adp-tabpane:not([hidden]) img.adp-file-thumbnail').length===0"), "paused new folder retains file fallback without cached images");
  await openSettings(); await toggle("settings.backgroundPaused", "paused", false); await explorer();
  await wait("[...document.querySelectorAll('.adp-tabpane:not([hidden]) img.adp-file-thumbnail')].some(i=>i.naturalWidth>0)");
  const scroll = await page(`(async()=>{const element=document.querySelector('.adp-tabpane:not([hidden]) .adp-filelist-scroll');const values=[];let last=performance.now();for(let i=0;i<90;i++){element.scrollTop+=24;await new Promise(requestAnimationFrame);const now=performance.now();values.push(now-last);last=now;}return values;})()`);
  record("step07a.grid.scroll", scroll, { method: "90 consecutive requestAnimationFrame intervals while scrolling 1000-image folder; display refresh rate limits result" });
  check(await page("window.__review.rows().length<1000"), "1000-image folder keeps bounded virtualized rows");
  const sourceAfter = hashes(); check(JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter), "all 1004 fixture source hashes unchanged");
  const cacheFiles = files(join(data, "cache")); cachePhysicalBytes = cacheFiles.reduce((total, path) => total + statSync(path).size, 0);
  check(cachePhysicalBytes <= settings().cache.max_mb * 1024 * 1024, "cache physical files remain within selected limit");
  await openSettings();
  nativeChecks = await runNativeChecks(page, demo);
  checks.push(...nativeChecks.checks);
  check(nativeChecks.passed, `native lifecycle checks: ${nativeChecks.error ?? 'passed'}`);
  check(JSON.stringify(sourceBefore) === JSON.stringify(hashes()), "all source hashes remain unchanged after native lifecycle checks");
  check(externalRequests.length === 0, "no external HTTP requests observed after inspector attachment");
  functionalPassed = true;
  check(consoleMessages.length === 0, "no captured runtime warnings or errors");
  passed = true;
} catch (error) { failure = String(error.stack ?? error); throw error; }
finally {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), step: "07a", build: buildProfile, language, theme, fixture: demo, data, passed, functional_passed: functionalPassed, console_clean: consoleMessages.length === 0, failure, results, checks, cache_physical_bytes: cachePhysicalBytes, source_hashes: sourceBefore, nativeChecks, consoleMessages, externalRequests, failedRequests, limitations: ["Inspector attaches after startup; early network/console events are not captured.", "Real online-only cloud files, actual AC transitions and 30-second input eligibility require separate owner/environment checks.", "This run does not simulate process restarts, two app-process saturation, or physical drag/drop; native tests cover separate scheduler and cleanup contracts.", "Cold first-visible is one fresh-cache sample; repeated warm samples include UI tab activation and CDP overhead."] }, (_key, value) => typeof value === "string" ? value.replace(/nonce-\d+/g, "nonce-[redacted]") : value, 2) + "\n", { flag: "wx" });
  socket.close();
  console.log(JSON.stringify({ passed, functionalPassed, checks: checks.length, output }));
}
