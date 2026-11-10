import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
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
async function screenshot(name, selector) {
  await evaluate('window.scrollTo(0,0)');
  const modal = await evaluate('!!document.querySelector("dialog[open]")');
  const clip = selector ? await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.max(0,r.left+scrollX-4),y:Math.max(0,r.top+scrollY-4),width:r.width+8,height:r.height+8,scale:4};})()`) : undefined;
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !modal, ...(clip ? { clip } : {}) }, session);
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
    {value:'public', title:audience.disabled?'Anyone with link (disabled by admin)':'Anyone with link', description:"Anonymous response, doesn't require sign-in"},
  ], `${name}: exact audience order and copy`);
  const editor = await evaluate(`(() => {
    const root=document.querySelector('.author');if(!root)return null;
    return {survey:root.querySelector('h1').textContent.endsWith('Survey'),
      legends:[...root.querySelectorAll('.settings-group > fieldset > legend')].map(e=>e.textContent),
      late:[...root.querySelectorAll('input[name="late-join"]')].map(e=>e.labels[0].textContent),
      reveal:[...root.querySelectorAll('input[name="answer-reveal"]')].map(e=>e.labels[0].textContent),
      emptyGroups:[...root.querySelectorAll('.settings-group')].filter(e=>!e.textContent.trim()).length,
      hints:[...root.querySelectorAll('.question-editor')].map(q=>{
        const hint=q.querySelector('.option-hint'),grid=q.querySelector('.option-editor-grid'),add=[...q.querySelectorAll('button')].find(e=>e.textContent.trim()==='Add option');
        return {exists:!!hint,afterOptions:!hint||!!(grid.compareDocumentPosition(hint)&Node.DOCUMENT_POSITION_FOLLOWING),
          afterAdd:!hint||!add||!!(add.compareDocumentPosition(hint)&Node.DOCUMENT_POSITION_FOLLOWING),
          belowAdd:!hint||!add||hint.getBoundingClientRect().top>=add.getBoundingClientRect().bottom};
      })};
  })()`);
  if (editor) {
    assert.deepEqual(editor.legends, ['Who can respond?', 'Answer duration', 'Allow late joins?', ...(editor.survey ? [] : ['Show correct answers?'])]);
    assert.deepEqual(editor.late, ["Don't allow late join", 'Allow join after game start']);
    assert.deepEqual(editor.reveal, editor.survey ? [] : ['Wait for all users', 'Show after user response', 'Never show']);
    assert.equal(editor.emptyGroups, 0);
    for (const hint of editor.hints) {
      assert.equal(hint.exists, !editor.survey); assert.ok(hint.afterOptions && hint.afterAdd && hint.belowAdd, `${name}: helper must follow options and Add option in DOM and visually`);
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
  assert.equal(await evaluate('document.querySelector("footer").textContent'), 'QuizCrowd for Microsoft Fabric');
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
  await evaluate('if (location.origin === "http://127.0.0.1:5174") {sessionStorage.removeItem("quizcrowd-attendee-credential"); sessionStorage.removeItem("quizcrowd-test-fixture");}');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:5174/${query}` }, session);
  await until('!!window.__quizcrowdFixture && !!document.querySelector("main")');
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
  await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] }, session);

  await check('join back does not disable home while its list refresh is pending', async () => {
    await navigate('?fixture=admin');
    await click('Join with Code');
    await evaluate('window.__quizcrowdFixture.defer("list")');
    await pointerClick('document.querySelector(\'[aria-label="Go back"]\')');
    assert.equal(await evaluate('document.querySelector(".home-actions .primary").disabled'), false);
    await evaluate('window.__quizcrowdFixture.release()');
  });

  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
    for (const theme of ['dark', 'light']) {
      await navigate('?fixture=admin');
      if (size === 'desktop' && theme === 'dark') await check('dark is default even with a light system preference', async () => assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark'));
      await check(`${theme}-${size}: original tile brand at compact sizes`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light');
        const mark = await evaluate(`(() => {
          const svg=document.querySelector('.brand-mark');
          const sizes=[16,20,24,32].map(size=>{svg.style.width=size+'px';svg.style.height=size+'px';const r=svg.getBoundingClientRect();return [r.width,r.height];});
          svg.style.removeProperty('width');svg.style.removeProperty('height');
          return {sizes,viewBox:svg.getAttribute('viewBox'),hidden:svg.getAttribute('aria-hidden'),name:svg.closest('button').getAttribute('aria-label'),
            rectangles:[...svg.querySelectorAll('rect')].map(e=>[...e.attributes].map(a=>[a.name,a.value])),
            color:getComputedStyle(svg).color,wordmarkColor:getComputedStyle(document.querySelector('.brand-wordmark > span')).color,shrink:getComputedStyle(svg).flexShrink};
        })()`);
        assert.deepEqual(mark.sizes,[16,20,24,32].map(size=>[size,size]));
        assert.equal(mark.viewBox,'0 0 24 24');assert.equal(mark.hidden,'true');assert.equal(mark.name,'QuizCrowd home');
        assert.equal(mark.rectangles.length,4);assert.equal(mark.color,mark.wordmarkColor);assert.equal(mark.shrink,'0');
        assert.equal(mark.rectangles.filter(attributes=>attributes.some(([name,value])=>name==='fill'&&value==='none')).length,1);
        await inspectScreen(`${theme}-${size}-tile-brand`);await screenshot(`${theme}-${size}-brand-header`,'.app-toolbar');
        if(theme==='light'&&size==='desktop') {
          const svg=await evaluate(`(() => {const source=document.querySelector('.brand-mark'),copy=source.cloneNode(true);copy.removeAttribute('class');copy.removeAttribute('aria-hidden');copy.removeAttribute('focusable');copy.setAttribute('role','img');copy.setAttribute('aria-label','QuizCrowd four-tile mark');copy.style.color=getComputedStyle(source).color;copy.setAttribute('width','128');copy.setAttribute('height','128');return new XMLSerializer().serializeToString(copy);})()`);
          await writeFile(join(directory,'quizcrowd-mark.svg'),svg);
          await screenshot('quizcrowd-mark','.brand-mark');
        }
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
      await check(`${theme}-${size}: question controls align right with a direct Survey type select`,async()=>{
        for(const mode of ['quiz','survey']) {
          await navigate();await click(theme==='dark'?'Dark':'Light');await click(mode==='quiz'?'New Live Quiz':'New Live Survey');
          assert.equal(await evaluate('document.querySelector(".question-heading .duration")===null'),true);
          await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
          const alignment=await evaluate(`(() => {const h=document.querySelector('.question-heading'),a=h.querySelector('.question-actions'),t=a.querySelector('.duration');return {right:Math.abs(h.getBoundingClientRect().right-a.getBoundingClientRect().right),timerRight:Math.abs(h.getBoundingClientRect().right-t.getBoundingClientRect().right),selects:h.querySelectorAll('select').length};})()`);
          assert.ok(alignment.right<=1);
          assert.equal(alignment.selects,mode==='survey'?1:0);
          if(mode==='quiz')assert.ok(alignment.timerRight<=1,'single-question Quiz timer must align to the right');
          else {
            assert.deepEqual(await evaluate('[...document.querySelector(".question-type").options].map(e=>e.textContent)'),['Single Select','Multiple Select','Free Text']);
            await evaluate('document.querySelector(".question-heading .duration input").focus()');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
            assert.equal(await evaluate('document.activeElement.classList.contains("question-type")'),true);
            assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Question 1 response type');
            await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
            assert.equal(await evaluate('document.querySelector(".question-type").value'),'multiple');
            assert.ok(await evaluate('document.querySelector(".question-type").getBoundingClientRect().height>=32'));
          }
          await inspectScreen(`${theme}-${size}-${mode}-question-header`);await screenshot(`${theme}-${size}-${mode}-question-header`);
          await click('Add Question');
          if(size==='mobile')await cdp.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false},session);
          const rows=await evaluate('[...document.querySelectorAll(".question-heading")].map(h=>{const a=h.querySelector(".question-actions").getBoundingClientRect(),r=h.getBoundingClientRect();return a.left>=r.left-1&&Math.abs(a.right-r.right)<=1})');
          assert.deepEqual(rows,[true,true]);
          await inspectScreen(`${theme}-${size}-${mode}-question-header-two`);
          if(size==='mobile') {
            await screenshot(`${theme}-320-${mode}-question-header`);
            await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
          }
        }
      });
      await check(`${theme}-${size}: settings layout, inline duration and visible choices`, async () => {
        await navigate(); await click(theme === 'dark' ? 'Dark' : 'Light'); await click('New Live Quiz');
        const layout = await evaluate(`(() => {
          const content=document.querySelector('.author-content'),panel=document.querySelector('.settings-panel'),a=content.getBoundingClientRect(),b=panel.getBoundingClientRect();
          const label=document.querySelector('.shared-duration-choice > label').getBoundingClientRect(),input=document.querySelector('#shared-duration').getBoundingClientRect();
          return {domFirst:!!(content.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING),contentBottom:a.bottom,contentTop:a.top,settingsTop:b.top,inline:Math.abs(label.top+label.height/2-input.top-input.height/2),inputWidth:input.width,
            groups:[...panel.querySelectorAll('.settings-group')].map(e=>{const s=getComputedStyle(e);return {border:s.borderTopWidth,color:s.borderTopColor,padding:parseFloat(s.paddingTop)}})};
        })()`);
        assert.equal(layout.domFirst, true);
        if (size === 'mobile') assert.ok(layout.settingsTop >= layout.contentBottom, 'questions must appear before settings in narrow layouts');
        else assert.ok(Math.abs(layout.settingsTop - layout.contentTop) <= 1, 'desktop keeps two top-aligned columns');
        assert.ok(layout.inline <= 1); assert.equal(layout.inputWidth, 48);
        assert.equal(await evaluate(`(() => {const input=document.querySelector('#shared-duration'),control=input.closest('.duration'),clock=control.querySelector('svg'),unit=control.lastElementChild,r=control.getBoundingClientRect();return clock!==null&&unit.textContent==='s'&&unit.getBoundingClientRect().right<r.right&&getComputedStyle(control).borderTopWidth==='1px';})()`),true);
        assert.equal(layout.groups.length, 4);
        for (const group of layout.groups.slice(1)) {
          assert.equal(group.border, '1px'); assert.match(group.color, /rgba\(/); assert.ok(group.padding <= 16);
        }
        assert.equal(await evaluate('document.querySelector(".duration-settings legend").textContent'), 'Answer duration');
        assert.equal(await evaluate('document.querySelector(".duration-settings legend svg")===null'), true);
        assert.equal(await evaluate('document.querySelector(".shared-duration-choice > label").textContent'), 'Same for all questions');
        assert.equal(await evaluate('document.querySelectorAll(".settings-panel select").length'), 0);
        assert.equal(await evaluate('document.body.textContent.includes("Public attendance is disabled by the publisher.")'), false);
        assert.equal(await evaluate('document.querySelector(\'input[value="public"]\').labels[0].querySelector("span").firstChild.textContent'), 'Anyone with link (disabled by admin)');
        await evaluate('document.querySelector(".author-content button[type=submit]").focus()');
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
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft');
        assert.deepEqual(saved.answerDuration, {mode:'same',seconds:35});
        assert.equal(saved.lateJoin, true); assert.equal(saved.showAnswer, 'after_response');
        await click('Start Game'); await until('!!document.querySelector(".host-stage.stage-question")');
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
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".home-actions .action-description")].map(e=>e.textContent)'), ['Create a quiz and host it live.','Collect feedback in a live survey.','Enter a game code to take part.']);
        const actions = await evaluate(`(() => {
          const parent=document.querySelector(".home-actions");
          return {width:parent.clientWidth,buttons:[...parent.children].map(e=>{
            const s=getComputedStyle(e);
            return {width:e.offsetWidth,height:e.offsetHeight,top:e.offsetTop,left:e.offsetLeft,border:s.borderWidth,style:s.borderStyle,radius:s.borderRadius,padding:s.padding};
          })};
        })()`);
        for (const action of actions.buttons) {
          assert.ok(action.height >= 72 && action.height <= 84, `${label}: compact readable action height`);
          assert.equal(action.border, '1px');
          assert.equal(action.style, 'solid');
          assert.equal(action.radius, '12px');
          assert.equal(action.padding, '12px 16px');
        }
        assert.equal(new Set(actions.buttons.map(e=>e.width)).size, 1, `${label}: all three action widths match`);
        if (size === 'desktop') {
          assert.deepEqual(actions.buttons.map(e=>e.width), [260,260,260]);
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
        await inspectScreen(`${label}-home`);
        const { root } = await cdp.call('DOM.getDocument', {}, session);
        const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: root.nodeId, selector: '.home-actions .primary' }, session);
        for (const forcedPseudoClasses of [[], ['hover'], ['focus'], ['active']]) {
          await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }, session);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-actions .primary")).color'), 'rgb(255, 255, 255)');
        }
        await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session);
        const actionNodes = [];
        for (let i=1;i<=3;i++) {
          const {nodeId:actionId} = await cdp.call('DOM.querySelector', {nodeId:root.nodeId,selector:`.home-actions > button:nth-child(${i})`}, session);
          actionNodes.push(actionId);
        }
        await cdp.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]}, session);
        for (const actionId of actionNodes) await cdp.call('CSS.forcePseudoState', {nodeId:actionId,forcedPseudoClasses:['hover']}, session);
        await pause(250);
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
        await input('.question-editor:last-child .duration input', '50');
        assert.ok(await evaluate('Math.abs(document.querySelector("#custom-duration-help").getBoundingClientRect().left-document.querySelector(".custom-duration-choice > span").getBoundingClientRect().left)<=1'));
        await inspectScreen(`${label}-custom-duration`); await screenshot(`${label}-custom-duration`);
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="same"]\')');
        assert.equal(await evaluate('document.querySelectorAll(".question-heading .duration").length'), 0);
        assert.equal(await evaluate('document.querySelector("#shared-duration").value'), '35');
        await pointerClick('document.querySelector(\'input[name="answer-duration"][value="custom"]\')');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".question-heading .duration input")].map(e=>Number(e.value))'), [35,35]);
        await input('.question-editor:last-child .duration input', '50');
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
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create").draft');
        assert.deepEqual(saved.answerDuration, { mode: 'custom', seconds: 35 });
        assert.deepEqual(saved.questions.map(q=>q.duration), [35,50]);
      });
      await check(`${label}: host QR, timer, reveal, leaderboard and podium`, async () => {
        assert.equal(await evaluate('document.querySelectorAll(".qr-container svg").length'), 1);
        assert.equal(await evaluate('location.pathname'), '/host/lobby/');
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".host-lobby")');
        assert.equal(await evaluate('document.querySelector(".session-code strong").textContent'), '000123');
        assert.equal(await evaluate('new URL(document.querySelector(".join-link a").href).searchParams.get("code")'), '000123');
        await inspectScreen(`${label}-host-lobby`); await screenshot(`${label}-host-lobby`);
        await click('Start Game'); await until('!!document.querySelector(".host-stage.stage-question")');
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
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
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
    assert.equal(await evaluate('document.querySelectorAll(".settings-group").length'), 3);
    await input('#quiz-title', 'Team Survey'); await input('#question-0', 'How was the session?');
    for (const [i, option] of ['Great', 'Good', 'Okay', 'Needs work'].entries()) await input(`#option-0-${i}`, option);
    await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
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
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        assert.deepEqual(await evaluate('[...document.querySelector(".question-type").options].map(e=>e.textContent)'),['Single Select','Multiple Select','Free Text']);
        await evaluate('document.querySelector(".question-type").focus()');
        await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
        await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
        assert.equal(await evaluate('document.querySelector(".question-type").value'),'multiple');
        await input('.question-type','text');
        assert.equal(await evaluate('document.querySelectorAll(\'input[id^="option-"]\').length'),0);
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        await input('#question-0','What would you like next?');
        await input('#shared-duration','35');
        await input('.question-type','single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['Sessions','Workshops','Demos','Labs']);
        assert.equal(await evaluate('document.querySelector(".add-other")===null'),true);
        await input('.question-type','multiple');
        await click('Add Other to question 1');
        await evaluate('document.querySelector(".question-type").focus()');
        await inspectScreen(`${label}-survey-settings`); await screenshot(`${label}-survey-settings`);
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
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
        await input('.question-type','single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['',''], 'explicitly deleted choices must not return');
        await input('.question-type','text');
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
        const saved = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="edit"&&r.draft).draft');
        assert.deepEqual(saved.questions[0].survey, { other: true, allowMultiple: false });
        assert.deepEqual(saved.questions[0].options, []);
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-menu")');
        await pointerClick('document.querySelector(".session-menu summary")'); await click('Duplicate');
        await until('!!document.querySelector(".author-content:not(:disabled)")');
        assert.equal(await evaluate('document.querySelector(".question-type").value'), 'text');
        assert.equal(await evaluate('document.querySelectorAll(\'input[id^="option-"]\').length'), 0);
        await input('.question-type','single');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(\'input[id^="option-"]\')].map(e=>e.value)'),['','']);
        assert.equal(await evaluate('document.querySelector("form").checkValidity()'),false);
        await input('.question-type','text');
        await click('Save & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
        await evaluate('window.__quizcrowdFixture.phase("question")');
        await pointerClick('document.querySelector(".small-brand")'); await until('!!document.querySelector(".session-open")');
        await pointerClick('document.querySelector(".session-open")'); await until('!!document.querySelector(".readonly-notice")');
        assert.equal(await evaluate('document.querySelector(".question-type").matches(":disabled")'), true);
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
        assert.equal(await evaluate('document.querySelector(".distribution").textContent.includes("Other1 responses")'), true);
        assert.equal(await evaluate('document.body.textContent.includes("Literal | and")'), false);
      });
      await check(`${label}: survey Single Select has no Other and deselected multi Other text is omitted`, async () => {
        await navigate('join/?code=000123&example=survey-single');
        await input('#nickname', 'Survey tester'); await click('Join Game'); await until('!!document.querySelector(".survey-response")');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input[type=radio]").length'), 2);
        assert.equal(await evaluate('document.querySelector(".other-choice")===null'),true);
        await pointerClick('document.querySelectorAll(".survey-choice input")[0]');
        await pointerClick('document.querySelectorAll(".survey-choice input")[1]');
        assert.equal(await evaluate('document.querySelectorAll(".survey-choice input:checked").length'), 1);
        assert.equal(await evaluate('document.querySelector(".survey-written-response")===null'), true);
        await inspectScreen(`${label}-survey-single`);
        await click('Submit response'); await until('!!document.querySelector(".submitted")');
        assert.deepEqual(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="answer").response'), { options: [1] });
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
    assert.equal(await evaluate('document.querySelector(".home-actions .primary").disabled'), false);
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
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError')}});` }, session);
    await navigate('?fixture=signed-out');
    await until('!!document.querySelector(".theme-notice")');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
    await click('Light');
    assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
    assert.ok(await evaluate('document.querySelector(".theme-notice").textContent.includes("reset on reload")'));
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
