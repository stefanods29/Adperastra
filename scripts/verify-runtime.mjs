// Real WebView2 smoke, file-safety, accessibility, screenshots and timing.
// Synthetic fixtures only; invoked by verify-runtime.ps1 in a fresh profile.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const [port, fixture, output, language, theme, mode, scaleText] = process.argv.slice(2);
const scale = Number(scaleText);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page');
assert(target, 'WebView2 page exists');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
socket.onmessage = ({data}) => {
  const message = JSON.parse(data);
  if (message.id) {
    const handlers = pending.get(message.id);
    if (handlers) { pending.delete(message.id); clearTimeout(handlers.timer); message.error ? handlers.reject(new Error(message.error.message)) : handlers.resolve(message.result); }
  } else if (message.method === 'Runtime.exceptionThrown') {
    // Rejections with a non-Error value have no description: keep the
    // value and where it was thrown, so the report says what failed.
    const details = message.params.exceptionDetails;
    const thrown = details.exception?.description ?? (details.exception && 'value' in details.exception ? JSON.stringify(details.exception.value) : '');
    const frame = details.stackTrace?.callFrames?.[0];
    consoleErrors.push([details.text, thrown, frame ? `at ${frame.functionName || '(anonymous)'} ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}` : ''].filter(Boolean).join(' '));
  } else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 60000);
  pending.set(id, {resolve, reject, timer});
  socket.send(JSON.stringify({id, method, params}));
});
const page = async expression => {
  const result = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const wait = (predicate, timeout = 15000) => page(`(async()=>{const started=performance.now();while(!(${predicate})){if(performance.now()-started>${timeout})throw new Error('Runtime condition timed out: '+${JSON.stringify(predicate)});await new Promise(r=>setTimeout(r,20));}return true;})()`);
const delay = ms => new Promise(r => setTimeout(r, ms));
const checks = [];
const metrics = [];
const check = (name, result = true) => { assert(result, name); checks.push({name, passed:true}); };
const press = async (key, code, vk, modifiers=0) => {
  // A real Enter key carries the '\r' character; without it a form's
  // implicit submission never happens.
  const text = key === 'Enter' && !modifiers ? {text:'\r',unmodifiedText:'\r'} : {};
  await send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:vk,modifiers,...text});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:vk,modifiers});
};
const click = async selector => {
  const rect = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...rect});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...rect});
};
const textInput = async (selector, text) => {
  await click(selector);
  await press('a','KeyA',65,2);
  await send('Input.insertText',{text});
};
const invoke = (command, args={}) => page(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
let sequence=0;
const job = async (kind,sources,options={}) => {
  const requestId=`runtime-${++sequence}`;
  await invoke('file_op_start',{requestId,request:{kind,sources,dest_dir:null,conflict:'skip',...options}});
  for(let n=0;n<600;n++){
    const poll=await invoke('file_op_poll',{requestId});
    if(poll.error)throw new Error(poll.error);
    if(poll.done)return poll.report;
    await delay(20);
  }
  throw new Error('File job timed out');
};
const rows = '.adp-filelist-scroll [role=option]';
const openFolder = async path => {
  if(!await page(`document.querySelector('.adp-address-box')?.textContent.includes(':')`)) {
    await wait(`!!document.querySelector('.adp-nav-drive')`);
    await page(`document.querySelector('.adp-nav-drive').click();true`);
    await wait(`document.querySelector('.adp-address-box')?.textContent.includes(':')`);
  }
  await wait(`!!document.querySelector('.adp-address-spacer')`);
  await page(`document.querySelector('.adp-address-spacer').click();true`);
  await wait(`!!document.querySelector('.adp-address-input')`);
  await textInput('.adp-address-input',path);
  const started=performance.now();
  await press('Enter','Enter',13);
  await wait(`!document.querySelector('.adp-address-input') && document.querySelectorAll(${JSON.stringify(rows)}).length>0`);
  return performance.now()-started;
};
const snapshot = async name => {
  await page(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const image=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(join(output,`${name}-${language}-${theme}-${scale*100}.png`),Buffer.from(image.data,'base64'));
};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:scale,mobile:false});
  await wait(`!!window.__TAURI_INTERNALS__ && !!document.querySelector('.adp-explorer')`);
  const firstRows=await openFolder(fixture);
  check('Folder opens with real file rows',await page(`document.querySelector(${JSON.stringify(rows)})?.textContent.length>0`));
  metrics.push({name:'folder first rows',value_ms:Math.round(firstRows),limit_ms:1000});
  await textInput('.adp-address-search input','note');
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===1`);
  check('File filtering returns the matching file');
  await textInput('.adp-address-search input','');
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length>=4`);
  await page(`document.querySelector(${JSON.stringify(rows)}).click();document.querySelector('.adp-filelist-scroll').focus();true`);
  await press('a','KeyA',65,2);
  check('Ctrl+A selects file rows without selecting page text',await page(`document.querySelectorAll('${rows}[aria-selected=true]').length>=4 && String(window.getSelection())===''`));
  await page(`document.querySelector(${JSON.stringify(rows)}).click();true`);
  const t0=performance.now();
  await press('F2','F2',113);
  await wait(`!!document.querySelector('.adp-rename-input')`);
  metrics.push({name:'rename feedback',value_ms:Math.round(performance.now()-t0),limit_ms:100});
  await textInput('.adp-rename-input','Budget?');
  check('Invalid rename is visibly rejected',await page(`!!document.querySelector('.adp-rename-input[aria-invalid=true]')`));
  await press('Escape','Escape',27);
  await snapshot('folder');
  // Run the unmodified accessibility engine locally; never load a CDN.
  await page(readFileSync(new URL('../node_modules/axe-core/axe.min.js',import.meta.url),'utf8'));
  const accessibility=await page(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))})),passes:r.passes.length,incomplete:r.incomplete.length}))`);
  writeFileSync(join(output,`accessibility-${language}-${theme}-${scale*100}.json`),JSON.stringify(accessibility,null,2));
  check('No WCAG A/AA accessibility violations',accessibility.violations.length===0);
  // Native file operations and Undo/Redo in the actual app, synthetic files.
  const src=join(fixture,'notes.txt');
  const destination=join(fixture,'Destination');
  const copied=await job('copy',[src],{dest_dir:destination});
  check('Copy job writes exact bytes',readFileSync(join(destination,'notes.txt'),'utf8')==='runtime notes\n');
  check('Copy job has no skipped items',copied.skipped.length===0);
  const recycled=await job('recycle',[join(destination,'notes.txt')]);
  check('Recycle preserves recoverable item',recycled.completed.length===1&&!existsSync(join(destination,'notes.txt')));
  await job('restore',[join(destination,'notes.txt')]);
  check('Restore returns exact original content',readFileSync(join(destination,'notes.txt'),'utf8')==='runtime notes\n');
  // UI command path: delete and Ctrl+Z/Ctrl+Y use the shared Undo stack.
  await openFolder(destination);
  await page(`document.querySelector(${JSON.stringify(rows)}).click();document.querySelector('.adp-filelist-scroll').focus();true`);
  await press('Delete','Delete',46);
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===0`);
  await press('z','KeyZ',90,2);
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===1`);
  check('Ctrl+Z restores a deleted file through UI',existsSync(join(destination,'notes.txt')));
  await press('y','KeyY',89,2);
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===0`);
  check('Ctrl+Y repeats deletion through UI',!existsSync(join(destination,'notes.txt')));
  await press('z','KeyZ',90,2);
  await wait(`document.querySelectorAll(${JSON.stringify(rows)}).length===1`);
  await snapshot('undo');
  check('No browser exceptions or console errors',consoleErrors.length===0);
  for(const metric of metrics)check(`${metric.name} meets ${metric.limit_ms}ms tier`,metric.value_ms<=metric.limit_ms);
  writeFileSync(join(output,`runtime-${language}-${theme}-${scale*100}.json`),JSON.stringify({language,theme,scale,mode,checks,metrics,consoleErrors},null,2));
  console.log(`${language}/${theme}/${scale*100}%: ${checks.length} runtime checks passed`);
} catch(error) {
  // Keep what the page showed when the check failed.
  try { await snapshot('failure'); } catch { /* the page may be gone */ }
  writeFileSync(join(output,`runtime-${language}-${theme}-${scale*100}.json`),JSON.stringify({language,theme,scale,mode,checks,metrics,consoleErrors,error:String(error.stack??error)},null,2));
  throw error;
} finally {socket.close();}
