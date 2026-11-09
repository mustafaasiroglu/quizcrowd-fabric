import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startPreview } from './ui-preview.mjs';

const edge = process.env.QUIZCROWD_TEST_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const directory = resolve('rayfin', '.temp', 'ui-review');
const profile = resolve('rayfin', '.temp', 'edge-ui-review');
const report = { kind: 'Local real-browser UI tests with test-only connection fixtures; not live Fabric authorization', checks: [], screenshots: [], contrast: [] };
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
  const pending = new Map(), exceptions = [], network = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  return {
    exceptions, network,
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
  const expression = `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)})`;
  await pointerClick(expression);
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
async function screenshot(name) {
  await evaluate('window.scrollTo(0,0)');
  const modal = await evaluate('!!document.querySelector("dialog[open]")');
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !modal }, session);
  const relative = join('rayfin', '.temp', 'ui-review', `${name}.png`);
  await writeFile(relative, Buffer.from(shot.data, 'base64'));
  report.screenshots.push(relative);
}
async function check(name, run) {
  await run();
  report.checks.push({ name, passed: true });
}
async function inspectScreen(name) {
  const dialog = await evaluate(`(() => {const e=document.querySelector('dialog[open]');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {center:r.top+r.height/2,expected:innerHeight/2,top:r.top,height:r.height,position:s.position,inset:s.inset,margin:s.margin,scrollY,viewport:visualViewport.height};})()`);
  if (dialog) assert.ok(Math.abs(dialog.center - dialog.expected) <= 1, `${name}: modal must be centered in the actual viewport: ${JSON.stringify(dialog)}`);
  const layout = await evaluate(`({ width:innerWidth, scroll:document.documentElement.scrollWidth, page:document.querySelector('main').className, unnamed:[...document.querySelectorAll('input,textarea,select')].filter(e => e.getBoundingClientRect().width && !e.labels?.length && !e.getAttribute('aria-label')).map(e=>e.outerHTML), themes:[...document.querySelectorAll('[aria-label="Color theme"] button')].map(e=>e.textContent.trim()) })`);
  assert.ok(layout.scroll <= layout.width + 1, `${name}: horizontal overflow ${layout.scroll}/${layout.width}`);
  assert.deepEqual(layout.unnamed, [], `${name}: unnamed form controls`);
  assert.deepEqual(layout.themes, ['Dark', 'Light']);
  assert.equal(await evaluate('document.querySelector("footer").textContent'), 'QuizCrowd for Microsoft Fabric');
  const tree = await cdp.call('Accessibility.getFullAXTree', {}, session);
  const unnamed = tree.nodes.filter((node) => !node.ignored && ['button', 'textbox', 'combobox', 'checkbox', 'radio'].includes(node.role?.value) && !node.name?.value);
  assert.deepEqual(unnamed.map((node) => node.role.value), [], `${name}: unnamed interactive AX nodes`);
  const contrast = await evaluate(`(() => {
    const parse = color => { const m=color.match(/[\\d.]+/g); return m ? m.map(Number) : [0,0,0,0]; };
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
  await evaluate('if (location.origin === "http://127.0.0.1:5174") sessionStorage.removeItem("quizcrowd-attendee-credential")');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:5174/${query}` }, session);
  await until('!!window.__quizcrowdFixture && !!document.querySelector(".home-screen,.join-card")');
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

  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
    for (const theme of ['dark', 'light']) {
      await navigate('?fixture=admin');
      if (size === 'desktop' && theme === 'dark') await check('dark is default even with a light system preference', async () => assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark'));
      await click(theme === 'dark' ? 'Dark' : 'Light');
      const label = `${theme}-${size}`;
      await check(`${label}: home layout, theme and accessibility`, async () => {
        assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-heading h1")).fontSize'), size === 'desktop' ? '72px' : '48px');
        await inspectScreen(`${label}-home`);
        const { root } = await cdp.call('DOM.getDocument', {}, session);
        const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: root.nodeId, selector: '.home-actions .secondary' }, session);
        for (const forcedPseudoClasses of [[], ['hover'], ['focus'], ['active']]) {
          await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }, session);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-actions .secondary")).color'), 'rgb(255, 255, 255)');
        }
        await cdp.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session);
        await screenshot(`${label}-home`);
      });
      await check(`${label}: join without question preview and Entra attendee submission`, async () => {
        await click('Join a Quiz');
        assert.equal(await evaluate('document.querySelector(".join-card").textContent.includes("View questions")'), false);
        await input('#session-code', 'A1B2C3D4E5'); await click('Next');
        await input('#nickname', 'Alex'); await inspectScreen(`${label}-join`); await screenshot(`${label}-join`);
        assert.equal(await evaluate('document.querySelector(".join-card").textContent.includes("View questions")'), false);
        assert.equal(await evaluate('window.__quizcrowdFixture.requests.some(r=>r.command==="preview")'), false);
        await click('Join Game'); await until('!!document.querySelector(".attendee-lobby")');
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
      await check(`${label}: question editing, keyboard settings dialog and internal/public gates`, async () => {
        await click('Host a Quiz');
        await input('#quiz-title', 'Friday Team Quiz');
        assert.equal(await evaluate('document.querySelector(\'option[value="public"]\').disabled'), true);
        await input('#question-0', 'Where does QuizCrowd store your quiz data?');
        for (const [i, option] of ['Fabric SQL', 'Browser storage', 'A shared file', 'In memory'].entries()) await input(`#option-0-${i}`, option);
        assert.equal(await evaluate('document.querySelector("form").checkValidity()'), false);
        await pointerClick('document.querySelector(\'[aria-label="Question 1, correct option 1"]\')');
        await pointerClick('document.querySelector(\'[aria-label="Game settings"]\')');
        await until('document.querySelector("dialog")?.open');
        assert.equal(await evaluate('document.activeElement.closest("dialog") !== null'), true);
        for (let i = 0; i < 7; i++) {
          await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
          await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, session);
          assert.equal(await evaluate('document.activeElement.closest("dialog") !== null'), true);
        }
        await inspectScreen(`${label}-settings`);
        await screenshot(`${label}-settings`);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await until('!document.querySelector("dialog")');
        assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Game settings');
        await click('+ Add Question');
        await input('#question-1', 'Ready for another round?');
        for (const [i, option] of ['Yes', 'Absolutely', 'One more', 'Ready'].entries()) await input(`#option-1-${i}`, option);
        await pointerClick('document.querySelector(\'[aria-label="Question 2, correct option 1"]\')');
        await evaluate('document.querySelector(\'[aria-label="Move question 2 up"]\').click()');
        assert.equal(await evaluate('document.querySelector("#question-0").value'), 'Ready for another round?');
        await evaluate('document.querySelector(\'[aria-label="Move question 1 down"]\').click()');
        await inspectScreen(`${label}-author`); await screenshot(`${label}-author`);
        await click('Create & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
      });
      await check(`${label}: host QR, timer, reveal, leaderboard and podium`, async () => {
        assert.equal(await evaluate('document.querySelectorAll(".qr-container svg").length'), 1);
        await inspectScreen(`${label}-host-lobby`); await screenshot(`${label}-host-lobby`);
        await click('Start Game'); await until('!!document.querySelector(".host-stage.stage-question")');
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
        await click('Your Quizzes'); await inspectScreen(`${label}-library`); await screenshot(`${label}-library`);
        await click('Publisher controls'); await inspectScreen(`${label}-publisher`); await screenshot(`${label}-publisher`);
        await cdp.call('Page.reload', {}, session); await until('!!document.querySelector(".home-screen")'); await pause(200);
        assert.equal(await evaluate('document.documentElement.dataset.theme'), theme);
        assert.equal(await evaluate('localStorage.getItem("quizcrowd-theme")'), theme);
        assert.deepEqual(await evaluate('Object.keys(localStorage)'), ['quizcrowd-theme']);
      });
    }
  }
  await check('survey authoring preserves null keys and no-scoring completion', async () => {
    await navigate(); await click('Host a Quiz');
    await evaluate(`(() => {const select=[...document.querySelectorAll('select')].find(e=>e.querySelector('option[value="survey"]')); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,'survey'); select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.equal(await evaluate('document.querySelectorAll(\'input[type="radio"]\').length'), 0);
    await input('#quiz-title', 'Team Survey'); await input('#question-0', 'How was the session?');
    for (const [i, option] of ['Great', 'Good', 'Okay', 'Needs work'].entries()) await input(`#option-0-${i}`, option);
    await click('Create & Open Lobby'); await until('!!document.querySelector(".host-lobby")');
    const request = await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="create")');
    assert.equal(request.draft.mode, 'survey'); assert.equal(request.draft.questions[0].correctIndex, null);
    await phase('reveal'); assert.equal(await evaluate('document.querySelector(".reveal-screen").textContent.includes("Correct Answer")'), false);
    await phase('finished'); assert.equal(await evaluate('!!document.querySelector(".podium")'), false);
    await screenshot('light-mobile-survey-finished');
  });
  await check('public warning requires acknowledgement and creator cannot see publisher admin', async () => {
    await navigate('?fixture=creator&guests=on'); await click('Host a Quiz');
    assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Publisher controls")'), false);
    await evaluate(`(() => {const select=[...document.querySelectorAll('select')].find(e=>e.querySelector('option[value="public"]')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'public'); select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    assert.ok(await evaluate('document.querySelector(".warning").textContent.includes("all questions and response options accessible to anyone")'));
    assert.equal(await evaluate('document.querySelector(\'button[type="submit"]\').disabled'), true);
    await screenshot('light-mobile-public-warning');
  });
  await check('signed-out join preserves Entra gesture and hides host/admin capabilities', async () => {
    await navigate('?fixture=signed-out&quiz=test-session');
    assert.equal(await evaluate('!!document.querySelector("#nickname")'), true);
    assert.equal(await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Join as anonymous guest")'), false);
    await click('Sign in to attend'); await until('[...document.querySelectorAll("button")].some(e=>e.textContent==="Join Game")');
  });
  await check('guest-enabled fixture offers scoped anonymous join without author access', async () => {
    await navigate('?fixture=signed-out&guests=on&quiz=test-session'); await input('#nickname', 'Guest');
    await click('Join as anonymous guest'); await until('!!document.querySelector(".attendee-lobby")');
    assert.equal(await evaluate('window.__quizcrowdFixture.requests.findLast(r=>r.command==="join").asGuest'), true);
  });
  await check('320px width and reduced motion remain usable', async () => {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: false }, session);
    await navigate('?fixture=admin'); await inspectScreen('light-320-home');
    assert.equal(await evaluate('getComputedStyle(document.body).animationName'), 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".shapes-wrapper span")).animationName'), 'none');
  });
  await check('explicit theme selection is keyboard-operable without a system mode', async () => {
    await evaluate('document.querySelector(\'[aria-label="Color theme"] button:first-child\').focus()');
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await until('document.documentElement.dataset.theme === "dark"');
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
