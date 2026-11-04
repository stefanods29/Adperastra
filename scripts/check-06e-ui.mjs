// Scoped release-app verification for Step 06e. measure-ui.ps1 -Review06e
// supplies a fresh retained demo folder; this runner never deletes files or
// folders and never signs or packages anything. Only its own freshly written
// fixtures and result files are touched.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LANGUAGES = ["en", "es", "pseudo"];
const THEMES = ["light", "dark"];

/** Argument and record scope: a fresh review folder, a local port, no
 * installer, signing or bundling request anywhere in the arguments. */
export function validateReviewScope(argv) {
  const joined = argv.join(" ").toLowerCase();
  for (const forbidden of ["--sign", "signing", "bundle", "installer", "publish"]) {
    if (joined.includes(forbidden)) throw new Error(`the review never signs, packages or publishes (${forbidden})`);
  }
  const [port, demo, output, shots, language, theme] = argv;
  if (!/^\d{2,5}$/.test(port ?? "")) throw new Error("the first argument must be the debugging port");
  if (!demo) throw new Error("the demo folder is required");
  const base = resolve(demo);
  if (!/[\\/]Temp[\\/]adperastra-review-06e-[0-9a-f]+$/i.test(base)) {
    throw new Error("the demo folder must be a fresh adperastra-review-06e-* folder");
  }
  if (output && !isAbsolute(output)) throw new Error("the result file must be an absolute path");
  if (shots && !isAbsolute(shots)) throw new Error("the screenshot folder must be an absolute path");
  if (!LANGUAGES.includes(language ?? "")) throw new Error("language must be en, es or pseudo");
  if (!THEMES.includes(theme ?? "")) throw new Error("theme must be light or dark");
  return { port, demo: base, output: output ?? "", shots: shots ?? "", language, theme };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const scope = validateReviewScope(process.argv.slice(2).map((value) => (value === "-" ? "" : value)));
  await run(scope);
}

async function run({ port, demo, output, shots, language, theme }) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const texts = JSON.parse(readFileSync(join(root, "src/i18n/locales", `${language}.json`), "utf8"));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], texts);
  const spanish = language.startsWith("es");
  const results = [];
  const checks = [];
  const consoleMessages = [];
  const RUNS = 7;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let passed = false;
  let failure = null;

  // Fresh fixtures, all inside the retained review folder.
  mkdirSync(join(demo, "docs", "empty"), { recursive: true });
  writeFileSync(join(demo, "notes.txt"), "First line\r\nSecond line\r\n");
  writeFileSync(join(demo, "docs", "meeting = notes.txt"), "Meeting");
  writeFileSync(join(demo, "docs", "a_b.txt"), "Underscore");
  writeFileSync(join(demo, "docs", "@literal.txt"), "At sign");
  writeFileSync(join(demo, "docs", "ñandú.txt"), "Español");
  writeFileSync(join(demo, "taken.zip"), "sentinel archive");
  writeFileSync(join(demo, "~taken.zip.partial"), "sentinel partial");
  const noisy = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < noisy.length; index += 1) noisy[index] = (index * 37 + 11) & 0xff;
  writeFileSync(join(demo, "one-mib.bin"), noisy);

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
      (message.method === "Runtime.consoleAPICalled" && message.params.type === "error")) {
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
  const wait = (expression) => page(`window.__review.wait(() => (${expression}))`);
  const shot = async (name) => {
    if (!shots) return;
    const folder = join(shots, "step-06e");
    mkdirSync(folder, { recursive: true });
    await page("window.__review.frame()");
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(folder, `${name}-${language}-${theme}.png`), Buffer.from(data, "base64"));
  };
  const measure = async (name, action, done, setup = "true", cleanup = "true") => {
    const values = [];
    for (let run = 0; run < RUNS; run += 1) {
      await page(setup); await delay(60);
      values.push(await page(`window.__review.time(() => { ${action} }, () => (${done}))`));
      await page(cleanup); await delay(60);
    }
    const sorted = [...values].sort((a, b) => a - b);
    const result = { name, median_ms: +sorted[3].toFixed(1), max_ms: +Math.max(...values).toFixed(1), runs: RUNS };
    results.push(result);
    console.log(JSON.stringify(result));
  };

  try {
    await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
    await page(`window.__review = {
      frame: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
      async wait(test) { const start = performance.now(); while (!test()) { if (performance.now()-start > 20000) throw new Error('UI condition timed out'); await new Promise(r => setTimeout(r, 20)); } },
      async time(action, done) { const start = performance.now(); action(); await this.wait(done); await this.frame(); return performance.now()-start; },
      key(target, key, ctrlKey = false) { target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })); },
      rows: () => [...document.querySelectorAll('.adp-filelist-scroll [role=option]')],
      row: (name) => [...document.querySelectorAll('.adp-filelist-scroll [role=option]')].find(r => r.textContent.includes(name)),
      open() { const el=this.row('notes.txt'); el.dispatchEvent(new MouseEvent('dblclick',{ bubbles:true,cancelable:true })); },
      dialog: () => document.querySelector('.adp-archive-create-dialog'),
      context() { const el=this.row('notes.txt'), box=el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{ bubbles:true,cancelable:true,clientX:box.left+40,clientY:box.top+10 })); },
      closeMenus() { for (const menu of [...document.querySelectorAll('.adp-ctxmenu')].reverse()) this.key(menu, 'Escape'); },
      menu: (label) => [...document.querySelectorAll('.adp-ctxmenu [role=menuitem]')].find(e => e.textContent.trim() === label),
      set(selector, value) { const el=document.querySelector(selector); Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el, value); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); },
      click(label, scope='document') { [...document.querySelectorAll(scope + ' button')].find(b => b.textContent.trim() === label)?.click(); },
    }; true`);
    await wait("document.querySelector('.adp-explorer') && document.querySelector('.adp-nav-drive')");
    await page("document.querySelector('.adp-nav-drive').click(); true");
    await wait("document.querySelector('.adp-address-spacer') && window.__review.rows().length > 0");
    await page("document.querySelector('.adp-address-spacer').click(); true");
    await wait("document.querySelector('.adp-address-input')");
    await page(`(() => { const input=document.querySelector('.adp-address-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(demo)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.form.requestSubmit(); return true; })()`);
    await wait("window.__review.row('notes.txt')");
    check(await page("window.__review.row('taken.zip') != null"), "the sentinel archive is present");
    check(await page("window.__review.row('~taken.zip.partial') != null"), "the sentinel partial is visible");

    const compressLabel = spanish ? "Comprimir en…" : "Compress to…";
    const createLabel = spanish ? "Crear" : "Create";
    const openLabel = spanish ? "Abrir" : "Open";
    const diskSelection = `(() => { const rows=[...window.__review.rows()]; rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true})); rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})); return true; })()`;
    const openDialog = `(() => { window.__review.closeMenus(); window.__review.context(); window.__review.menu(${JSON.stringify(compressLabel)})?.click(); return true; })()`;

    await measure("open Compress to dialog", openDialog, "window.__review.dialog() != null", diskSelection,
      "window.__review.key(document,'Escape'); true");
    await measure("switch archive encryption option",
      "window.__review.set('#adp-create-encryption','aes256'); true",
      "document.querySelector('#adp-create-encryption')?.value === 'aes256'",
      `${diskSelection}; ${openDialog}`,
      "window.__review.key(document,'Escape'); true");

    // A real encryption choice, a synthetic password and the job.
    await page(`${diskSelection}; ${openDialog}`);
    await wait("window.__review.dialog() != null");
    await shot("49-compress-dialog");
    await page("window.__review.set('#adp-create-encryption','aes256'); true");
    check(await page("document.querySelector('#adp-create-encryption').value === 'aes256'"), "AES-256 can be chosen");
    await page(`(() => { for (const field of document.querySelectorAll('.adp-archive-password-fields input[type=password]')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'synthetic review passphrase'); field.dispatchEvent(new Event('input',{bubbles:true})); } window.__review.set('#adp-create-name','review-encrypted.zip'); return true; })()`);
    check(await page("document.querySelectorAll('.adp-archive-password-fields input[type=password]').length === 2"), "creation asks for the password twice");
    check(await page("[...document.querySelectorAll('.adp-archive-create-dialog input')].every((i) => i.type !== 'password' || i.value.length > 0)"), "the password fields are filled for the masked check");
    check(await page("document.querySelector('.adp-password-strength-label') != null"), "the strength estimate is shown as text");
    await page("window.__review.click(" + JSON.stringify(createLabel) + ", '.adp-archive-create-dialog')" + "; true");
    await delay(120);
    await shot("51-compression-job");
    await wait("window.__review.dialog() == null");
    await wait("window.__review.row('review-encrypted.zip')");

    const sentinels = await page(`(async () => {
      const read = async (name) => (await window.__review.row(name))?.textContent ?? "";
      return [read('taken.zip'), read('~taken.zip.partial')];
    })()`);
    check(sentinels[0].includes("taken.zip"), "the old archive keeps its name");
    check(sentinels[1].includes("~taken.zip.partial"), "the old partial keeps its name");

    // Open the encrypted archive: the prompt stays masked.
    await page("window.__review.row('review-encrypted.zip').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})); true");
    await wait("document.querySelector('.adp-archive-password-dialog')");
    await shot("50-password-open");
    check(await page("document.querySelectorAll('.adp-archive-password-dialog input[type=password]').length === 1"), "the opening prompt hides the password");
    check(await page("document.querySelector('.adp-archive-password-dialog input[type=checkbox]').checked === false"), "remembering starts unchecked");
    await measure("open encrypted small ZIP",
      `(() => { const field=document.querySelector('.adp-archive-password-dialog input[type=password]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'synthetic review passphrase'); field.dispatchEvent(new Event('input',{bubbles:true})); window.__review.click(${JSON.stringify(openLabel)}, '.adp-archive-password-dialog'); return true; })()`,
      "document.querySelector('.adp-filetab:not([hidden]) .adp-archive [role=option]') != null",
      "true",
      "window.__review.key(window,'w',true); true");
    await wait("document.querySelector('.adp-tabpane:not([hidden])') != null");

    const createArchive = async (name, format, encryption, secret) => {
      await page(`${diskSelection}; ${openDialog}`);
      await wait("window.__review.dialog() != null");
      await page(`window.__review.set('#adp-create-format', ${JSON.stringify(format)}); window.__review.set('#adp-create-encryption', ${JSON.stringify(encryption)}); true`);
      if (secret) {
        await page(`(() => { for (const field of document.querySelectorAll('.adp-archive-password-fields input[type=password]')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(secret)}); field.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);
      }
      await page(`window.__review.set('#adp-create-name', ${JSON.stringify(name)}); true`);
      return page(`window.__review.time(() => { window.__review.click(${JSON.stringify(createLabel)}, '.adp-archive-create-dialog'); }, () => window.__review.row(${JSON.stringify(name)}) != null)`);
    };
    const zipValues = [];
    for (let run = 0; run < RUNS; run += 1) zipValues.push(await createArchive(`review-${run}.zip`, "zip", "none", ""));
    const zip = { name: "create small ZIP (one MiB)", median_ms: +([...zipValues].sort((a, b) => a - b)[3]).toFixed(1), max_ms: +Math.max(...zipValues).toFixed(1), runs: RUNS };
    results.push(zip); console.log(JSON.stringify(zip));
    const sevenValues = [];
    for (let run = 0; run < RUNS; run += 1) sevenValues.push(await createArchive(`review-${run}.7z`, "seven_z", "aes256", "synthetic review passphrase"));
    const seven = { name: "create encrypted small 7z (one MiB)", median_ms: +([...sevenValues].sort((a, b) => a - b)[3]).toFixed(1), max_ms: +Math.max(...sevenValues).toFixed(1), runs: RUNS };
    results.push(seven); console.log(JSON.stringify(seven));

    check(await page("window.__review.row('review-0.zip') != null"), "the created zip is selected where it was made");
    check(checks.length >= 12, "the scoped checks all ran");
    passed = true;
  } catch (error) {
    failure = String(error?.message ?? error);
    console.error(`step 06e review failed: ${failure}`);
  } finally {
    try { socket.close(); } catch { /* already closed */ }
    const record = {
      date: new Date().toISOString(),
      step: "06e",
      scope: "release app, retained fixtures, no signing or installer",
      language,
      theme,
      demo,
      checks,
      results,
      console_errors: consoleMessages.length,
      console_clean: consoleMessages.length === 0,
      passed,
      failure,
    };
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
    }
    console.log(`step 06e review: ${passed ? "passed" : "failed"} (${checks.length} checks)`);
    if (!passed) process.exitCode = 1;
  }
}
