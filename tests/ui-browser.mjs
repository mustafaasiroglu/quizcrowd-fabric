import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startPreview } from './ui-preview.mjs';

const edge = process.env.QUIZCROWD_TEST_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const directory = resolve('rayfin', '.temp', 'routing-review');
const profile = resolve('rayfin', '.temp', 'edge-ui-review');
const report = { kind: 'Local real-browser UI tests with test-only connection fixtures; not live Fabric authorization', filter: process.env.QUIZCROWD_UI_FILTER ?? null, checks: [], screenshots: [], contrast: [] };
let browser, cdp, server;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect() {
  let version;
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch('http://127.0.0.1:9339/json/version')).json(); break; }
    catch { await pause(100); }
  }
  if (!version) throw new Error('Owned isolated Edge did not become ready.');
  const endpoint = new URL(version.webSocketDebuggerUrl);
  assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '9339');
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map(), exceptions = [], network = [], dialogs = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
    if (message.method === 'Page.javascriptDialogOpening') dialogs.push(message.params);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  return {
    exceptions, network, dialogs,
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); },
  };
}
let session;
async function evaluate(expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 65; i++) { if (await evaluate(expression)) return; await pause(100); }
  throw new Error(`UI condition did not become true: ${expression}\n${await evaluate('document.body.innerText')}`);
}
async function click(text) {
  const expression = `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)})`;
  await pointerClick(expression);
}
async function clickWithConfirmation(text, accept) {
  const count = cdp.dialogs.length;
  const clicking = click(text);
  for (let i = 0; i < 80 && cdp.dialogs.length === count; i++) await pause(50);
  assert.equal(cdp.dialogs.length, count + 1);
  assert.equal(cdp.dialogs.at(-1).type, 'confirm');
  await cdp.call('Page.handleJavaScriptDialog', { accept }, session);
  await clicking;
}
async function pointerClick(expression) {
  const { x, y } = await evaluate(`(() => { const button=${expression}; if (!button || button.disabled) throw new Error('Clickable control missing'); button.scrollIntoView({block:'center'}); const rect=button.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()`);
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y }, session);
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y }, session);
  await pause(80);
}
async function input(selector, value) {
  await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Input missing'); const proto=element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function submitAuthor() {
  await pointerClick('document.querySelector(".author-session-actions button[type=submit]")');
}
async function chooseSurveyType(value) {
  if (!await evaluate('document.querySelector(".question-type").getAttribute("aria-expanded")==="true"')) {
    await pointerClick('document.querySelector(".question-type")');
  }
  await until('!!document.querySelector(".question-type-menu")');
  await pointerClick(`document.querySelector('.question-type-menu [value="${value}"]')`);
  assert.equal(await evaluate('document.querySelector(".question-type").getAttribute("aria-expanded")'),'false');
  assert.equal(await evaluate('document.activeElement.classList.contains("question-type")'),true);
}
async function setQuestionDuration(value, index=0) {
  const root=`.question-editor:nth-child(${index+1})`;
  await pointerClick(`document.querySelector('${root} .question-duration')`);
  await until(`!document.querySelector('${root} .question-duration-popup').hidden`);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${root} .duration input')`),true);
  await input(`${root} .duration input`,String(value));
  await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
  await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
  assert.equal(await evaluate(`document.querySelector('${root} .question-duration-popup').hidden`),true);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${root} .question-duration')`),true);
}
async function assertSmoothTimer(name) {
  const measured=await evaluate(`(async () => {
    const fill=document.querySelector('.timer-fill'),timer=document.querySelector('.timer'),track=document.querySelector('.timer-track');
    let labels=0,frames=0;
    const labelObserver=new MutationObserver(()=>labels++),frameObserver=new MutationObserver(()=>frames++);
    labelObserver.observe(timer,{attributes:true,attributeFilter:['aria-label']});
    frameObserver.observe(fill,{attributes:true,attributeFilter:['style']});
    const points=[];
    for(let i=0;i<10;i++){points.push({time:performance.now(),ratio:new DOMMatrixReadOnly(getComputedStyle(fill).transform).a});await new Promise(resolve=>setTimeout(resolve,180));}
    labelObserver.disconnect();frameObserver.disconnect();
    return {points,labels,frames,duration:Number(track.getAttribute('aria-valuemax')),sameNode:document.querySelector('.timer-fill')===fill};
  })()`);
  (report.timers??=[]).push({name,...measured});
  assert.equal(measured.sameNode,true);
  assert.ok(measured.frames>=10,`${name}: continuous frame paints`);
  assert.ok(measured.labels<=3,`${name}: seconds label is not rendered at frame rate`);
  assert.equal(new Set(measured.points.map(point=>point.ratio.toFixed(5))).size,10);
  for(let i=1;i<measured.points.length;i++){
    const previous=measured.points[i-1],next=measured.points[i],delta=previous.ratio-next.ratio;
    assert.ok(delta>0,`${name}: progress must decrease between subsecond samples and across polls`);
    const expected=(next.time-previous.time)/(measured.duration*1000);
    assert.ok(Math.abs(delta-expected)<64/(measured.duration*1000),`${name}: monotonic server-aligned progress ${JSON.stringify({delta,expected,duration:measured.duration,points:measured.points})}`);
  }
}
async function assertFilledForeground(selector) {
  const { root } = await cdp.call('DOM.getDocument', {}, session);
  const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: root.nodeId, selector }, session);
  assert.ok(nodeId, `Filled button missing: ${selector}`);
  for (const forcedPseudoClasses of [[], ['hover'], ['focus-visible'], ['active']]) {
    await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }, session);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`), 'rgb(255, 255, 255)');
  }
  await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled=true`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`), 'rgb(255, 255, 255)');
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled=false`);
}
async function assertAnswerForeground(name) {
  const { root } = await cdp.call('DOM.getDocument', {}, session);
  const { nodeIds } = await cdp.call('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.answer:not(.other-choice)' }, session);
  assert.ok(nodeIds.length >= 1 && nodeIds.length <= 10);
  async function measure(state) {
    const colors = await evaluate(`(() => {
      const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
      return [...document.querySelectorAll('.answer:not(.other-choice)')].map(e=>{
        const s=getComputedStyle(e),rgb=s.backgroundColor.match(/[\\d.]+/g).slice(0,3).map(Number);
        const luminance=rgb.map(c=>linear(c/255)).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        let opacity=1;for(let p=e;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
        return {color:s.color,labelColor:getComputedStyle(e.querySelector('span')??e).color,contrast:1.05/(luminance+.05),opacity,filter:s.filter,backgroundImage:s.backgroundImage};
      });
    })()`);
    for (const color of colors) {
      assert.equal(color.color, 'rgb(255, 255, 255)', `${name}: ${state}`);
      assert.equal(color.labelColor, 'rgb(255, 255, 255)', `${name}: ${state} nested label`);
      assert.ok(color.contrast >= 4.5, `${name}: ${state} contrast ${color.contrast}`);
      assert.equal(color.opacity, 1, `${name}: ${state} does not fade the foreground`);
      assert.equal(color.filter, 'none');
      assert.ok(color.backgroundImage === 'none' || /^linear-gradient\(rgba\(0, 0, 0, 0\.(08|12)\), rgba\(0, 0, 0, 0\.(08|12)\)\)$/.test(color.backgroundImage), 'only black background shading may increase white contrast');
    }
    (report.answerColors ??= []).push({ name, state, colors });
  }
  for (const forcedPseudoClasses of [[], ['hover'], ['focus-visible', 'focus-within'], ['active']]) {
    for (const nodeId of nodeIds) await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }, session);
    await measure(forcedPseudoClasses.join('+') || 'normal/selected');
  }
  for (const nodeId of nodeIds) await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session);
  const disabledTargets = await evaluate('(() => {const targets=[...document.querySelectorAll("button.answer, .survey-response fieldset")];targets.forEach(e=>e.disabled=true);return targets.length})()');
  if (disabledTargets) {
    await measure('disabled');
    await evaluate('[...document.querySelectorAll("button.answer, .survey-response fieldset")].forEach(e=>e.disabled=false)');
  }
}
function assertJoinChecksum(code) {
  assert.match(code, /^\d{6}$/);
  assert.equal(Number(code[0]), [...code.slice(1)].reduce((sum, digit) => sum + Number(digit), 0) % 10);
}
async function screenshot(name, selector, viewport = false) {
  if (!viewport) await evaluate('window.scrollTo(0,0)');
  const modal = await evaluate('!!document.querySelector("dialog[open]")');
  const clip = selector ? await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.max(0,r.left+scrollX-4),y:Math.max(0,r.top+scrollY-4),width:r.width+8,height:r.height+8,scale:4};})()`) : undefined;
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !modal && !viewport, ...(clip ? { clip } : {}) }, session);
  const relative = join('rayfin', '.temp', 'routing-review', `${name}.png`);
  await writeFile(relative, Buffer.from(shot.data, 'base64'));
  report.screenshots.push(relative);
}
async function check(name, run) {
  if (process.env.QUIZCROWD_UI_FILTER && !name.includes(process.env.QUIZCROWD_UI_FILTER)) return;
  await run();
  report.checks.push({ name, passed: true });
}
async function inspectScreen(name) {
  const audience = await evaluate(`(() => {
    const fieldset=document.querySelector(".audience-settings");
    return fieldset ? {disabled:fieldset.querySelector('input[value="public"]').disabled,options:[...fieldset.querySelectorAll("label")].map(label=>({
      value:label.querySelector("input").value,
      title:label.querySelector("span").firstChild.textContent,
      description:label.querySelector(".audience-description").textContent,
    }))} : null;
  })()`);
  if (audience) assert.deepEqual(audience.options, [
    {value:'internal', title:'Only people in my organization', description:'Requires sign-in with organization account'},
    {value:'public', title:audience.disabled?'Anyone with link (disabled by admin)':'Anyone with link', description:'Anonymous response, no sign-in required.'},
  ], `${name}: exact audience order and copy`);
  const editor = await evaluate(`(() => {
    const root=document.querySelector('.author');if(!root)return null;
    return {survey:root.querySelector('h1').textContent.endsWith('Survey'),readOnly:!!root.querySelector('.readonly-notice'),
      legends:[...root.querySelectorAll('.settings-group > fieldset > legend')].map(e=>e.textContent),
      late:[...root.querySelectorAll('input[name="late-join"]')].map(e=>e.labels[0].textContent),
      reveal:[...root.querySelectorAll('input[name="answer-reveal"]')].map(e=>e.labels[0].textContent),
      emptyGroups:[...root.querySelectorAll('.settings-group')].filter(e=>!e.textContent.trim()).length,
      hints:[...root.querySelectorAll('.question-editor')].map(q=>{
        const hint=q.querySelector('.option-hint'),grid=q.querySelector('.option-editor-grid'),add=[...q.querySelectorAll('button')].find(e=>e.textContent.trim()==='Add option');
        return {exists:!!hint,afterOptions:!hint||!!(grid.compareDocumentPosition(hint)&Node.DOCUMENT_POSITION_FOLLOWING),
          beforeAdd:!hint||!add||!!(hint.compareDocumentPosition(add)&Node.DOCUMENT_POSITION_FOLLOWING),
          aligned:!hint||!add||Math.abs((hint.getBoundingClientRect().top+hint.getBoundingClientRect().bottom-add.getBoundingClientRect().top-add.getBoundingClientRect().bottom)/2)<4||add.getBoundingClientRect().top>=hint.getBoundingClientRect().bottom,
          smallActions:[...q.querySelectorAll('.option-actions button')].every(e=>getComputedStyle(e).fontSize==='12px'&&e.getBoundingClientRect().height>=32)};
      })};
  })()`);
  if (editor) {
    assert.deepEqual(editor.legends, ['Who can respond?', 'Answer duration', 'Allow late joins?', ...(editor.survey ? [] : ['Show correct answers?'])]);
    assert.deepEqual(editor.late, ["Don't allow late join", 'Allow join after session start']);
    assert.deepEqual(editor.reveal, editor.survey ? [] : ['Wait for all users', 'Show after user response', 'Never show']);
    assert.equal(editor.emptyGroups, 0);
    for (const hint of editor.hints) {
      assert.equal(hint.exists, !editor.survey && !editor.readOnly); assert.ok(hint.afterOptions && hint.beforeAdd && hint.aligned && hint.smallActions, `${name}: helper and small actions must share a row or wrap without overflow`);
    }
  }
  const dialog = await evaluate(`(() => {const e=document.querySelector('dialog[open]');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {center:r.top+r.height/2,expected:innerHeight/2,top:r.top,height:r.height,position:s.position,inset:s.inset,margin:s.margin,scrollY,viewport:visualViewport.height};})()`);
  if (dialog) assert.ok(Math.abs(dialog.center - dialog.expected) <= 1, `${name}: modal must be centered in the actual viewport: ${JSON.stringify(dialog)}`);
  const layout = await evaluate(`({ width:innerWidth, scroll:document.documentElement.scrollWidth, page:document.querySelector('main').className, unnamed:[...document.querySelectorAll('input,textarea,select')].filter(e => e.getBoundingClientRect().width && !e.labels?.length && !e.getAttribute('aria-label')).map(e=>e.outerHTML), themes:[...document.querySelectorAll('[aria-label="Color theme"] button')].map(e=>e.getAttribute('aria-label')) })`);
  assert.ok(layout.scroll <= layout.width + 1, `${name}: horizontal overflow ${layout.scroll}/${layout.width}`);
  assert.deepEqual(layout.unnamed, [], `${name}: unnamed form controls`);
  assert.deepEqual(layout.themes, ['Dark', 'Light']);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(\'[aria-label="Color theme"] button\')].map(e=>e.textContent)'), ['', '']);
  const shell = await evaluate('({width:document.querySelector("main").getBoundingClientRect().width, max:getComputedStyle(document.querySelector("main")).maxWidth})');
  assert.equal(shell.max, '1280px');
  assert.ok(shell.width <= Math.min(layout.width, 1280), `${name}: shared content width`);
  assert.equal(await evaluate('document.querySelector("footer").textContent'), 'QuizCrowd for Microsoft Fabric · About');
  const tree = await cdp.call('Accessibility.getFullAXTree', {}, session);
  const unnamed = tree.nodes.filter((node) => !node.ignored && ['button', 'textbox', 'combobox', 'checkbox', 'radio'].includes(node.role?.value) && !node.name?.value);
  assert.deepEqual(unnamed.map((node) => node.role.value), [], `${name}: unnamed interactive AX nodes`);
  const contrast = await evaluate(`(() => {
    const parse = color => { color=color.trim(); if (/^#[0-9a-f]{6}$/i.test(color)) return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)); const m=color.match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
    const composite = (fg,bg) => {const a=fg[3] ?? 1; return [0,1,2].map(i=>fg[i]*a+bg[i]*(1-a));};
    const lum = rgb => rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => {const x=lum(a),y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const style=getComputedStyle(document.documentElement);
    const base=['--qc-bg','--qc-bg-two','--qc-bg-three','--qc-bg-four'].map(v=>parse(style.getPropertyValue(v)));
    const failures=[]; let tested=0;
    for (const e of document.querySelectorAll('h1,h2,h3,p,label,button,a,strong,span,summary,option,input,textarea,select')) {
      if (!e.getBoundingClientRect().width || e.closest('[aria-hidden="true"]') || e.disabled || e.closest('button:disabled') || e.classList.contains('sr-only') || e.tagName==='OPTION') continue;
      if (![...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()) && !['INPUT','TEXTAREA','SELECT'].includes(e.tagName)) continue;
      const s=getComputedStyle(e); if (Number(s.opacity)===0) continue;
      const backgrounds=[]; for (let p=e;p && p!==document.body;p=p.parentElement) backgrounds.unshift(parse(getComputedStyle(p).backgroundColor));
      const minimum=Math.min(...base.map(bg=>{for(const layer of backgrounds) bg=composite(layer,bg);return ratio(parse(s.color),bg);}));
      const large=parseFloat(s.fontSize)>=24 || parseFloat(s.fontSize)>=18.66 && Number(s.fontWeight)>=700;
      tested++;
      if (minimum < (large?3:4.5)-.02) failures.push({text:(e.textContent || e.getAttribute('placeholder') || e.tagName).trim().slice(0,70),ratio:minimum,color:s.color,fontSize:s.fontSize});
    }
    return {tested,failures};
  })()`);
  report.contrast.push({ name, ...contrast });
  assert.deepEqual(contrast.failures, [], `${name}: computed text contrast failures ${JSON.stringify(contrast.failures)}`);
}
async function navigate(query = '') {
  const nonce = crypto.randomUUID();
  const { identifier } = await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (location.origin === "http://127.0.0.1:5174") {
      sessionStorage.removeItem("quizcrowd-attendee-credential");
      sessionStorage.removeItem("quizcrowd-test-fixture");
      sessionStorage.setItem("quizcrowd-test-navigation", ${JSON.stringify(nonce)});
      window.__quizcrowdNavigation = ${JSON.stringify(nonce)};
    }` }, session);
  try {
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:5174/${query}` }, session);
    await until(`window.__quizcrowdNavigation===${JSON.stringify(nonce)} && !!window.__quizcrowdFixture && !!document.querySelector("main")`);
  } finally {
    await cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }, session);
  }
  await pause(250);
}
async function phase(value) {
  await evaluate(`window.__quizcrowdFixture.phase(${JSON.stringify(value)})`);
  await until(`document.querySelector('[data-phase="${value}"]') !== null`);
}
try {
  // Refuse to attach to somebody else's server or browser.
  for (const port of [5174, 9339]) {
    const { createServer } = await import('node:net');
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error(`Test port ${port} is already in use.`)));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  await mkdir(directory, { recursive: true });
  server = await startPreview();
  const ready = await fetch('http://127.0.0.1:5174');
  assert.equal(ready.status, 200);
  await check('built physical screen entry points work without a SPA fallback', async () => {
    const html = await ready.text();
    for (const path of ['admin/', 'join/', 'host/create/', 'host/item/', 'host/lobby/', 'host/game/', 'play/', 'library/', 'quizzes/']) {
      const response = await fetch(`http://127.0.0.1:5174/${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), html);
    }
    assert.equal((await fetch('http://127.0.0.1:5174/not-a-built-screen/')).status, 404);
  });
  browser = spawn(edge, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9339', `--user-data-dir=${profile}`, '--guest', '--disable-sync', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  browser.on('error', (error) => console.error(error.message));
  cdp = await connect();
  const { targetInfos } = await cdp.call('Target.getTargets');
  const target = targetInfos.find((target) => target.type === 'page' && target.url === 'about:blank');
  assert.ok(target, 'Owned isolated blank tab missing.');
  ({ sessionId: session } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await cdp.call('Page.enable', {}, session);
  await cdp.call('Page.bringToFront', {}, session);
  await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true }, session);
  await cdp.call('Runtime.enable', {}, session);
  await cdp.call('DOM.enable', {}, session);
  await cdp.call('CSS.enable', {}, session);
  await cdp.call('Network.enable', {}, session);
  await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] }, session);

  await check('initial theme follows browser preference; saved manual choices win without later system changes', async () => {
    for (const [saved, system, expected] of [[null,'dark','dark'],[null,'light','light'],['invalid','dark','dark'],['invalid','light','light'],['light','dark','light'],['dark','light','dark']]) {
      await cdp.call('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:system}] }, session);
      const {identifier}=await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`
        if(location.origin==="http://127.0.0.1:5174") {
          ${saved===null?'localStorage.removeItem("quizcrowd-theme");':`localStorage.setItem("quizcrowd-theme",${JSON.stringify(saved)});`}
        }`},session);
      try { await navigate('?fixture=signed-out'); }
      finally { await cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier},session); }
      assert.equal(await evaluate('document.documentElement.dataset.theme'),expected);
      assert.equal(await evaluate(`document.querySelector('[aria-label="${expected==='dark'?'Dark':'Light'}"]').getAttribute('aria-pressed')`),'true');
      assert.equal(await evaluate('localStorage.getItem("quizcrowd-theme")'),saved);
    }
    await click('Light');
    await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'dark'}]},session);
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
    await cdp.call('Page.reload',{},session);
    await until('!!document.querySelector(".theme-switch")');
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
    assert.equal(await evaluate('localStorage.getItem("quizcrowd-theme")'),'light');
  });

  await check('startup overlay: pending, ready, failure, retry and signed-out states', async () => {
    await navigate('?fixture=admin');
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, session);
      await evaluate(`localStorage.setItem('quizcrowd-theme',${JSON.stringify(theme)})`);
      await navigate('?startup=loading&fixture=signed-out');
      assert.equal(await evaluate('document.querySelector(".app-shell").inert'), true);
      assert.equal(await evaluate('document.querySelector(".app-shell").getAttribute("aria-busy")'), 'true');
      assert.equal(await evaluate('document.querySelector("main").textContent'), '');
      assert.equal(await evaluate('document.body.innerText.includes("Recent Items") || document.body.innerText.includes("Connecting to Fabric")'), false);
      assert.equal(await evaluate('document.body.style.overflow'), 'hidden');
      assert.equal(await evaluate('document.querySelector(".startup-overlay").textContent'), 'Loading QuizCrowd...');
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".loading-spinner")).animationName'), 'none');
      assert.equal(await evaluate('(() => {const r=document.querySelector(".startup-overlay").getBoundingClientRect();return r.left===0&&r.top===0&&r.width===innerWidth&&r.height===innerHeight})()'), true);
      await evaluate('document.querySelector(".toolbar-actions button").focus()');
      assert.equal(await evaluate('document.activeElement.closest(".app-shell")===null'), true);
      await pointerClick(`document.querySelector('.toolbar-actions button[aria-label="${theme === 'light' ? 'Dark' : 'Light'}"]')`);
      assert.equal(await evaluate('document.documentElement.dataset.theme'), theme, 'overlay prevents pointer interaction');
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
      assert.equal(await evaluate('document.activeElement.closest(".app-shell")===null'), true, 'inert shell prevents keyboard entry');
      if (width === 1440) {
        await cdp.call('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'no-preference'}] }, session);
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".loading-spinner")).animationName'), 'spin');
        await cdp.call('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] }, session);
      }
      await screenshot(`${theme}-${width}-startup-overlay`);
      await evaluate('window.__quizcrowdFixture.release()');
      await until('document.querySelector(".startup-overlay")===null && !!document.querySelector(".home-signin")');
      assert.equal(await evaluate('document.querySelector(".app-shell").inert'), false);
      assert.equal(await evaluate('document.querySelector(".app-shell").getAttribute("aria-busy")'), 'false');
      assert.equal(await evaluate('document.body.style.overflow'), '');
      assert.equal(await evaluate('document.querySelector(".home-signin h2").textContent'), 'Recent Items');
    }
    await navigate('?startup=loading');
    await evaluate('window.__quizcrowdFixture.release("Fabric unavailable")');
    await until('!!document.querySelector("[role=alert]")');
    assert.equal(await evaluate('document.querySelector(".startup-overlay")===null && !document.querySelector(".app-shell").inert'), true);
    assert.equal(await evaluate('document.querySelector(".home-signin")===null && document.querySelector(".recent-sessions")===null'), true);
    assert.ok((await evaluate('document.querySelector("[role=alert]").textContent')).includes('Fabric unavailable'));
    await evaluate('window.__quizcrowdFixture.defer("connect")');
    await click('Retry connection');
    assert.equal(await evaluate('!!document.querySelector(".startup-overlay") && document.querySelector("[role=alert]")===null'), true);
    await evaluate('window.__quizcrowdFixture.release()');
    await until('!!document.querySelector(".session-card")');
    assert.equal(await evaluate('document.querySelector(".startup-overlay")===null'), true);
    await evaluate('window.__quizcrowdFixture.defer("list")');
    await click('Join with Code');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    await until('!!document.querySelector(".library-loading")');
    assert.equal(await evaluate('document.querySelector(".startup-overlay")===null && !document.querySelector(".app-shell").inert'), true);
    await evaluate('window.__quizcrowdFixture.release()');
    await until('!!document.querySelector(".session-card")');
  });
  await check('startup overlay: timeout recovers and ignores late connection completion', async () => {
    const {identifier} = await cdp.call('Page.addScriptToEvaluateOnNewDocument', {source: `
      const originalTimeout=window.setTimeout.bind(window);
      window.setTimeout=(callback,delay,...args)=>originalTimeout(callback,delay===30000?100:delay,...args);
    `}, session);
    try { await navigate('?startup=loading'); }
    finally { await cdp.call('Page.removeScriptToEvaluateOnNewDocument', {identifier}, session); }
    await until('!!document.querySelector("[role=alert]")');
    assert.ok((await evaluate('document.querySelector("[role=alert]").textContent')).includes('Fabric connection timed out'));
    await evaluate('window.__quizcrowdFixture.release()');
    await pause(100);
    assert.equal(await evaluate('document.querySelector(".recent-sessions")===null'), true, 'late completion cannot publish a timed-out connection');
    await click('Retry connection');
    await until('!!document.querySelector(".session-card")');
    assert.equal(await evaluate('document.querySelector("[role=alert]")===null'), true);
  });
  await check('optional invitation PIN: owner setting, QR fragment, manual entry and Entra context', async () => {
    await cdp.call('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
    await navigate('?fixture=admin');
    await click('Dark');
    await pointerClick('document.querySelector(".session-open")');
    await until('!!document.querySelector("#pin-required")');
    assert.equal(await evaluate('document.querySelector("#pin-required").checked'),false);
    await pointerClick('document.querySelector("#pin-required")');
    await submitAuthor();
    await until('!!document.querySelector(".host-lobby .invitation-pin")');
    assert.equal(await evaluate('document.querySelector(".invitation-pin strong").textContent'),'0007');
    assert.equal(await evaluate('new URL(document.querySelector(".join-link a").href).hash'),'#pin=0007');
    assert.equal(await evaluate('new URL(document.querySelector(".join-link a").href).searchParams.has("pin")'),false);
    await inspectScreen('pin-dark-desktop-host'); await screenshot('pin-dark-desktop-host');
    await pointerClick('document.querySelector(".join-link a")');
    await until('!!document.querySelector("#nickname")');
    assert.equal(await evaluate('document.querySelector("#invitation-pin")===null'),true,'QR supplies PIN without retyping');
    await input('#nickname','Morgan'); await click('Join Game');
    await until('!!document.querySelector(".attendee-lobby")');
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="join").pin'),'0007');
    assert.equal(await evaluate('document.querySelector(".invitation-pin")===null'),true,'attendee snapshot does not contain owner PIN');
    await cdp.call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false},session);
    await navigate('?gate=pin');
    await click('Light');
    await click('Join with Code'); await input('#session-code','000123'); await click('Next');
    await until('!!document.querySelector("#invitation-pin")');
    await input('#nickname','Morgan');
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Join Game").disabled'),true);
    await input('#invitation-pin','9999'); await click('Join Game');
    await until('!!document.querySelector("[role=alert]")');
    await input('#invitation-pin','0007'); await inspectScreen('pin-light-mobile-retry'); await screenshot('pin-light-mobile-retry');
    await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
    await navigate('join/?code=000123&gate=pin&fixture=signed-out&guests=on');
    await until('!!document.querySelector("#invitation-pin")');
    await input('#invitation-pin','0007'); await input('#nickname','Morgan');
    await click('Sign in to attend');
    await until('[...document.querySelectorAll("button")].some(e=>e.textContent==="Join Game"&&!e.disabled)');
    assert.equal(await evaluate('document.querySelector("#invitation-pin").value'),'0007','manual PIN survives normal Entra session transition');
    await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
  });
  await check('recent layouts: default, remembered, compact responsive rows, cards, actions and loading', async () => {
    await navigate('?example=showcase-home');
    await evaluate('localStorage.removeItem("quizcrowd-recent-layout")');
    await cdp.call('Page.reload', {}, session);
    await until('document.querySelectorAll(".session-list .session-card").length===3');
    for (const saved of ['invalid', 'list', 'cards']) {
      await evaluate(`localStorage.setItem("quizcrowd-recent-layout",${JSON.stringify(saved)})`);
      await cdp.call('Page.reload', {}, session);
      await until('document.querySelectorAll(".session-card").length===3');
      assert.equal(await evaluate('!!document.querySelector(".session-list")'),saved!=='cards');
    }
    await evaluate('document.querySelector(".recent-layout [aria-label=List]").focus()');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Cards');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-pressed")'),'true');
    for (const theme of ['light','dark']) {
      for (const width of [1440,390,320]) {
        await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:width===1440?1000:844,deviceScaleFactor:1,mobile:false},session);
        await click(theme==='light'?'Light':'Dark');
        for (const layout of ['List','Cards']) {
          await click(layout);
          assert.equal(await evaluate(`document.querySelector('.recent-layout button[aria-pressed="true"]').getAttribute("aria-label")`),layout);
          assert.deepEqual(await evaluate('[...document.querySelectorAll(".recent-layout button")].map(e=>({text:e.textContent,title:e.title,label:e.getAttribute("aria-label"),icon:e.querySelector("svg")?.getAttribute("aria-hidden"),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))'),
            ['List','Cards'].map(label=>({text:'',title:label,label,icon:'true',width:36,height:36})));
          assert.equal(await evaluate('!!document.querySelector(".session-list")'),layout==='List');
          assert.equal(await evaluate('document.activeElement===document.querySelector(".recent-layout button[aria-pressed=true]")'),true);
          if (width===1440 && layout==='List') assert.ok(await evaluate('document.querySelector(".session-card").getBoundingClientRect().height<=88'),'desktop list is compact');
          await inspectScreen(`recent-${layout.toLowerCase()}-${theme}-${width}`);
          await screenshot(`recent-${layout.toLowerCase()}-${theme}-${width}`);
          if (process.env.QUIZCROWD_UPDATE_SHOWCASE==='1' && theme==='light' && width===1440) {
            await copyFile(join(directory,`recent-${layout.toLowerCase()}-${theme}-${width}.png`),join('docs','images',layout==='List'?'home-desktop.png':'home-desktop-cards.png'));
          }
          assert.equal(await evaluate('document.querySelector("button button")===null'),true);
          await pointerClick('document.querySelector(".session-menu summary")');
          await until('!!document.querySelector(".session-menu[open]")');
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          assert.equal(await evaluate('document.activeElement===document.querySelector(".session-menu summary")'),true);
          assert.equal(await evaluate('!!document.querySelector(".session-menu[open]")'),false);
        }
      }
    }
    await click('List');
    await evaluate('document.querySelector(".session-title").textContent="A very long synthetic session title "+ "unbroken".repeat(35)');
    await inspectScreen('recent-list-long-title-320');
    await screenshot('recent-list-long-title-320');
    await cdp.call('Page.reload',{},session);
    await until('!!document.querySelector(".session-list .session-open")');
    await pointerClick('document.querySelector(".session-open")');
    await until('!!document.querySelector(".author")');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    await until('!!document.querySelector(".session-list")');
    await pointerClick('document.querySelector(".session-menu summary")'); await click('Duplicate');
    await until('!!document.querySelector(".author")');
    assert.ok((await evaluate('document.querySelector("#quiz-title").value')).startsWith('Copy - '));
    for (const layout of ['List','Cards']) {
      await navigate('?library=loading');
      await until('!!document.querySelector(".library-loading")');
      await click(layout);
      assert.equal(await evaluate('!!document.querySelector(".library-loading .session-list")'),layout==='List');
      await inspectScreen(`recent-${layout.toLowerCase()}-loading`);
      await screenshot(`recent-${layout.toLowerCase()}-loading`);
      await evaluate('window.__quizcrowdFixture.release("Synthetic load failure")');
      await until('document.body.innerText.includes("Recent items could not be loaded.")');
      assert.equal(await evaluate('!!document.querySelector(".empty-library")'),false);
    }
    await evaluate('localStorage.removeItem("quizcrowd-recent-layout")');
  });
  await check('polished showcase: home with colored actions and realistic recent items', async () => {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('?example=showcase-home');
    await click('Light');
    await until('document.querySelectorAll(".session-card").length===3');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".session-title")].map(e=>e.textContent)'), ['Friday Team Quiz','Team Pulse: Working Better','Fabric Fundamentals']);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".session-type")].map(e=>e.textContent)'), ['Live Quiz','Live Survey','Live Quiz']);
    assert.equal(await evaluate('[...document.querySelectorAll(".session-card .badge")].every(e=>e.textContent==="Not started")'), true);
    await inspectScreen('home-desktop');
    await screenshot('home-desktop');
    if (process.env.QUIZCROWD_UPDATE_SHOWCASE === '1') {
      await mkdir(join('docs', 'images'), { recursive: true });
      await copyFile(join(directory, 'home-desktop.png'), join('docs', 'images', 'home-desktop.png'));
    }
  });
  await check('polished showcase: realistic quiz and survey host and mobile attendee', async () => {
    async function capture(name) {
      await inspectScreen(name);
      await screenshot(name);
      if (process.env.QUIZCROWD_UPDATE_SHOWCASE === '1') {
        await mkdir(join('docs', 'images'), { recursive: true });
        await copyFile(join(directory, `${name}.png`), join('docs', 'images', `${name}.png`));
      }
    }
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('host/game/?gameId=11111111-2222-4333-8444-555555555555&example=showcase-quiz');
    await click('Dark'); await until('!!document.querySelector(".host-stage.stage-question")');
    assert.equal(await evaluate('document.querySelector(".answer-count").textContent'), '3 / 4 answered');
    await capture('quiz-desktop-host');
    await navigate('host/game/?gameId=11111111-2222-4333-8444-555555555555&example=showcase-quiz&stage=finished');
    await click('Dark'); await until('!!document.querySelector(".podium")');
    await capture('quiz-desktop-results');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('join/?code=600123&example=showcase-quiz');
    await click('Light'); await input('#nickname', 'Alex'); await click('Join Game');
    await until('!!document.querySelector(".attendee-stage.stage-question")');
    await capture('quiz-mobile-attendee');
    await navigate('join/?code=600123&example=showcase-survey');
    await click('Dark'); await input('#nickname', 'Alex'); await click('Join Game');
    await until('!!document.querySelector(".survey-response")');
    await pointerClick('document.querySelectorAll(".survey-choice input")[0]');
    await pointerClick('document.querySelectorAll(".survey-choice input")[4]');
    await input('.survey-written-response textarea', 'More time to share ideas across teams.');
    await capture('survey-mobile-attendee');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('host/game/?gameId=11111111-2222-4333-8444-555555555555&example=showcase-survey&stage=finished');
    await click('Light'); await until('document.querySelectorAll(".survey-result").length===2');
    await evaluate('document.querySelector(".written-choice summary").focus()');
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, session);
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
    await until('document.querySelector(".written-choice").open');
    await pointerClick('document.querySelector(".finished-screen h1")');
    assert.equal(await evaluate('document.querySelector(".written-choice").open'), true);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".survey-bars")[0].children].map(e=>e.dataset.selection)'), ['0','1','other']);
    await capture('survey-desktop-host-results');
  });

  await check('join back does not disable home while its list refresh is pending', async () => {
    await navigate('?fixture=admin');
    await click('Join with Code');
    assert.equal(await evaluate('document.querySelector(".page-heading h1").textContent'),'Join with Code');
    assert.equal(await evaluate('document.querySelector(\'label[for="session-code"]\').textContent'),'Session Code');
    await evaluate('window.__quizcrowdFixture.defer("list")');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    assert.equal(await evaluate('document.querySelector(".home-actions .quiz-action").disabled'), false);
    await evaluate('window.__quizcrowdFixture.release()');
  });
  await check('lobby fullscreen tip detects browser fullscreen and Fullscreen API', async () => {
    await navigate('host/lobby/?gameId=11111111-2222-4333-8444-555555555555&example=quiz-ten');
    await until('!!document.querySelector(".fullscreen-tip")');
    assert.equal(await evaluate('document.querySelector(".fullscreen-tip").textContent'),'Tip: Press F11 to make full screen');
    const {windowId,bounds}=await cdp.call('Browser.getWindowForTarget',{targetId:target.targetId});
    try {
      await cdp.call('Browser.setWindowBounds',{windowId,bounds:{windowState:'fullscreen'}});
      await until('matchMedia("(display-mode: fullscreen)").matches');
      assert.equal(await evaluate('document.fullscreenElement===null'),true);
      await until('document.querySelector(".fullscreen-tip")===null');
    } finally {
      await cdp.call('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
      await cdp.call('Browser.setWindowBounds',{windowId,bounds:{left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height}});
    }
    await until('!!document.querySelector(".fullscreen-tip")');
    const requested=await cdp.call('Runtime.evaluate',{expression:'document.documentElement.requestFullscreen()',userGesture:true,awaitPromise:true,returnByValue:true},session);
    assert.equal(requested.exceptionDetails,undefined);
    await until('!!document.fullscreenElement && document.querySelector(".fullscreen-tip")===null');
    await evaluate('document.exitFullscreen()');
    await until('!!document.querySelector(".fullscreen-tip")');
  });

  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
    for (const theme of ['dark', 'light']) {
      await navigate('?fixture=admin');
      await check(`${theme}-${size}: three home actions focus the destination first field once`, async () => {
        for(const [action,field,next] of [['New Live Quiz','#quiz-title','#question-0'],['New Live Survey','#quiz-title','#question-0'],['Join with Code','#session-code','#session-code']]){
          await navigate();await click(theme==='dark'?'Dark':'Light');await click(action);
          await until(`document.activeElement===document.querySelector(${JSON.stringify(field)})`);
          await input(field,action==='Join with Code'?'000123':'Focused title');
          await evaluate(`document.querySelector(${JSON.stringify(next)}).focus()`);
          await pause(1700);
          assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(next)})`),true);
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(field)}).value`),action==='Join with Code'?'000123':'Focused title');
        }
      });
      await check(`${theme}-${size}: recent items loading, loaded empty, error and stale refresh`, async () => {
        const label=`${theme}-${size}-recent-states`;
        await navigate('?library=loading');await click(theme==='dark'?'Dark':'Light');
        await until('!!document.querySelector(".library-loading")');
        assert.equal(await evaluate('document.querySelectorAll(".session-placeholder").length'),3);
        assert.equal(await evaluate('document.querySelector(".empty-library")===null'),true);
        assert.equal(await evaluate('document.querySelector(".recent-sessions").getAttribute("aria-busy")'),'true');
        assert.equal(await evaluate('document.querySelector(".library-loading > span").className'),'sr-only');
        assert.equal(await evaluate('document.querySelector(".library-loading").parentElement.className'),'recent-sessions');
        await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},session);
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".session-placeholder span")).animationName'),'skeleton-pulse');
        await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},session);
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".session-placeholder span")).animationName'),'none');
        const recentGap=await evaluate('document.querySelector(".recent-sessions").getBoundingClientRect().top-document.querySelector(".home-actions").getBoundingClientRect().bottom');
        assert.ok(Math.abs(recentGap-(size==='mobile'?40:48))<1,`recent top spacing ${recentGap}`);
        assert.ok(await evaluate('[...document.querySelectorAll(".home-action")].every(e=>{const i=e.querySelector("svg").getBoundingClientRect(),t=e.querySelector("span").getBoundingClientRect();return t.left-i.right>=16})'));
        await inspectScreen(`${label}-loading`);await screenshot(`${label}-loading`);
        await evaluate('window.__quizcrowdFixture.empty();window.__quizcrowdFixture.release()');
        await until('document.querySelector(".empty-library")?.textContent==="No recent items"');
        await inspectScreen(`${label}-empty`);await screenshot(`${label}-empty`);
        await cdp.call('Page.reload',{},session);await until('document.querySelector(".empty-library")?.textContent==="No recent items"');
        await navigate('?library=loading');await evaluate('window.__oldListRelease=window.__quizcrowdFixture.release');
        await click('Join with Code');
        await evaluate('window.__quizcrowdFixture.defer("list")');
        await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
        await until('!!document.querySelector(".library-loading")');
        await evaluate('window.__quizcrowdFixture.empty();window.__quizcrowdFixture.release()');
        await until('document.querySelector(".empty-library")?.textContent==="No recent items"');
        await evaluate('window.__oldListRelease("Stale list failure")');await pause(100);
        assert.equal(await evaluate('document.querySelector("[role=alert]")===null'),true);
        assert.equal(await evaluate('document.querySelector(".empty-library").textContent'),'No recent items');
        await navigate('?library=loading');await evaluate('window.__quizcrowdFixture.release("List unavailable")');
        await until('document.querySelector("[role=alert]")?.textContent.includes("List unavailable")');
        assert.equal(await evaluate('document.querySelector(".empty-library")===null'),true);
        assert.equal(await evaluate('document.querySelector(".library-loading")===null'),true);
        assert.ok(await evaluate('document.querySelector(".recent-sessions").textContent.includes("Recent items could not be loaded.")'));
        await inspectScreen(`${label}-error`);await screenshot(`${label}-error`);
      });
      await check(`${theme}-${size}: completed survey View Results uses existing persisted host route`, async () => {
        const id='11111111-2222-4333-8444-555555555555',label=`${theme}-${size}-completed-survey`;
        await navigate(`host/item/?gameId=${id}&example=survey-results`);await click(theme==='dark'?'Dark':'Light');
        await until('!!document.querySelector(".author-session-actions .secondary")');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .secondary").textContent'),'View Results');
        assert.equal(await evaluate('document.querySelector(".author button[type=submit]")===null'),true);
        const compact=await evaluate('[".author-session-actions .subtle",".author-session-actions .primary"].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {height:e.getBoundingClientRect().height,padding:c.padding,font:c.fontSize}})');
        assert.deepEqual(compact[0],compact[1]);
        await inspectScreen(`${label}-header`);await screenshot(`${label}-header`);
        await click('View Results');await until('!!document.querySelector(".finished-screen")');
        assert.equal(await evaluate('location.pathname+location.search'),`/host/game/?gameId=${id}`);
        assert.equal(await evaluate('document.querySelectorAll(".survey-result").length'),3);
        assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>["join","create","control","answer"].includes(r.command))'),false);
        assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'),null);
        await inspectScreen(`${label}-results`);await screenshot(`${label}-results`);
        await cdp.call('Page.reload',{},session);await until('document.querySelectorAll(".survey-result").length===3');
        await evaluate('history.back()');await until('!!document.querySelector(".author-session-actions .secondary")');
        await evaluate('history.forward()');await until('!!document.querySelector(".finished-screen")');
        assert.equal(await evaluate('document.body.textContent.includes("Private fixture text")'),false);
        await navigate(`host/item/?gameId=${id}&example=survey-results&owner=other`);
        await until('document.querySelector("[role=alert]")?.textContent.includes("ownership required")');
        assert.equal(await evaluate('document.querySelector(".author-session-actions")===null'),true);
        await navigate(`host/game/?gameId=${id}&example=survey-results&owner=other`);
        await until('document.querySelector("[role=alert]")?.textContent.includes("ownership required")');
        assert.equal(await evaluate('document.querySelector(".survey-result")===null'),true);
      });
      await check(`${theme}-${size}: host-only survey bar charts and accessible written details`, async () => {
        const id='11111111-2222-4333-8444-555555555555',label=`${theme}-${size}-survey-bars`;
        if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
        await navigate(`host/game/?gameId=${id}&example=survey-results`);await click(theme==='dark'?'Dark':'Light');
        await until('document.querySelectorAll(".survey-result").length===3');
        assert.deepEqual(await evaluate('[...document.querySelector(".survey-bars").children].map(e=>e.dataset.selection)'),['0','1','other']);
        assert.deepEqual(await evaluate('[...document.querySelector(".survey-bars").querySelectorAll(".survey-bar-label strong")].map(e=>e.textContent)'),['3 / 3 · 100%','2 / 3 · 66.7%','2 / 3 · 66.7%']);
        const colors=await evaluate('[document.querySelector(".survey-bar-track"),document.querySelector(".survey-bar-track > span")].map(e=>getComputedStyle(e).backgroundColor)');
        const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(channel=>{const c=Number(channel)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        const levels=colors.map(luminance);
        assert.ok((Math.max(...levels)+.05)/(Math.min(...levels)+.05)>=3,'chart fill contrasts with its track');
        assert.equal(await evaluate('document.querySelector(".remaining-choices summary").textContent'),'Remaining choices (2)');
        assert.deepEqual(await evaluate('[...document.querySelector(".remaining-choices .survey-bars").children].map(e=>e.dataset.selection)'),['3','2']);
        assert.equal(await evaluate('document.querySelector(".survey-results script,.survey-results img")===null&&window.__surveyUnsafe===undefined'),true);
        assert.equal(await evaluate('document.querySelectorAll(".survey-result:nth-child(2) .written-responses li").length'),20);
        const hover=await evaluate('(() => {const e=document.querySelector(".written-choice summary");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
        await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...hover},session);await until('document.querySelector(".written-choice").open');
        assert.ok(await evaluate('document.querySelector(".written-choice").textContent.includes("More networking time.")'));
        await inspectScreen(`${label}-other-hover`);await screenshot(`${label}-other-hover`,undefined,true);
        await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0},session);await until('!document.querySelector(".written-choice").open');
        await evaluate('document.querySelector(".written-choice summary").focus()');
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
        assert.equal(await evaluate('document.querySelector(".written-choice").open'),true);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
        assert.equal(await evaluate('document.querySelector(".written-choice").open'),false);
        assert.equal(await evaluate('document.activeElement===document.querySelector(".written-choice summary")'),true);
        if(size==='mobile'){
          const tap=await evaluate('(() => {const e=document.querySelector(".written-choice summary");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
          await cdp.call('Emulation.setTouchEmulationEnabled',{enabled:true},session);
          await cdp.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...tap,radiusX:2,radiusY:2}]},session);
          await cdp.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},session);await until('document.querySelector(".written-choice").open');
          await cdp.call('Emulation.setTouchEmulationEnabled',{enabled:false},session);
        }
        await evaluate('window.__quizcrowdFixture.defer("written")');await click('Load more written responses');
        await evaluate('window.__quizcrowdFixture.release("Synthetic written-response failure")');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Synthetic written-response failure")');
        assert.equal(await evaluate('document.querySelectorAll(".survey-result:nth-child(2) .written-responses li").length'),20);
        await click('Load more written responses');await until('document.querySelectorAll(".survey-result:nth-child(2) .written-responses li").length===23');
        assert.equal(await evaluate('document.querySelector("[role=alert]")===null'),true);
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="written")'),{command:'written',id,questionIndex:1,offset:20,hasToken:false,asGuest:false});
        assert.equal(await evaluate('document.querySelector(".survey-results script,.survey-results img")===null'),true);
        await inspectScreen(`${label}-all-written`);await screenshot(`${label}-all-written`);
        await evaluate(`sessionStorage.setItem("quizcrowd-attendee-credential",JSON.stringify({id:${JSON.stringify(id)},token:"test-only-attendee-credential",guest:false,nickname:"Alex"}));location.href="/play/?gameId=${id}";`);
        await until('!!document.querySelector(".attendee-stage .finished-screen")');
        assert.equal(await evaluate('document.querySelector(".survey-result,.survey-bars,.distribution,.rankings,.written-responses")===null'),true);
        assert.ok(await evaluate('document.querySelector(".finished-screen").textContent.includes("Thank you")'));
        assert.deepEqual(await evaluate('["surveyResults","distribution","otherCount","rankings"].filter(key=>key in window.__quizcrowdFixture.lastState)'),[]);
        assert.equal(await evaluate('JSON.stringify(window.__quizcrowdFixture.lastState).includes("Useful feedback")'),false);
        await inspectScreen(`${label}-attendee-complete`);await screenshot(`${label}-attendee-complete`);
        if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
      });
      await check(`${theme}-${size}: original tile brand at compact sizes`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light');
        const mark = await evaluate(`(() => {
          const svg=document.querySelector('.brand-mark');
          const sizes=[16,20,24,32].map(size=>{svg.style.width=size+'px';svg.style.height=size+'px';const r=svg.getBoundingClientRect();return [r.width,r.height];});
          svg.style.removeProperty('width');svg.style.removeProperty('height');
          return {sizes,viewBox:svg.getAttribute('viewBox'),hidden:svg.getAttribute('aria-hidden'),name:svg.closest('button').getAttribute('aria-label'),
            shapes:[...svg.children].map(e=>({tag:e.tagName,fill:getComputedStyle(e).fill})),secondary:getComputedStyle(svg.querySelector('.brand-secondary')).color,
            color:getComputedStyle(svg).color,wordmarkColor:getComputedStyle(document.querySelector('.brand-wordmark > span')).color,shrink:getComputedStyle(svg).flexShrink};
        })()`);
        assert.deepEqual(mark.sizes,[16,20,24,32].map(size=>[size,size]));
        assert.equal(mark.viewBox,'0 0 24 24');assert.equal(mark.hidden,'true');assert.equal(mark.name,'QuizCrowd home');
        assert.deepEqual(mark.shapes.map(e=>e.tag),['rect','circle','path','rect']);assert.equal(mark.color,mark.wordmarkColor);assert.equal(mark.shrink,'0');
        assert.deepEqual(mark.shapes.map(e=>e.fill),[mark.color,mark.color,mark.color,mark.secondary]);assert.notEqual(mark.secondary,mark.color);
        await inspectScreen(`${theme}-${size}-tile-brand`);await screenshot(`${theme}-${size}-brand-header`,'.app-toolbar');
        if(theme==='light'&&size==='desktop') {
          const svg=await evaluate(`(() => {const source=document.querySelector('.brand-mark'),copy=source.cloneNode(true);copy.querySelector('.brand-secondary').style.color=getComputedStyle(source.querySelector('.brand-secondary')).color;copy.removeAttribute('class');copy.removeAttribute('aria-hidden');copy.removeAttribute('focusable');copy.setAttribute('role','img');copy.setAttribute('aria-label','QuizCrowd square circle triangle square mark');copy.style.color=getComputedStyle(source).color;copy.setAttribute('width','128');copy.setAttribute('height','128');return new XMLSerializer().serializeToString(copy);})()`);
          await writeFile(join(directory,'quizcrowd-mark.svg'),svg);
          await screenshot('quizcrowd-mark','.brand-mark');
        }
      });
      await check(`${theme}-${size}: saved-content lobby header clean, dirty, reverted and failed save`, async () => {
        const label=`${theme}-${size}-lobby-header`,id='11111111-2222-4333-8444-555555555555';
        if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
        await navigate(`host/item/?gameId=${id}`);await click(theme==='dark'?'Dark':'Light');await until('!!document.querySelector("#quiz-title")');
        const title=await evaluate('document.querySelector("#quiz-title").value');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        assert.equal(await evaluate('document.querySelector(".author button[type=submit]")===null'),true);
        await inspectScreen(`${label}-clean`);await screenshot(`${label}-clean`);
        await click('Open Lobby');await until('!!document.querySelector(".host-lobby")');
        assert.equal(await evaluate('window.__quizcrowdFixture.requests.filter(r=>r.command==="edit"&&r.draft).length'),0);
        await evaluate('history.back()');await until('!!document.querySelector("#quiz-title")');
        await input('#quiz-title',`${title} revised`);
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Save & Open Lobby');
        assert.equal(await evaluate('document.querySelector(".author button[type=submit]").form.id'),'session-author-form');
        await input('#quiz-title',title);
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        await pointerClick('document.querySelector(\'input[name="late-join"][value="allow"]\')');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Save & Open Lobby');
        await pointerClick('document.querySelector(\'input[name="late-join"][value="deny"]\')');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        await input('#question-0','');
        await submitAuthor();
        assert.equal(await evaluate('document.querySelector("#question-0").validity.valueMissing'),true);
        assert.equal(await evaluate('window.__quizcrowdFixture.requests.filter(r=>r.command==="edit"&&r.draft).length'),0);
        await input('#question-0','Revised question');
        await inspectScreen(`${label}-dirty`);await screenshot(`${label}-dirty`);
        await evaluate('window.__quizcrowdFixture.defer("edit")');await submitAuthor();
        assert.equal(await evaluate('document.querySelector(".author-session-actions .primary").disabled'),true);
        await evaluate('window.__quizcrowdFixture.release("Synthetic save failure")');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Synthetic save failure")');
        assert.equal(await evaluate('document.querySelector("#question-0").value'),'Revised question');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Save & Open Lobby');
        assert.equal(await evaluate('location.pathname'),'/host/item/');
        await inspectScreen(`${label}-failed-save`);await screenshot(`${label}-failed-save`);
        await submitAuthor();await until('!!document.querySelector(".host-lobby")');
        await evaluate('history.back()');await until('!!document.querySelector("#quiz-title")');
        assert.equal(await evaluate('document.querySelector("#question-0").value'),'Revised question');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        await navigate(`host/item/?gameId=${id}&example=response-locked`);await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        assert.equal(await evaluate('document.querySelector(".author-content").disabled'),true);
        assert.equal(await evaluate('document.querySelector(".readonly-notice").textContent'),'Read-only: this session has started or has responses.');
        assert.equal(await evaluate('document.querySelectorAll(".readonly-notice").length'),1);
        assert.equal(await evaluate('document.querySelector(".readonly-notice").firstElementChild.tagName.toLowerCase()'),'svg');
        assert.equal(await evaluate('document.querySelector("#session-author-form").getAttribute("aria-describedby")'),'session-readonly-status');
        assert.deepEqual(await evaluate('(() => {const s=getComputedStyle(document.querySelector(".readonly-notice"));return [s.borderTopWidth,s.padding,s.backgroundColor];})()'),['0px','0px','rgba(0, 0, 0, 0)']);
        await inspectScreen(`${label}-response-locked`);await screenshot(`${label}-response-locked`);
        await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
      });
      await check(`${theme}-${size}: selected UX header authoring, timer, single lobby and survey summaries`, async () => {
        const label=`${theme}-${size}-selected-ux`, id='11111111-2222-4333-8444-555555555555';
        await navigate();await click(theme==='dark'?'Dark':'Light');await click('New Live Survey');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .primary").textContent'),'Create & Open Lobby');
        assert.equal(await evaluate('document.querySelector(".editor-actions").textContent'),'Add Question');
        await pointerClick('document.querySelector(\'input[value="custom"]\')');await click('Add Other to question 1');
        const controls=await evaluate(`(() => {
          const buttons=[document.querySelector('.remove-option'),document.querySelector('.other-option .remove-option')];
          return {buttons:buttons.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,icon:getComputedStyle(e.querySelector('svg')).width})),
            triggers:[...document.querySelectorAll('.question-popover-trigger')].map(e=>({border:getComputedStyle(e).borderWidth,background:getComputedStyle(e).backgroundColor}))};
        })()`);
        assert.deepEqual(controls.buttons,Array(2).fill({width:32,height:32,icon:'16px'}));
        for(const trigger of controls.triggers){assert.equal(trigger.border,'0px');assert.notEqual(trigger.background,'rgba(0, 0, 0, 0)');}
        for(let i=0;i<5;i++)await click('Add Question');
        await evaluate('window.scrollTo(0,800)');await pause(100);
        const save=await evaluate('(() => {const r=document.querySelector(".author-session-actions").getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right}})()');
        assert.ok(save.bottom<0&&save.right<=width,`${label}: header action must scroll away ${JSON.stringify(save)}`);
        if(size==='mobile')assert.equal(await evaluate('document.querySelector(".author-content").getBoundingClientRect().bottom<=document.querySelector(".settings-panel").getBoundingClientRect().top'),true);
        await evaluate('window.scrollTo(0,0)');await screenshot(`${label}-header-create`);
        await navigate(`host/lobby/?gameId=${id}&example=survey-ten`);await until('!!document.querySelector(".host-lobby")');
        assert.equal(await evaluate('document.querySelector(".qr-container svg").getAttribute("width")'),'160');
        assert.equal(await evaluate('document.querySelector(".qr-container title").textContent'),'Scan to join this survey');
        assert.equal(await evaluate('document.querySelector(".host-lobby h1").textContent'),'Ten-choice Survey demo');
        const lobby=await evaluate('(() => {const box=s=>document.querySelector(s).getBoundingClientRect();return {qr:box(".qr-container").bottom,code:box(".code-panel").top,width:box(".host-lobby").width,codeSize:parseFloat(getComputedStyle(document.querySelector(".session-code strong")).fontSize),separate:document.body.textContent.includes("Present lobby")}})()');
        assert.ok(lobby.qr<=lobby.code);assert.equal(lobby.separate,false);assert.ok(lobby.codeSize<=40);if(size==='desktop')assert.equal(lobby.width,600);
        assert.equal(await evaluate('document.querySelector(".host-lobby .primary").disabled'),false);
        await inspectScreen(`${label}-single-lobby`);await screenshot(`${label}-single-lobby`);
        await navigate('join/?code=600123&example=quiz-ten');await input('#nickname','Scroll attendee');await click('Join Game');await until('!!document.querySelector(".attendee-question")');
        assert.equal(await evaluate('document.querySelector(".answers").classList.contains("long-options")'),true);
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".answers")).gridTemplateColumns.split(" ").length'),1);
        if(size==='mobile'){
          await evaluate('window.scrollTo(0,250)');await pause(100);
          const timer=await evaluate('(() => {const e=document.querySelector(".timer"),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,position:getComputedStyle(e).position,visible:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+10))}})()');
          assert.equal(timer.position,'sticky');assert.ok(timer.top>=0&&timer.top<=1,JSON.stringify(timer));assert.equal(timer.visible,true);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".timer")).borderRadius'),'12px');
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".timer")).borderTopWidth'),'0px');
          await screenshot(`${label}-sticky-timer`,undefined,true);
        }
        await navigate('join/?code=000123&example=survey-single');await input('#nickname','Survey attendee');await click('Join Game');
        await until('!!document.querySelector(".survey-choice")');await pointerClick('document.querySelector(".survey-choice input")');await click('Submit response');
        await phase('reveal');assert.ok(await evaluate('document.querySelector(".reveal-screen").textContent.includes("Waiting for host...")'));
        assert.equal(await evaluate('document.querySelector(".distribution")===null'),true);
        await phase('leaderboard');await until('!!document.querySelector(".leaderboard")');
        assert.equal(await evaluate('document.querySelector(".leaderboard h1").textContent'),'Response received');
        assert.equal(await evaluate('document.querySelector(".survey-result")===null'),true);
        assert.equal(await evaluate('document.querySelector(".rankings")===null'),true);
        await inspectScreen(`${label}-survey-results`);await screenshot(`${label}-survey-results`);
        await navigate(`host/game/?gameId=${id}&example=survey-results`);await until('!!document.querySelector(".finished-screen")');
        assert.equal(await evaluate('document.querySelectorAll(".survey-result").length'),3);
        for(const text of ['Top 3 selections','Written responses · Owner only','No responses collected.'])assert.ok(await evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`));
        assert.equal(await evaluate('document.body.textContent.includes("Private fixture text")||!!document.querySelector(".podium")||!!document.querySelector(".rankings")'),false);
        await inspectScreen(`${label}-survey-summary`);await screenshot(`${label}-survey-summary`);
        await click('Back to Home');await until('!!document.querySelector(".home-screen")');
      });
      await check(`${theme}-${size}: settings gear geometry, sizing and admin presentation`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light'); await click('New Live Survey');
        const geometry = await evaluate(`(() => {
          return [...document.querySelectorAll('.settings-panel h2 svg')].map(svg=>{
            const path=svg.querySelector('path'), b=path.getBBox(); let mismatches=0;
            for(let x=.125;x<24;x+=.5)for(let y=.125;y<24;y+=.5) {
              if(path.isPointInStroke(new DOMPoint(x,y))!==path.isPointInStroke(new DOMPoint(24-y,x)))mismatches++;
            }
            const sizes=[16,20,24,32].map(size=>{
              svg.style.width=size+'px';svg.style.height=size+'px';
              const rect=svg.getBoundingClientRect(),s=getComputedStyle(svg);
              return {size,width:rect.width,height:rect.height,flexShrink:s.flexShrink,stroke:s.stroke,fill:s.fill};
            });
            svg.style.removeProperty('width');svg.style.removeProperty('height');
            return {path:path.getAttribute('d'),viewBox:svg.getAttribute('viewBox'),hidden:svg.getAttribute('aria-hidden'),strokeWidth:svg.getAttribute('stroke-width'),bounds:[b.x,b.y,b.width,b.height],mismatches,sizes};
          });
        })()`);
        assert.equal(geometry.length, 1);
        for (const icon of geometry) {
          assert.deepEqual(icon.bounds, [2, 2, 20, 20]);
          assert.equal(icon.mismatches, 0, 'gear outline must be quarter-turn symmetric');
          assert.equal(icon.viewBox, '0 0 24 24'); assert.equal(icon.hidden, 'true'); assert.equal(icon.strokeWidth, '2');
          for (const measurement of icon.sizes) {
            assert.equal(measurement.width, measurement.size); assert.equal(measurement.height, measurement.size);
            assert.equal(measurement.flexShrink, '0'); assert.equal(measurement.fill, 'none'); assert.notEqual(measurement.stroke, 'none');
          }
        }
        assert.equal(await evaluate('document.querySelector(".question-settings")===null'),true);
        for (const motion of ['no-preference', 'reduce']) {
          await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:motion}]}, session);
          await inspectScreen(`${theme}-${size}-settings-gear-${motion}`);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".settings-panel h2 svg")).animationName'), 'none');
        }
        await screenshot(`${theme}-${size}-settings-gear-editor`);
        await screenshot(`${theme}-${size}-survey-settings-copy`);
        await screenshot(`${theme}-${size}-settings-heading-detail`, '.settings-panel h2 svg');
        await navigate('admin/?fixture=admin'); await until('!!document.querySelector(".publisher-page")');
        await inspectScreen(`${theme}-${size}-settings-gear-admin`);
        await screenshot(`${theme}-${size}-settings-gear-admin`);
        assert.equal(await evaluate('document.querySelectorAll(".publisher-page input[type=checkbox]").length'), 1);
      });
      await check(`${theme}-${size}: question controls align right with an accessible Survey type picker`,async()=>{
        for(const mode of ['quiz','survey']) {
          await navigate();await click(theme==='dark'?'Dark':'Light');await click(mode==='quiz'?'New Live Quiz':'New Live Survey');
          assert.equal(await evaluate('document.querySelector("#shared-duration").value'),'15');
          assert.equal(await evaluate('document.querySelector(".question-heading .duration")===null'),true);
          await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
          const alignment=await evaluate(`(() => {const h=document.querySelector('.question-heading'),a=h.querySelector('.question-actions'),t=a.querySelector('.question-duration');return {right:Math.abs(h.getBoundingClientRect().right-a.getBoundingClientRect().right),timerRight:Math.abs(h.getBoundingClientRect().right-t.getBoundingClientRect().right),selects:h.querySelectorAll('.question-type').length};})()`);
          assert.ok(alignment.right<=1);
          assert.equal(alignment.selects,mode==='survey'?1:0);
          assert.equal(await evaluate('document.querySelector(".question-duration").textContent'),'15s');
          assert.equal(await evaluate('document.querySelector(".question-duration").firstElementChild.tagName.toLowerCase()'),'svg');
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-duration")).borderWidth'),'0px');
          await pointerClick('document.querySelector(".question-duration")');
          assert.equal(await evaluate('document.activeElement===document.querySelector(".question-duration-popup input")'),true);
          await inspectScreen(`${theme}-${size}-${mode}-duration-popup`);await screenshot(`${theme}-${size}-${mode}-duration-popup`);
          await pointerClick('document.querySelector("#question-0")');
          assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),true);
          await setQuestionDuration(37);
          if(mode==='quiz')assert.ok(alignment.timerRight<=1,'single-question Quiz timer must align to the right');
          else {
            assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-actions")).columnGap'),'16px');
            assert.equal(await evaluate('Math.abs(document.querySelector(".question-type").getBoundingClientRect().left-document.querySelector(".question-duration").getBoundingClientRect().right-16)<1'),true);
            assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-type")).borderWidth'),'0px');
            assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-type")).color'),await evaluate('getComputedStyle(document.querySelector(".question-heading h2")).color'));
            const {root}=await cdp.call('DOM.getDocument',{},session);
            const {nodeId}=await cdp.call('DOM.querySelector',{nodeId:root.nodeId,selector:'.question-type'},session);
            await cdp.call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']},session);
            assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-type")).color'),await evaluate('getComputedStyle(document.querySelector(".brand-wordmark > span")).color'));
            assert.equal(await evaluate('getComputedStyle(document.querySelector(".question-type svg")).stroke'),await evaluate('getComputedStyle(document.querySelector(".question-type")).color'));
            await cdp.call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]},session);
            assert.equal(await evaluate('document.querySelector(".question-type").lastElementChild.tagName.toLowerCase()'),'svg');
            assert.equal(await evaluate('document.querySelector(".question-type").firstElementChild.tagName.toLowerCase()'),'span');
            assert.equal(await evaluate('document.querySelector(".question-type path").getAttribute("d")'),'M19 9l-7 7-7-7');
            await evaluate('document.querySelector(".question-duration").focus()');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
            assert.equal(await evaluate('document.activeElement.classList.contains("question-type")'),true);
            assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Question 1 response type: Single Select');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-type-menu button")].map(e=>e.textContent)'),['Single Select','Multiple Select','Free Text']);
            assert.equal(await evaluate('document.activeElement.getAttribute("aria-checked")'),'true');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
            assert.equal(await evaluate('document.querySelector(".question-type").value'),'multiple');
            await pointerClick('document.querySelector(".question-type")');
            assert.equal(await evaluate('(() => {const r=document.querySelector(".question-type-menu").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),true);
            await inspectScreen(`${theme}-${size}-question-type-menu`);await screenshot(`${theme}-${size}-question-type-menu`);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
            assert.equal(await evaluate('document.activeElement.classList.contains("question-type")'),true);
            await pointerClick('document.querySelector(".question-type")');
            await pointerClick('document.querySelector("#question-0")');
            assert.equal(await evaluate('document.querySelector(".question-type-menu")===null'),true);
            await evaluate('document.querySelector(".question-type").focus()');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},session);
            await until('!!document.querySelector(".question-type-menu")');
            for(const [key,code,value] of [['End',35,'text'],['Home',36,'single']]){
              await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code},session);
              await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code},session);
              assert.equal(await evaluate('document.activeElement.value'),value);
            }
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
            assert.equal(await evaluate('document.querySelector(".question-type-menu")===null'),true);
            assert.equal(await evaluate('document.activeElement.matches(".question-duration")'),true);
            assert.ok(await evaluate('document.querySelector(".question-type").getBoundingClientRect().height>=32'));
          }
          await inspectScreen(`${theme}-${size}-${mode}-question-header`);await screenshot(`${theme}-${size}-${mode}-question-header`);
          await click('Add Question');
          if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
          const rows=await evaluate('[...document.querySelectorAll(".question-heading")].map(h=>{const a=h.querySelector(".question-actions").getBoundingClientRect(),r=h.getBoundingClientRect();return a.left>=r.left-1&&Math.abs(a.right-r.right)<=1})');
          assert.deepEqual(rows,[true,true]);
          if(size==='desktop'&&mode==='quiz')assert.equal(await evaluate('[...document.querySelectorAll(".question-option-footer")].every(e=>{const h=e.querySelector(".option-hint").getBoundingClientRect(),a=e.querySelector(".option-actions").getBoundingClientRect();return Math.abs((h.top+h.bottom-a.top-a.bottom)/2)<4&&h.right<=a.left})'),true);
          assert.equal(await evaluate('[...document.querySelectorAll(".reorder button")].every(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.borderRadius==="0px"&&s.padding==="0px"&&r.width>=32&&r.height>=24})'),true);
          assert.equal(await evaluate('Math.abs(document.querySelector(".reorder button:first-child svg").getBoundingClientRect().bottom-document.querySelector(".reorder button:last-child svg").getBoundingClientRect().top)<1'),true);
          assert.equal(await evaluate('[...document.querySelectorAll(".option-actions")].every(e=>Math.abs(e.getBoundingClientRect().right-e.lastElementChild.getBoundingClientRect().right)<=1)'),true);
          await inspectScreen(`${theme}-${size}-${mode}-question-header-two`);
          if(size==='mobile') {
            await pointerClick('document.querySelector(".question-duration")');
            assert.equal(await evaluate('(() => {const r=document.querySelector(".question-duration-popup").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),true);
            await inspectScreen(`${theme}-320-${mode}-duration-popup`);await screenshot(`${theme}-320-${mode}-duration-popup`);
            if(mode==='survey'){
              await pointerClick('document.querySelector(".question-type")');
              assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),true);
              await pointerClick('document.querySelector(".question-duration")');
              assert.equal(await evaluate('document.querySelector(".question-type-menu")===null'),true);
            }
            await screenshot(`${theme}-320-${mode}-question-header`);
            await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
          }
        }
      });
      await check(`${theme}-${size}: duration popover keyboard, validation and persisted copies`,async()=>{
        for(const mode of ['quiz','survey']){
          await navigate();await click(theme==='dark'?'Dark':'Light');await click(mode==='quiz'?'New Live Quiz':'New Live Survey');
          await input('#quiz-title',`Timed ${mode}`);await input('#question-0','A timed question');
          for(let index=0;index<4;index++)await input(`#option-0-${index}`,`Option ${index+1}`);
          if(mode==='quiz')await pointerClick('document.querySelector(\'[aria-label="Question 1, correct option 1"]\')');
          await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
          await evaluate('document.querySelector(".question-duration").focus()');
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
          assert.equal(await evaluate('document.activeElement===document.querySelector(".question-duration-popup input")'),true);
          await input('.question-duration-popup input','4');
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),true);
          await submitAuthor();
          assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),false);
          assert.equal(await evaluate('document.activeElement===document.querySelector(".question-duration-popup input")'),true);
          assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="create")'),false);
          await input('.question-duration-popup input','121');
          assert.equal(await evaluate('document.querySelector(".question-duration-popup input").validity.rangeOverflow'),true);
          await input('.question-duration-popup input','20.5');
          assert.equal(await evaluate('document.querySelector(".question-duration-popup input").validity.stepMismatch'),true);
          await input('.question-duration-popup input','45');
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},session);
          assert.equal(await evaluate('document.activeElement===document.querySelector(".question-duration-popup input")'),true);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
          assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),true);
          assert.equal(await evaluate(`document.activeElement.matches('${mode==='quiz'?'#question-0':'.question-type'}')`),true);
          await submitAuthor();await until('!!document.querySelector(".host-lobby")');
          const created=await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft');
          assert.deepEqual(created.answerDuration,{mode:'custom',seconds:15});assert.equal(created.questions[0].duration,45);
          await pointerClick('document.querySelector(".small-brand")');await until('!!document.querySelector(".session-open")');
          await pointerClick('document.querySelector(".session-open")');await until('!!document.querySelector(".author")');
          await cdp.call('Page.reload',{},session);await until('!!document.querySelector(".question-duration")');
          assert.equal(await evaluate('document.querySelector(".question-duration").textContent'),'45s');
          await pointerClick('document.querySelector(".small-brand")');await until('!!document.querySelector(".session-menu")');
          await pointerClick('document.querySelector(".session-menu summary")');await click('Duplicate');
          await until('!!document.querySelector(".author-content:not(:disabled)")');
          assert.equal(await evaluate('document.querySelector(".question-duration").textContent'),'45s');
          assert.equal(await evaluate('document.querySelector("#quiz-title").value'),`Copy - Timed ${mode}`);
          await click('Open Lobby');await until('!!document.querySelector(".host-lobby")');
          await evaluate('window.__quizcrowdFixture.phase("question")');
          await pointerClick('document.querySelector(".small-brand")');await until('!!document.querySelector(".session-open")');
          await pointerClick('document.querySelector(".session-open")');await until('!!document.querySelector(".readonly-notice")');
          assert.equal(await evaluate('document.querySelector(".question-duration").matches(":disabled")'),true);
          assert.equal(await evaluate('document.querySelector(".question-duration-popup").hidden'),true);
          await inspectScreen(`${theme}-${size}-${mode}-duration-readonly`);await screenshot(`${theme}-${size}-${mode}-duration-readonly`);
        }
      });
      await check(`${theme}-${size}: About dialog links, focus trap, dismissal and routing`,async()=>{
        await navigate();await click(theme==='dark'?'Dark':'Light');
        const url=await evaluate('location.href');
        await click('About');await until('!!document.querySelector("dialog[open]")');
        assert.equal(await evaluate('location.href'),url);
        assert.equal(await evaluate('document.querySelector("dialog h2").textContent'),'About QuizCrowd');
        assert.equal(await evaluate('document.querySelector("dialog").matches(":modal")'),true);
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Close dialog');
        assert.deepEqual(await evaluate('[...document.querySelectorAll("dialog a")].map(e=>({href:e.href,target:e.target,rel:e.rel}))'),[
          {href:'https://www.linkedin.com/in/mustafaasiroglu',target:'_blank',rel:'noopener noreferrer'},
          {href:'https://github.com/mustafaasiroglu/quizcrowd-fabric',target:'_blank',rel:'noopener noreferrer'},
          {href:'https://github.com/mustafaasiroglu/quizcrowd-fabric/issues/new',target:'_blank',rel:'noopener noreferrer'},
        ]);
        assert.equal(await evaluate('document.querySelector("dialog").textContent.includes("source code is available")'),true);
        assert.equal(await evaluate('document.querySelector("dialog").textContent.includes("fully open source")'),false);
        await evaluate('document.querySelectorAll("dialog a")[2].focus()');
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Close dialog');
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
        assert.equal(await evaluate('document.activeElement.href'),'https://github.com/mustafaasiroglu/quizcrowd-fabric/issues/new');
        await inspectScreen(`${theme}-${size}-about`);await screenshot(`${theme}-${size}-about`);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
        assert.equal(await evaluate('document.querySelector("dialog")===null'),true);
        assert.equal(await evaluate('document.activeElement.classList.contains("footer-about")'),true);
        await screenshot(`${theme}-${size}-footer`,'footer');
        await click('About');await until('!!document.querySelector("dialog[open]")');await click('Close dialog');
        assert.equal(await evaluate('document.activeElement.classList.contains("footer-about")'),true);
        await click('About');await until('!!document.querySelector("dialog[open]")');
        await pointerClick('document.querySelector(".quiz-action")');
        assert.equal(await evaluate('document.querySelector("dialog")===null'),true);
        assert.equal(await evaluate('location.href'),url);
      });
      await check(`${theme}-${size}: owner read-only attendee navigation and closed-session guards`, async () => {
        const id='11111111-2222-4333-8444-555555555555';
        for (const mode of ['quiz','survey']) {
          const label=`${theme}-${size}-owner-${mode}`;
          if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
          await navigate(`host/item/?gameId=${id}&example=${mode}-ten`);
          await click(theme==='dark'?'Dark':'Light');await until('!!document.querySelector(".readonly-notice")');
          assert.equal(await evaluate('document.querySelector(".page-heading h1").textContent'),`View Live ${mode==='quiz'?'Quiz':'Survey'}`);
          assert.equal(await evaluate('document.querySelector(".author-session-actions .subtle").disabled'),false);
          assert.equal(await evaluate('document.querySelector(".author-session-actions .primary").disabled'),false);
          assert.equal(await evaluate('document.querySelector(".author-content").disabled'),true);
          assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>["join","control","answer"].includes(r.command))'),false);
          await inspectScreen(label);await screenshot(label);
          await evaluate('document.querySelector(".author-session-actions .subtle").focus()');
          await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},session);
          await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
          await until('!!document.querySelector("#nickname")');
          assert.equal(await evaluate('location.pathname+location.search'),'/join/?code=600123');
          assert.equal(await evaluate('document.querySelector(".join-code strong").textContent'),'600123');
          assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>["join","control"].includes(r.command))'),false);
          assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'),null);
          await inspectScreen(`${label}-join`);await screenshot(`${label}-join`);
          await evaluate('history.back()');await until('!!document.querySelector(".readonly-notice")');
          await evaluate('history.forward()');await until('!!document.querySelector("#nickname")');
          await input('#nickname','Owner attendee');await click('Join Game');await until('!!document.querySelector(".attendee-stage")');
          assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="join")'),
            {command:'join',id:'600123',nickname:'Owner attendee',hasToken:false,asGuest:false});
          assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="control")'),false);
          assert.equal(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="state").hasToken'),true);
          assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("quizcrowd-attendee-credential")).token'),'test-only-attendee-credential');
          await inspectScreen(`${label}-attendee`);await screenshot(`${label}-attendee`);
        }
        await navigate();await click(theme==='dark'?'Dark':'Light');
        await evaluate('window.__quizcrowdFixture.phase("question")');await pointerClick('document.querySelector(".session-open")');
        await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .subtle").disabled'),true);
        assert.equal(await evaluate('document.querySelector("#attendee-join-reason").textContent'),'This session does not allow late joins.');
        assert.equal(await evaluate('document.querySelector("#attendee-join-reason").className'),'sr-only');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .subtle").getAttribute("aria-describedby")'),'attendee-join-reason');
        await inspectScreen(`${theme}-${size}-owner-late-join-disabled`);await screenshot(`${theme}-${size}-owner-late-join-disabled`);
        await evaluate('window.__quizcrowdFixture.phase("finished")');await pointerClick('document.querySelector(".small-brand")');
        await until('!!document.querySelector(".session-open")');await pointerClick('document.querySelector(".session-open")');
        await until('!!document.querySelector("#attendee-join-reason")');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .subtle").disabled'),true);
        assert.equal(await evaluate('document.querySelector("#attendee-join-reason").textContent'),'This session has finished.');
        assert.equal(await evaluate('document.querySelector("#attendee-join-reason").className'),'sr-only');
        assert.equal(await evaluate('document.querySelector(".author-session-actions .primary").disabled'),false);
        await inspectScreen(`${theme}-${size}-owner-finished`);await screenshot(`${theme}-${size}-owner-finished`);
        await navigate(`host/item/?gameId=${id}&example=quiz-ten`);await until('!!document.querySelector(".readonly-notice")');
        await click('Attend');await until('!!document.querySelector("#nickname")');
        await evaluate('window.__quizcrowdFixture.phase("finished")');await input('#nickname','Late arrival');await click('Join Game');
        await until('document.querySelector("[role=alert]")?.textContent.includes("not accepting new attendees")');
        assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'),null);
        await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
      });
      await check(`${theme}-${size}: ten-option authoring, lobby and attendee results`,async()=>{
        for(const mode of ['quiz','survey']) {
          const label=`${theme}-${size}-ten-${mode}`;
          if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
          await navigate();await click(theme==='dark'?'Dark':'Light');await click(mode==='quiz'?'New Live Quiz':'New Live Survey');
          await input('#quiz-title',`Ten-choice ${mode}`);await input('#question-0','Choose a topic from ten options');
          if(mode==='survey')await chooseSurveyType('multiple');
          for(let index=0;index<10;index++) {
            if(index>=4)await click('Add option');
            await input(`#option-0-${index}`,`Choice ${index+1}${index===9?' | \\\\ '+ 'long-text-'.repeat(20):''}`);
          }
          assert.equal(await evaluate('document.querySelectorAll(".option-editor input:not([type=radio])").length'),10);
          assert.equal(await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="10 options maximum").disabled'),true);
          await inspectScreen(`${label}-long-option-editor`);
          await click('Remove question 1 option 10');await click('Add option');await input('#option-0-9','Choice 10 | \\ literal');
          if(mode==='quiz')await pointerClick('document.querySelector(\'[aria-label="Question 1, correct option 10"]\')');
          else await click('Add Other to question 1');
          await assertFilledForeground('.author-session-actions .primary');
          await inspectScreen(`${label}-editor`);await screenshot(`${label}-editor`);
          await submitAuthor();await until('!!document.querySelector(".host-lobby")');
          const saved=await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft.questions[0]');
          assert.equal(saved.options.length,10);assert.equal(saved.correctIndex,mode==='quiz'?9:null);
          assert.equal(await evaluate('document.querySelector(".host-lobby h1").textContent'),`Ten-choice ${mode}`);
          assert.equal(await evaluate('document.querySelector(".host-lobby .game-context")===null'),true);
          assertJoinChecksum(await evaluate('document.querySelector(".session-code strong").textContent'));
          assert.ok(await evaluate('document.querySelector(".host-lobby").textContent.includes("Scan QR code or visit link to join...")'));
          assert.ok(await evaluate('document.querySelector(".host-lobby").textContent.includes("4 attendees joined")'));
          await assertFilledForeground('.host-lobby .primary');
          await inspectScreen(`${label}-lobby`);await screenshot(`${label}-lobby`);
          await click(mode==='quiz'?'Start Quiz':'Start Survey');await until('!!document.querySelector(".host-stage.stage-question")');
          await assertSmoothTimer(`${label}-host`);
          assert.equal(await evaluate('document.querySelectorAll(".answers .answer:not(.other-choice)").length'),10);
          assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".answer-9")).backgroundColor'),'rgba(0, 0, 0, 0)');
          await assertAnswerForeground(`${label}-host`);
          await inspectScreen(`${label}-host`);await screenshot(`${label}-host`);
          await navigate(`join/?code=600123&example=${mode}-ten`);
          await input('#nickname','Ten-choice attendee');await click('Join Game');await until('!!document.querySelector(".attendee-stage.stage-question")');
          await assertSmoothTimer(`${label}-attendee`);
          if(mode==='quiz') {
            assert.equal(await evaluate('document.querySelectorAll("button.answer").length'),10);
            await assertAnswerForeground(`${label}-attendee`);
            await evaluate('document.querySelector(".answer-9").focus()');
            await inspectScreen(`${label}-attendee`);await screenshot(`${label}-attendee`);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},session);
          } else {
            assert.equal(await evaluate('document.querySelectorAll(".survey-choice input[type=checkbox]").length'),11);
            for(const index of [0,9,10])await pointerClick(`document.querySelectorAll(".survey-choice input")[${index}]`);
            await input('.survey-written-response textarea','Text | with \\ literal');
            await assertAnswerForeground(`${label}-attendee-selected`);
            await inspectScreen(`${label}-attendee`);await screenshot(`${label}-attendee`);
            await click('Submit response');
          }
          await until('!!document.querySelector(".submitted")');
          const submitted=await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer")');
          if(mode==='quiz')assert.equal(submitted.option,9);
          else assert.deepEqual(submitted.response,{options:[0,9],other:'Text | with \\ literal'});
          await phase('reveal');
          assert.equal(await evaluate('document.querySelectorAll(".distribution li").length'),mode==='quiz'?10:0);
          await inspectScreen(`${label}-results`);await screenshot(`${label}-results`);
        }
        if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
      });
      await check(`${theme}-${size}: settings layout, inline duration and visible choices`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light'); await click('New Live Quiz');
        const layout = await evaluate(`(() => {
          const content=document.querySelector('.author-content'),panel=document.querySelector('.settings-panel'),a=content.getBoundingClientRect(),b=panel.getBoundingClientRect();
          const label=document.querySelector('.shared-duration-choice > label').getBoundingClientRect(),input=document.querySelector('#shared-duration').getBoundingClientRect();
          return {domFirst:!!(content.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING),contentBottom:a.bottom,contentTop:a.top,settingsTop:b.top,submitBottom:document.querySelector('.author-session-actions').getBoundingClientRect().bottom,inline:Math.abs(label.top+label.height/2-input.top-input.height/2),inputWidth:input.width,
            groups:[...panel.querySelectorAll('.settings-group')].map(e=>{const s=getComputedStyle(e);return {border:s.borderTopWidth,color:s.borderTopColor,padding:parseFloat(s.paddingTop)}})};
        })()`);
        assert.equal(layout.domFirst, true);
        if (size === 'mobile') assert.ok(layout.settingsTop >= layout.contentBottom, 'questions must appear before settings in narrow layouts');
        else assert.ok(Math.abs(layout.settingsTop-layout.contentTop)<=1,'desktop settings align with content');
        assert.ok(layout.submitBottom<layout.contentTop,'single header action appears above form');
        assert.ok(layout.inline <= 1); assert.equal(layout.inputWidth, 48);
        assert.equal(await evaluate(`(() => {const input=document.querySelector('#shared-duration'),control=input.closest('.duration'),clock=control.querySelector('svg'),unit=control.lastElementChild,r=control.getBoundingClientRect();return clock!==null&&unit.textContent==='s'&&unit.getBoundingClientRect().right<r.right&&getComputedStyle(control).borderTopWidth==='1px';})()`),true);
        assert.equal(layout.groups.length, 5);
        for (const group of layout.groups.slice(1)) {
          assert.equal(group.border, '1px'); assert.match(group.color, /rgba\(/); assert.ok(group.padding <= 16);
        }
        assert.equal(await evaluate('document.querySelector(".duration-settings legend").textContent'), 'Answer duration');
        assert.equal(await evaluate('document.querySelector(".duration-settings legend svg")===null'), true);
        assert.equal(await evaluate('document.querySelector(".shared-duration-choice > label").textContent'), 'Same for all questions');
        assert.equal(await evaluate('document.querySelectorAll(".settings-panel select").length'), 0);
        assert.equal(await evaluate('document.body.textContent.includes("Public attendance is disabled by the publisher.")'), false);
        assert.equal(await evaluate('document.querySelector(\'input[value="public"]\').labels[0].querySelector("span").firstChild.textContent'), 'Anyone with link (disabled by admin)');
        await evaluate('document.querySelector(".editor-actions button").focus()');
        await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}, session);
        await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}, session);
        assert.equal(await evaluate('document.querySelector(".settings-panel").contains(document.activeElement)'), true);
        await input('#shared-duration', '35');
        await evaluate('document.querySelector(\'input[name="late-join"][value="deny"]\').focus()');
        for (const [key, code] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38]]) {
          await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,windowsVirtualKeyCode:code}, session);
          await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key,code:key,windowsVirtualKeyCode:code}, session);
        }
        assert.equal(await evaluate('document.querySelector(\'input[name="late-join"]:checked\').value'), 'allow');
        await evaluate('document.querySelector(\'input[name="answer-reveal"][value="wait_all"]\').focus()');
        for (const [key, code] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38]]) {
          await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,windowsVirtualKeyCode:code}, session);
          await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key,code:key,windowsVirtualKeyCode:code}, session);
        }
        assert.equal(await evaluate('document.querySelector(\'input[name="answer-reveal"]:checked\').value'), 'after_response');
        await click('Remove question 1 option 1');
        await inspectScreen(`${theme}-${size}-quiz-settings-copy`); await screenshot(`${theme}-${size}-quiz-settings-copy`);
        await click('Add option');
        await inspectScreen(`${theme}-${size}-settings-layout`); await screenshot(`${theme}-${size}-settings-layout`);
        if (size === 'mobile' && theme === 'light') {
          await cdp.call('Emulation.setDeviceMetricsOverride', {width:320,height:740,deviceScaleFactor:1,mobile:false}, session);
          await inspectScreen('light-320-settings-layout'); await screenshot('light-320-settings-layout');
          await cdp.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}, session);
        }
        await input('#quiz-title', 'Settings review'); await input('#question-0', 'Which choice?');
        for (const [i, option] of ['First', 'Second', 'Third', 'Fourth'].entries()) await input(`#option-0-${i}`, option);
        await pointerClick('document.querySelector(\'[aria-label="Question 1, correct option 1"]\')');
        await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft');
        assert.deepEqual(saved.answerDuration, {mode:'same',seconds:35});
        assert.equal(saved.lateJoin, true); assert.equal(saved.showAnswer, 'after_response');
        await click('Start Quiz'); await until('!!document.querySelector(".host-stage.stage-question")');
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector("#shared-duration").value'), '35');
        assert.equal(await evaluate('[...document.querySelectorAll(".settings-panel input")].every(e=>e.matches(":disabled"))'), true);
        assert.equal(await evaluate('document.querySelector(\'input[name="late-join"]:checked\').value'), 'allow');
        assert.equal(await evaluate('document.querySelector(\'input[name="answer-reveal"]:checked\').value'), 'after_response');
      });
      await navigate('?fixture=admin');
      await click(theme === 'dark' ? 'Dark' : 'Light');
      const label = `${theme}-${size}`;
      await check(`${label}: home layout, theme and accessibility`, async () => {
        assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions button")].map(e=>e.getAttribute("aria-label"))'), ['New Live Quiz','New Live Survey','Join with Code']);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions .action-description")].map(e=>e.textContent)'), ['Multiple choice quiz with real-time leaderboard.','Collect live feedback without scoring.','Enter a quiz or survey with invitation code.']);
        const actions = await evaluate(`(() => {
          const parent=document.querySelector(".home-actions");
          return {width:parent.clientWidth,buttons:[...parent.children].map(e=>{
            const s=getComputedStyle(e);
            return {width:e.offsetWidth,height:e.offsetHeight,top:e.offsetTop,left:e.offsetLeft,border:s.borderWidth,style:s.borderStyle,radius:s.borderRadius,padding:s.padding};
          })};
        })()`);
        for (const action of actions.buttons) {
          assert.ok(action.height >= 96 && action.height <= 108, `${label}: readable action height ${JSON.stringify(actions)}`);
          assert.equal(action.border, '1px');
          assert.equal(action.style, 'solid');
          assert.equal(action.radius, '12px');
          assert.equal(action.padding, '16px 20px');
        }
        assert.equal(new Set(actions.buttons.map(e=>e.width)).size, 1, `${label}: all three action widths match`);
        assert.equal(new Set(actions.buttons.map(e=>e.height)).size, 1, `${label}: all three action heights match`);
        if (size === 'desktop') {
          assert.deepEqual(actions.buttons.map(e=>e.width), [280,280,280]);
          assert.equal(new Set(actions.buttons.map(e=>e.top)).size, 1, 'desktop actions align in one row');
          assert.ok(actions.buttons.reduce((sum,e)=>sum+e.width,24) < actions.width * .85, 'desktop actions do not stretch across the row');
        }
        assert.equal(await evaluate('document.body.textContent.includes("Publisher bootstrap identity")'), false);
        assert.equal(await evaluate('document.body.textContent.includes("Your Quizzes")'), false);
        assert.equal(await evaluate('document.querySelector(".session-cover") === null'), true);
        assert.equal(await evaluate('document.querySelector("#recent-heading").textContent'), 'Recent Items');
        assert.equal(await evaluate('document.querySelector(".recent-heading p").textContent'), 'Your recent quiz and surveys.');
        assert.equal(await evaluate('document.querySelector(".session-open-hint")===null'), true);
        assert.equal(await evaluate('document.querySelector("header").textContent.includes("Publisher controls")'), false);
        assert.equal(await evaluate('document.querySelector(".session-card").getBoundingClientRect().height < 300'), true);
        assert.equal(await evaluate('document.querySelector(".session-metrics").textContent'), '2 Questions0 Responses');
        assert.equal(await evaluate('document.querySelector(".session-metrics").textContent.includes("participants")'), false);
        assert.equal(await evaluate('document.querySelector(".session-date time").dateTime'), '2026-11-09T09:00:00.000Z');
        assert.equal(await evaluate('document.querySelectorAll(".home-actions button > svg").length'), 3);
        const neutrals=await evaluate('[...document.querySelectorAll(".home-action")].map(e=>({background:getComputedStyle(e).backgroundColor,gradient:getComputedStyle(e).backgroundImage,border:getComputedStyle(e).borderColor,description:getComputedStyle(e.querySelector(".action-description")).color,title:getComputedStyle(e.querySelector("strong")).color,icon:getComputedStyle(e.querySelector("svg")).color}))');
        assert.equal(new Set(neutrals.map(e=>e.border)).size,3);
        for (const entry of neutrals) assert.equal(entry.border,entry.icon);
        assert.equal(new Set(neutrals.map(e=>e.description)).size,1);
        for(const entry of neutrals){assert.notEqual(entry.icon,entry.title);assert.notEqual(entry.description,entry.title);assert.equal(entry.title,await evaluate('getComputedStyle(document.body).color'));assert.equal(entry.background,theme==='light'?'rgb(255, 255, 255)':'rgb(34, 34, 60)');assert.ok(entry.gradient.startsWith('linear-gradient(135deg, rgba(0, 0, 0, 0) 60%'));assert.ok(entry.gradient.includes(theme==='light'?'0.05':'0.08'));}
        const cornerContrast=await evaluate(`(() => {
          const rgb=s=>s.match(/[\\d.]+/g).map(Number);
          const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          return [...document.querySelectorAll('.home-action')].flatMap(button=>{
            const s=getComputedStyle(button),base=rgb(s.backgroundColor),tint=rgb([...s.backgroundImage.matchAll(/rgba?\\(([^)]+)\\)/g)].at(-1)[0]),corner=base.map((v,i)=>v*(1-tint[3])+tint[i]*tint[3]);
            return ['strong','.action-description'].map(selector=>{const foreground=luminance(rgb(getComputedStyle(button.querySelector(selector)).color)),background=luminance(corner);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)});
          });
        })()`);
        assert.ok(cornerContrast.every(ratio=>ratio>=4.5),'neutral text remains readable at the strongest gradient corner');
        await inspectScreen(`${label}-home`);
        const { root } = await cdp.call('DOM.getDocument', {}, session);
        const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: root.nodeId, selector: '.home-actions .quiz-action' }, session);
        for (const forcedPseudoClasses of [[], ['hover'], ['focus'], ['active']]) {
          await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }, session);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-actions .quiz-action")).color'), await evaluate('getComputedStyle(document.body).color'));
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-actions .quiz-action strong")).color'), await evaluate('getComputedStyle(document.body).color'));
        }
        await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session);
        const actionNodes = [];
        for (let i=1;i<=3;i++) {
          const {nodeId:actionId} = await cdp.call('DOM.querySelector', {nodeId:root.nodeId,selector:`.home-actions > button:nth-child(${i})`}, session);
          actionNodes.push(actionId);
        }
        await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]}, session);
        for (const actionId of actionNodes) await cdp.call('CSS.forcePseudoState', {nodeId:actionId,forcedPseudoClasses:['hover']}, session);
        await until('[...document.querySelectorAll(".home-actions > button")].every(e=>getComputedStyle(e).transform==="matrix(1.01, 0, 0, 1.01, 0, 0)")');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions > button")].map(e=>getComputedStyle(e).transform)'), Array(3).fill('matrix(1.01, 0, 0, 1.01, 0, 0)'));
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions > button")].map(e=>({width:e.offsetWidth,height:e.offsetHeight,top:e.offsetTop,left:e.offsetLeft}))'), actions.buttons.map(({width,height,top,left})=>({width,height,top,left})), 'hover does not shift layout');
        await inspectScreen(`${label}-home-hover`);
        await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]}, session);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions > button")].map(e=>getComputedStyle(e).transform)'), Array(3).fill('none'));
        for (const actionId of actionNodes) await cdp.call('CSS.forcePseudoState', {nodeId:actionId,forcedPseudoClasses:[]}, session);
        await screenshot(`${label}-home`);
      });
      await check(`${label}: avatar account menu, keyboard and outside dismissal`, async () => {
        assert.equal(await evaluate('document.querySelector(".toolbar-actions").textContent.includes("Sign out")'), false);
        await click('Account menu');
        await until('document.activeElement?.getAttribute("role")==="menuitem"');
        assert.equal(await evaluate('document.querySelector(\'[aria-label="Account menu"]\').getAttribute("aria-expanded")'), 'true');
        await inspectScreen(`${label}-account-menu`); await screenshot(`${label}-account-menu`);
        await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, session);
        await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}, session);
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Account menu');
        await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32}, session);
        await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32}, session);
        await until('!!document.querySelector(".account-menu")');
        await click(theme === 'dark' ? 'Dark' : 'Light');
        assert.equal(await evaluate('document.querySelector(".account-menu")===null'), true);
        await click('Account menu');
        await evaluate('document.activeElement.blur()');
        assert.equal(await evaluate('document.querySelector(".account-menu")===null'), true);
        await evaluate('document.querySelector(\'[aria-label="Account menu"]\').focus()');
        await cdp.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13}, session);
        await cdp.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}, session);
        await until('!!document.querySelector(".account-menu")');
        await click(theme === 'dark' ? 'Dark' : 'Light');
      });
      await check(`${label}: legacy custom durations and clickable card keyboard access`, async () => {
        await pointerClick('document.querySelector(".session-menu summary")'); await click('Open');
        await until('!!document.querySelector(".author")');
        await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
        await evaluate('document.querySelector(".session-open").focus()');
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
        await until('!!document.querySelector(".author")');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [60,30]);
        assert.equal(await evaluate('document.querySelector(\'input[name="answer-duration"][value="custom"]\').checked'), true);
        await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
      });
      await check(`${label}: join without question preview and Entra attendee submission`, async () => {
        await click('Join with Code');
        assert.equal(await evaluate('document.querySelector(".join-card").textContent.includes("View questions")'), false);
        await input('#session-code', '000123'); await click('Next');
        assert.equal(await evaluate('document.querySelector(".join-code strong").textContent'), '000123');
        await input('#nickname', 'Alex'); await inspectScreen(`${label}-join`); await screenshot(`${label}-join`);
        assert.equal(await evaluate('document.querySelector(".join-card").textContent.includes("View questions")'), false);
        assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="preview")'), false);
        await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
        assert.equal(await evaluate('location.pathname'), '/play/');
        assert.equal(await evaluate('location.search.includes("credential") || location.search.includes("token")'), false);
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".attendee-lobby")');
        assert.equal(await evaluate('document.querySelector(".nickname").textContent'), 'Alex');
        await inspectScreen(`${label}-attendee-lobby`);
        await screenshot(`${label}-attendee-lobby`);
        await phase('question'); await inspectScreen(`${label}-attendee-question`); await screenshot(`${label}-attendee-question`);
        await click('Fabric SQL'); await until('!!document.querySelector(".submitted")');
        assert.equal(await evaluate('document.querySelector(".submitted").textContent.includes("Correct Answer")'), false);
        await inspectScreen(`${label}-attendee-submitted`); await screenshot(`${label}-attendee-submitted`);
        await phase('reveal'); await inspectScreen(`${label}-attendee-reveal`);
        await phase('leaderboard'); await inspectScreen(`${label}-attendee-leaderboard`);
        await phase('finished'); await inspectScreen(`${label}-attendee-finished`);
        await click('Play Again');
        assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'), null);
      });
      await check(`${label}: Forms editor, settings sidebar, keyboard deletion dialog and audience gates`, async () => {
        await click('New Live Quiz');
        await input('#quiz-title', 'Friday Team Quiz');
        assert.equal(await evaluate('document.querySelector(\'input[value="public"]\').disabled'), true);
        await input('#question-0', 'Where does QuizCrowd store your quiz data?');
        for (const [i, option] of ['Fabric SQL', 'Browser storage', 'A shared file', 'In memory'].entries()) await input(`#option-0-${i}`, option);
        assert.equal(await evaluate('document.querySelector("form").checkValidity()'), false);
        await pointerClick('document.querySelector(\'[aria-label="Question 1, correct option 1"]\')');
        assert.equal(await evaluate('document.querySelector(".settings-panel").textContent.includes("Content Type")'), false);
        assert.equal(await evaluate('document.querySelector(".settings-panel > fieldset > .settings-group > fieldset").classList.contains("audience-settings")'), true);
        assert.equal(await evaluate('document.querySelector(".audience-settings legend").textContent'), 'Who can respond?');
        assert.equal(await evaluate('document.querySelectorAll(".question-heading .duration").length'), 0);
        await input('#shared-duration', '35');
        assert.equal(await evaluate('document.querySelector(".settings-panel").getBoundingClientRect().left > document.querySelector(".author-content").getBoundingClientRect().left'), size === 'desktop');
        await inspectScreen(`${label}-settings`);
        await screenshot(`${label}-settings`);
        await click('Add Question');
        await input('#question-1', 'Ready for another round?');
        for (const [i, option] of ['Yes', 'Absolutely', 'One more', 'Ready'].entries()) await input(`#option-1-${i}`, option);
        await pointerClick('document.querySelector(\'[aria-label="Question 2, correct option 1"]\')');
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,35]);
        assert.equal(await evaluate('document.querySelector("#shared-duration")===null'), true);
        await setQuestionDuration(50,1);
        assert.ok(await evaluate('Math.abs(document.querySelector("#custom-duration-help").getBoundingClientRect().left-document.querySelector(".custom-duration-choice > span").getBoundingClientRect().left)<=1'));
        await inspectScreen(`${label}-custom-duration`); await screenshot(`${label}-custom-duration`);
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="same"]\')');
        assert.equal(await evaluate('document.querySelectorAll(".question-heading .duration").length'), 0);
        assert.equal(await evaluate('document.querySelector("#shared-duration").value'), '35');
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,35]);
        await setQuestionDuration(50,1);
        await pointerClick('document.querySelector(\'[aria-label="Remove question 2"]\')');
        await until('document.querySelector("dialog")?.open');
        for (let i = 0; i < 7; i++) {
          await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
          await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
          assert.equal(await evaluate('document.activeElement.closest("dialog") !== null'), true);
        }
        await inspectScreen(`${label}-delete-dialog`); await screenshot(`${label}-delete-dialog`);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await until('!document.querySelector("dialog")');
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Remove question 2');
        await evaluate('document.querySelector(\'[aria-label="Move question 2 up"]\').click()');
        assert.equal(await evaluate('document.querySelector("#question-0").value'), 'Ready for another round?');
        await evaluate('document.querySelector(\'[aria-label="Move question 1 down"]\').click()');
        await inspectScreen(`${label}-author`); await screenshot(`${label}-author`);
        await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft');
        assert.deepEqual(saved.answerDuration, { mode: 'custom', seconds: 35 });
        assert.deepEqual(saved.questions.map(q=>q.duration), [35,50]);
      });
      await check(`${label}: host QR, timer, reveal, leaderboard and podium`, async () => {
        assert.equal(await evaluate('document.querySelectorAll(".qr-container svg").length'), 1);
        assert.equal(await evaluate('location.pathname'), '/host/lobby/');
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".host-lobby")');
        const code = await evaluate('document.querySelector(".session-code strong").textContent');
        assertJoinChecksum(code);
        assert.equal(await evaluate('new URL(document.querySelector(".join-link a").href).searchParams.get("code")'), code);
        await inspectScreen(`${label}-host-lobby`); await screenshot(`${label}-host-lobby`);
        await click('Start Quiz'); await until('!!document.querySelector(".host-stage.stage-question")');
        assert.equal(await evaluate('location.pathname'), '/host/game/');
        assert.equal(await evaluate('document.querySelectorAll(".answers button").length'), 0);
        await inspectScreen(`${label}-host-question`); await screenshot(`${label}-host-question`);
        await phase('reveal'); await inspectScreen(`${label}-host-reveal`); await screenshot(`${label}-host-reveal`);
        await phase('leaderboard'); await inspectScreen(`${label}-host-leaderboard`); await screenshot(`${label}-host-leaderboard`);
        await click('Next Question →'); await until('!!document.querySelector(".stage-question")');
        await phase('leaderboard'); await click('See Final Results →'); await until('!!document.querySelector(".finished-screen")');
        await inspectScreen(`${label}-host-finished`); await screenshot(`${label}-host-finished`);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".podium-block span")].map(e=>e.textContent)'), ['2','1','3']);
        await click('Back to Home');
      });
      await check(`${label}: SQL-library presentation, publisher controls, reload persistence`, async () => {
        await inspectScreen(`${label}-recent`); await screenshot(`${label}-recent`);
        assert.equal(await evaluate('document.querySelector(".session-card .badge").textContent'), 'Finished');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector(".author-content").disabled'), true);
        assert.equal(await evaluate('document.querySelector(".author button[type=submit]") === null'), true);
        assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Open Lobby")'), true);
        await inspectScreen(`${label}-readonly`); await screenshot(`${label}-readonly`);
        await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
        await pointerClick('document.querySelector(".session-menu summary")');
        assert.equal(await evaluate('document.querySelector(".session-menu").open'), true);
        assert.equal(await evaluate('document.querySelector(".author")===null'), true);
        await inspectScreen(`${label}-menu`); await screenshot(`${label}-menu`);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        assert.equal(await evaluate('document.querySelector(".session-menu").open'), false);
        assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
        await until('document.querySelector(".session-menu").open');
        await click('Duplicate'); await until('!!document.querySelector(".author-content:not(:disabled)")');
        assert.equal(await evaluate('document.querySelector(".readonly-notice")===null'), true);
        assert.ok(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="duplicate")'));
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,50]);
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="same"]\')');
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,35]);
        await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
        const updated = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="edit" && r.draft).draft');
        assert.deepEqual(updated.answerDuration, { mode: 'custom', seconds: 35 });
        assert.deepEqual(updated.questions.map(q=>q.duration), [35,35]);
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".author")');
        assert.equal(await evaluate('document.querySelector(\'input[name="answer-duration"][value="custom"]\').checked'), true);
        assert.equal(await evaluate('document.querySelector("#shared-duration")===null'), true);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,35]);
        await inspectScreen(`${label}-equal-custom-reopen`); await screenshot(`${label}-equal-custom-reopen`);
        await pointerClick('document.querySelector(\'[aria-label="Go back"]\')'); await until('!!document.querySelector(".session-menu")');
        assert.equal(await evaluate('document.querySelector(".session-metrics").textContent'), '2 Questions0 Responses');
        await pointerClick('document.querySelector(".session-menu summary")'); await clickWithConfirmation('Delete', false);
        assert.equal(await evaluate('document.querySelectorAll(".session-card").length'), 2);
        await pointerClick('document.querySelector(".session-menu summary")'); await clickWithConfirmation('Delete', true);
        await until('document.querySelectorAll(".session-card").length===1');
        assert.equal(await evaluate('document.querySelector(".session-card .badge").textContent'), 'Finished');
        await pointerClick('document.querySelector(".session-menu summary")'); await clickWithConfirmation('Delete', true);
        await until('!!document.querySelector(".empty-library")');
        await cdp.call('Page.navigate', {url:'http://127.0.0.1:5174/admin/'}, session);
        await until('!!document.querySelector(".publisher-page")');
        await inspectScreen(`${label}-publisher`); await screenshot(`${label}-publisher`);
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".publisher-page")'); await pause(200);
        assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
        assert.equal(await evaluate('localStorage.getItem("quizcrowd-theme")'), theme);
        assert.deepEqual(await evaluate('Object.keys(localStorage)'), ['quizcrowd-theme']);
      });
    }
  }
  await check('duplicate persistence creates a separate copy before opening its editor', async () => {
    await navigate(); await evaluate('window.__quizcrowdFixture.phase("finished")');
    await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".readonly-notice")');
    const originalId = await evaluate('new URL(location.href).searchParams.get("gameId")');
    const original = await evaluate('JSON.stringify(JSON.parse(sessionStorage.getItem("quizcrowd-test-fixture")).records?.[0]?.[1])');
    await click('Go back'); await until('!!document.querySelector(".session-card")');
    await evaluate('window.__quizcrowdFixture.defer("duplicate")');
    await pointerClick('document.querySelector(".session-menu summary")'); await click('Duplicate');
    assert.equal(await evaluate('location.pathname'), '/');
    assert.equal(await evaluate('document.querySelector(".author")===null'), true, 'do not open an editor before commit');
    await evaluate('window.__quizcrowdFixture.release("Duplicate storage unavailable.")');
    await until('document.querySelector(\'[role="alert"]\')?.textContent.includes("Duplicate storage unavailable.")');
    assert.equal(await evaluate('document.querySelector(".author")===null'), true);
    assert.equal(await evaluate('document.querySelectorAll(".session-card").length'),1);
    await pointerClick('document.querySelector(".session-menu summary")'); await click('Duplicate');
    await until('!!document.querySelector(".author-content:not(:disabled)")');
    const copyId = await evaluate('new URL(location.href).searchParams.get("gameId")');
    assert.notEqual(copyId, originalId, 'duplicate must persist a new identity, not edit the source');
    assert.equal(await evaluate('document.querySelector("#quiz-title").value'), 'Copy - Friday Team Quiz');
    const records = await evaluate('JSON.parse(sessionStorage.getItem("quizcrowd-test-fixture")).records');
    assert.equal(JSON.stringify(records.find(([id])=>id===originalId)[1]), original);
    const copy = records.find(([id])=>id===copyId)[1];
    assert.notEqual(copy.currentCode, records.find(([id])=>id===originalId)[1].currentCode);
    assert.match(copy.currentCode, /^\d{6}$/); assert.equal(copy.phase, 'lobby');
    assert.deepEqual(copy.players, []); assert.equal(copy.myOption, undefined); assert.equal(copy.myResponse, undefined);
    await cdp.call('Page.reload', {}, session); await until('!!document.querySelector("#quiz-title")');
    assert.equal(await evaluate('document.querySelector("#quiz-title").value'), 'Copy - Friday Team Quiz');
    await click('Go back'); await until('document.querySelectorAll(".session-card").length===2');
    await cdp.call('Page.reload', {}, session); await until('document.querySelectorAll(".session-card").length===2');
    await inspectScreen('duplicate-persisted-cards'); await screenshot('duplicate-persisted-cards');
    await pointerClick('[...document.querySelectorAll(".session-open")].find(e=>e.getAttribute("aria-label")==="View Friday Team Quiz")');
    await until('!!document.querySelector(".readonly-notice")');
    assert.equal(await evaluate('document.querySelector("#quiz-title").value'), 'Friday Team Quiz');
  });
  await check('survey authoring preserves null keys and no-scoring completion', async () => {
    await navigate(); await click('New Live Survey');
    assert.equal(await evaluate('document.querySelectorAll(\'[aria-label*="correct option"]\').length'), 0);
    assert.equal(await evaluate('document.querySelector(".answer-reveal-settings")===null'), true);
    assert.equal(await evaluate('document.querySelectorAll(".settings-group").length'), 4);
    await input('#quiz-title', 'Team Survey'); await input('#question-0', 'How was the session?');
    for (const [i, option] of ['Great', 'Good', 'Okay', 'Needs work'].entries()) await input(`#option-0-${i}`, option);
    await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
    const request = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create")');
    assert.equal(request.draft.mode, 'survey'); assert.equal(request.draft.questions[0].correctIndex, null);
    await phase('reveal'); assert.equal(await evaluate('document.querySelector(".reveal-screen").textContent.includes("Correct Answer")'), false);
    await phase('finished'); assert.equal(await evaluate('!!document.querySelector(".podium")'), false);
    await screenshot('light-mobile-survey-finished');
  });
  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
    for (const theme of ['dark', 'light']) {
      const label = `${theme}-${size}`;
      await check(`${label}: survey settings, save/reopen/duplicate, delete all choices and readonly`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light'); await click('New Live Survey');
        await input('#quiz-title', 'Survey with Other'); await input('#question-0', 'What would you like next?');
        for (const [i, option] of ['Sessions', 'Workshops', 'Demos', 'Labs'].entries()) await input(`#option-0-${i}`, option);
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
        await setQuestionDuration(37);
        assert.equal(await evaluate('document.querySelector(".add-other")!==null'),true);
        await click('Add Other to question 1');
        await submitAuthor();await until('!!document.querySelector(".host-lobby")');
        await pointerClick('document.querySelector(".small-brand")');await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")');await until('!!document.querySelector(".author")');
        assert.equal(await evaluate('document.querySelector(".question-type").value'),'single');
        assert.equal(await evaluate('document.querySelector(".question-duration").textContent'),'37s');
        assert.equal(await evaluate('document.querySelector(".other-option")!==null'),true);
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft.questions[0].survey'),{other:true,allowMultiple:false});
        await chooseSurveyType('multiple');
        await chooseSurveyType('text');
        assert.equal(await evaluate('document.querySelectorAll(\'input[id^="option-"]\').length'),0);
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        await input('#question-0','What would you like next?');
        await setQuestionDuration(35);
        await chooseSurveyType('single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['Sessions','Workshops','Demos','Labs']);
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        await chooseSurveyType('multiple');
        await click('Remove question 1 Other');
        await click('Add Other to question 1');
        await evaluate('document.querySelector(".question-type").focus()');
        await inspectScreen(`${label}-survey-settings`); await screenshot(`${label}-survey-settings`);
        await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".author")');
        assert.equal(await evaluate('document.querySelector(".question-type").value'), 'multiple');
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".author")');
        assert.equal(await evaluate('document.querySelector(".question-type").value'), 'multiple');
        for (let i = 0; i < 4; i++) await click('Remove question 1 option 1');
        assert.equal(await evaluate('document.querySelectorAll(\'input[id^="option-"]\').length'), 0);
        assert.equal(await evaluate('document.querySelector(".question-type").value'), 'text');
        assert.equal(await evaluate('document.querySelector(".other-option")===null'),true);
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        await inspectScreen(`${label}-survey-only-other-author`); await screenshot(`${label}-survey-only-other-author`);
        await chooseSurveyType('single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['',''], 'explicitly deleted choices must not return');
        await chooseSurveyType('text');
        await submitAuthor(); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="edit"&&r.draft).draft');
        assert.deepEqual(saved.questions[0].survey, { other: true, allowMultiple: false });
        assert.deepEqual(saved.questions[0].options, []);
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-menu")');
        await pointerClick('document.querySelector(".session-menu summary")'); await click('Duplicate');
        await until('!!document.querySelector(".author-content:not(:disabled)")');
        assert.equal(await evaluate('document.querySelector(".question-type").value'), 'text');
        assert.equal(await evaluate('document.querySelectorAll(\'input[id^="option-"]\').length'), 0);
        await chooseSurveyType('single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['','']);
        assert.equal(await evaluate('document.querySelector("form").checkValidity()'),false);
        await chooseSurveyType('text');
        assert.equal(await evaluate('document.querySelector(".author-session-actions").textContent'),'Open Lobby');
        await click('Open Lobby'); await until('!!document.querySelector(".host-lobby")');
        await evaluate('window.__quizcrowdFixture.phase("question")');
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector(".question-type").matches(":disabled")'), true);
        assert.equal(await evaluate('document.querySelector(".question-duration").matches(":disabled")'),true);
        assert.equal(await evaluate('document.querySelector(".question-duration").textContent'),'35s');
        await inspectScreen(`${label}-survey-readonly-copy`); await screenshot(`${label}-survey-readonly-copy`);
      });
      await check(`${label}: survey multiple + Other picker, payload, polling and reload`, async () => {
        await navigate('join/?code=000123&example=survey-multiple');
        await input('#nickname', 'Survey tester'); await click('Join Game'); await until('!!document.querySelector(".survey-response")');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input[type=checkbox]").length'), 3);
        await evaluate('document.querySelector(".survey-choice input").focus()');
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
        for (const index of [1, 2]) await pointerClick(`document.querySelectorAll(".survey-choice input")[${index}]`);
        await input('.survey-written-response textarea', 'Literal | and \\ feedback');
        await pause(1200);
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input:checked").length'), 3);
        await inspectScreen(`${label}-survey-multiple-other`); await screenshot(`${label}-survey-multiple-other`);
        await click('Submit response'); await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'), { options: [0, 1], other: 'Literal | and \\ feedback' });
        assert.equal(await evaluate('"option" in window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer")'), false);
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".submitted")');
        assert.equal(await evaluate('document.querySelector(".survey-response")===null'), true);
        await phase('reveal'); await inspectScreen(`${label}-survey-multiple-results`); await screenshot(`${label}-survey-multiple-results`);
        assert.equal(await evaluate('document.querySelector(".distribution")===null'), true);
        assert.equal(await evaluate('document.body.textContent.includes("Literal | and")'), false);
      });
      await check(`${label}: survey Single Select Other is exclusive and deselected Other text is omitted`, async () => {
        await navigate('join/?code=000123&example=survey-single');
        await input('#nickname', 'Survey tester'); await click('Join Game'); await until('!!document.querySelector(".survey-response")');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input[type=radio]").length'), 3);
        await pointerClick('document.querySelector(".other-choice input")');await input('.survey-written-response textarea','Discarded stale text');
        await pointerClick('document.querySelectorAll(".survey-choice input")[1]');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input:checked").length'), 1);
        assert.equal(await evaluate('document.querySelector(".survey-written-response")===null'), true);
        await assertAnswerForeground(`${label}-survey-single-selected`);
        await inspectScreen(`${label}-survey-single`);
        await click('Submit response'); await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'), { options: [1] });
        await navigate('join/?code=000123&example=survey-single');
        await input('#nickname','Single Other tester');await click('Join Game');await until('!!document.querySelector(".survey-response")');
        await pointerClick('document.querySelectorAll(".survey-choice input")[0]');
        await pointerClick('document.querySelector(".other-choice input")');
        await input('.survey-written-response textarea','Single | with \\ literal');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input:checked").length'),1);
        await inspectScreen(`${label}-survey-single-other`);await screenshot(`${label}-survey-single-other`);
        await click('Submit response');await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'),{options:[],other:'Single | with \\ literal'});
        await navigate('join/?code=000123&example=survey-multiple');
        await input('#nickname', 'Survey tester'); await click('Join Game'); await until('!!document.querySelector(".survey-response")');
        for (const index of [0, 1, 2]) await pointerClick(`document.querySelectorAll(".survey-choice input")[${index}]`);
        await input('.survey-written-response textarea', 'Unselected stale multi text');
        await pointerClick('document.querySelector(".other-choice input")');
        assert.equal(await evaluate('document.querySelector(".survey-written-response")===null'), true);
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input:checked").length'), 2);
        await click('Submit response'); await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'), { options: [0, 1] });
      });
      await check(`${label}: survey Other-only accessible written response, no Other label`, async () => {
        await navigate('join/?code=000123&example=survey-other-only');
        await input('#nickname', 'Survey tester'); await click('Join Game'); await until('!!document.querySelector(".survey-response")');
        assert.equal(await evaluate('document.querySelector(".survey-response").innerText.includes("Other")'), false);
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice").length'), 0);
        assert.equal(await evaluate('document.querySelector(".survey-response button[type=submit]").disabled'), true);
        await input('.survey-written-response textarea', '   ');
        assert.equal(await evaluate('document.querySelector(".survey-response button[type=submit]").disabled'), true);
        await input('.survey-written-response textarea', '  Written | response \\  ');
        await inspectScreen(`${label}-survey-only-other`); await screenshot(`${label}-survey-only-other`);
        await click('Submit response'); await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'), { options: [], other: 'Written | response \\' });
      });
    }
  }
  await check('legacy Single Select plus Other remains playable and readonly content is not normalized on read', async () => {
    await navigate('join/?code=000123&example=survey-legacy-single-other');
    await input('#nickname','Legacy attendee');await click('Join Game');await until('!!document.querySelector(".survey-response")');
    assert.equal(await evaluate('document.querySelectorAll(".survey-choice input[type=radio]").length'),3);
    await pointerClick('document.querySelector(".other-choice input")');await input('.survey-written-response textarea','Legacy | text');
    await click('Submit response');await until('!!document.querySelector(".submitted")');
    assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'),{options:[],other:'Legacy | text'});
    await pointerClick('document.querySelector(".small-brand")');await until('!!document.querySelector(".session-open")');
    await pointerClick('document.querySelector(".session-open")');await until('!!document.querySelector(".readonly-notice")');
    assert.equal(await evaluate('document.querySelector(".other-option")!==null'),true);
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="edit"&&r.draft)'),false);
    assert.deepEqual(await evaluate('JSON.parse(sessionStorage.getItem("quizcrowd-test-fixture")).currentDraft.questions[0].survey'),{other:true,allowMultiple:false});
    await inspectScreen('legacy-survey-readonly');await screenshot('legacy-survey-readonly');
  });
  await check('public warning requires acknowledgement and creator cannot see publisher admin', async () => {
    await navigate('?fixture=creator&guests=on'); await click('New Live Quiz');
    assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Publisher controls")'), false);
    await pointerClick('document.querySelector(\'input[value="public"]\')');
    assert.ok(await evaluate('document.querySelector(".warning").textContent.includes("all questions and response options accessible to anyone")'));
    assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').disabled'), true);
    await screenshot('light-mobile-public-warning');
  });
  await check('history back/forward, failed and abandoned pending joins do not lock or redirect home', async () => {
    await navigate('?fixture=admin');
    await click('Join with Code');
    assert.equal(await evaluate('location.pathname'), '/join/');
    await input('#session-code', '999999'); await click('Next'); await input('#nickname', 'Alex'); await click('Join Game');
    await until('document.querySelector("[role=alert]")?.textContent.includes("Session not found")');
    await evaluate('history.back()'); await until('!!document.querySelector("#session-code")');
    await evaluate('history.back()'); await until('!!document.querySelector(".home-screen")');
    assert.equal(await evaluate('document.querySelector(".home-actions .quiz-action").disabled'), false);
    await evaluate('history.forward()'); await until('!!document.querySelector("#session-code")');
    await evaluate('history.forward()'); await until('!!document.querySelector("#nickname")');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    await input('#session-code', '000123'); await click('Next'); await input('#nickname', 'Alex');
    await evaluate('window.__quizcrowdFixture.defer("join")');
    await click('Join Game');
    assert.equal(await evaluate('document.querySelector(".join-card button[type=submit]").disabled'), true);
    await evaluate('history.back()'); await until('!!document.querySelector("#session-code")');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    await evaluate('window.__quizcrowdFixture.release()'); await pause(250);
    assert.equal(await evaluate('location.pathname'), '/');
    assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'), null);
    await click('New Live Survey'); await until('!!document.querySelector(".author")');
    assert.equal(await evaluate('location.pathname+location.search'), '/host/create/?type=survey');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    await click('Join with Code'); await input('#session-code', '000123'); await click('Next'); await input('#nickname', 'Alex');
    await evaluate('window.__quizcrowdFixture.defer("join")'); await click('Join Game');
    await evaluate('window.__quizcrowdFixture.release("Network temporarily unavailable.")');
    await until('document.querySelector("[role=alert]")?.textContent.includes("Network temporarily unavailable")');
    assert.equal(await evaluate('document.querySelector(".join-card button[type=submit]").disabled'), false);
    await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
  });
  await check('admin direct route rejects non-admin and signed-out UI, sign out clears attendance and protects the route', async () => {
    await navigate('admin/?fixture=creator');
    await until('document.body.textContent.includes("Access denied")');
    assert.equal(await evaluate('document.querySelector(".publisher-page")===null'), true);
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="configure")'), false);
    await navigate('admin/?fixture=signed-out');
    await until('!!document.querySelector(".sign-in-card")');
    assert.equal(await evaluate('document.querySelector(".publisher-page")===null'), true);
    await click('Sign in with Microsoft Entra'); await until('!!document.querySelector(".publisher-page")');
    assert.equal(await evaluate('location.pathname'), '/admin/');
    await pointerClick('document.querySelector(".small-brand")');
    await click('Join with Code'); await input('#session-code', '000123'); await click('Next'); await input('#nickname', 'Alex');
    await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
    assert.ok(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'));
    await cdp.call('Page.navigate', {url:'http://127.0.0.1:5174/admin/'}, session); await until('!!document.querySelector(".publisher-page")');
    await click('Account menu'); await click('Sign out');
    await until('!!document.querySelector(".sign-in-card")');
    assert.equal(await evaluate('sessionStorage.getItem("quizcrowd-attendee-credential")'), null);
    assert.equal(await evaluate('document.querySelector(".account-avatar")===null'), true);
    assert.equal(await evaluate('document.querySelector(".publisher-page")===null'), true);
  });
  await check('owner deep links preserve intended route through Entra and reject missing, invalid or unowned IDs', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    await navigate(`host/item/?gameId=${id}&fixture=signed-out`);
    await until('!!document.querySelector(".sign-in-card")');
    await click('Sign in with Microsoft Entra'); await until('!!document.querySelector(".author")');
    assert.equal(await evaluate('location.pathname+location.search'), `/host/item/?gameId=${id}`);
    await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".author")');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".duration input")].map(e=>Number(e.value))'), [60,30]);
    await evaluate('location.hash="content"'); await pause(150);
    assert.equal(await evaluate('!!document.querySelector(".author")'), true);
    await evaluate('history.back()'); await pause(150);
    assert.equal(await evaluate('!!document.querySelector(".author")'), true);
    await navigate(`host/item/?gameId=${id}&fixture=admin&owner=other`);
    await until('document.querySelector("[role=alert]")?.textContent.includes("ownership required")');
    assert.equal(await evaluate('document.querySelector(".author")===null'), true);
    await navigate('host/item/?gameId=22222222-2222-4333-8444-555555555555&fixture=admin');
    await until('document.body.textContent.includes("Session unavailable")');
    await navigate('host/item/?gameId=invalid');
    await until('document.body.textContent.includes("Page not found")');
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="edit")'), false);
    await navigate('library/');
    assert.equal(await evaluate('location.pathname'), '/');
  });
  await check('Legacy UUID invitations resolve to a six-digit string without displaying the ID', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    await navigate(`?quiz=${id}`);
    await until('document.querySelector(".join-code strong")?.textContent==="000123"');
    assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(id)})`), false);
    assert.ok(await evaluate(`window.__quizcrowdFixture.requests.some(r=>r.command==="resolve"&&r.id===${JSON.stringify(id)})`));
  });
  await check('signed-out join preserves Entra gesture and hides host/admin capabilities', async () => {
    await navigate('?fixture=signed-out&quiz=000123');
    assert.equal(await evaluate('!!document.querySelector("#nickname")'), true);
    assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Join as anonymous guest")'), false);
    await click('Sign in to attend'); await until('[...document.querySelectorAll("button")].some(e=>e.textContent==="Join Game")');
  });
  await check('guest-enabled fixture offers scoped anonymous join without author access', async () => {
    await navigate('?fixture=signed-out&guests=on&quiz=000123'); await input('#nickname', 'Guest');
    await click('Join as anonymous guest'); await until('!!document.querySelector(".attendee-lobby")');
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="join").asGuest'), true);
  });
  await check('320px width and reduced motion remain usable', async () => {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('?fixture=admin'); await inspectScreen('light-320-home');
    assert.equal(await evaluate('getComputedStyle(document.body).animationName'), 'none');
    assert.equal(await evaluate('!!document.querySelector(".workspace-shapes")'), true);
    await navigate('?fixture=admin&quiz=000123');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".shapes-wrapper span")).animationName'), 'none');
  });
  await check('explicit theme selection is keyboard-operable without a system mode', async () => {
    await evaluate('document.querySelector(\'[aria-label="Color theme"] button:first-child\').focus()');
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await until('document.documentElement.dataset.theme === "dark"');
  });
  await check('home uses active branded motion and reduced motion disables it', async () => {
    await cdp.call('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false}, session);
    await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]}, session);
    await navigate('?fixture=admin');
    assert.equal(await evaluate('getComputedStyle(document.body).animationName'), 'gradient-shift');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-shapes span")).animationName'), 'shapes-fall');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-shapes span:nth-child(2)")).borderColor'), await evaluate('getComputedStyle(document.querySelector(".brand-wordmark > span:last-child")).color'));
    await pause(250); await screenshot('dark-desktop-animated-home');
    await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]}, session);
    assert.equal(await evaluate('getComputedStyle(document.body).animationName'), 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".workspace-shapes span")).animationName'), 'none');
  });
  await check('unavailable browser preference storage is reported, not silently persisted', async () => {
    await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'dark'}]},session);
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError')}});` }, session);
    await navigate('?fixture=signed-out');
    await until('!!document.querySelector(".theme-notice")');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
    await click('Light');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
    assert.ok(await evaluate('document.querySelector(".theme-notice").textContent.includes("reset on reload")'));
    await navigate();
    await until('!!document.querySelector(".session-list .session-card")');
    await click('Cards');
    assert.equal(await evaluate('!!document.querySelector(".session-list")'),false);
    assert.ok(await evaluate('document.querySelector(".recent-sessions [role=status]").textContent.includes("view will reset on reload")'));
    await click('List');
    assert.equal(await evaluate('!!document.querySelector(".session-list")'),true);
  });
  await check('no runtime exception and no cloud or third-party network access in UI test', async () => {
    assert.deepEqual(cdp.exceptions, []);
    assert.deepEqual(cdp.network.filter((url) => !url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('data:')), []);
  });
  console.log(JSON.stringify({ passed: report.checks.length, screenshots: report.screenshots.length, contrastScreens: report.contrast.length, directory }, null, 2));
} finally {
  await writeFile(join(directory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`).catch((error) => console.error(`Could not save UI evidence: ${error.message}`));
  if (cdp) {
    try { await cdp.call('Browser.close'); } catch (error) { console.error(`Browser close: ${error.message}`); }
    cdp.close();
  }
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), pause(3000)]);
    if (browser.exitCode === null) browser.kill();
  }
  await server?.close();
  if (browser) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
