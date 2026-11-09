import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Draft, GameView, Question } from '../packages/shared/src/index';

const game: GameView = {
  id: 'test-game', code: 'A1B2C3D4E5', title: 'Source parity quiz', mode: 'quiz', phase: 'lobby', version: 3,
  questionIndex: 0, totalQuestions: 2, serverNow: 1, players: ['Alex'], answerCount: 0,
};
let ui: {
  renderGame(game: GameView, host?: boolean): string;
  renderEditor(draft?: Partial<Draft>, anonymousEnabled?: boolean): string;
  removeOption(question: Question, index: number): Question;
};
beforeAll(async () => {
  const entry = 'virtual:quizcrowd-ui-regression';
  const result = await build({
    root: fileURLToPath(new URL('../packages/frontend', import.meta.url)),
    configFile: fileURLToPath(new URL('../packages/frontend/vite.config.ts', import.meta.url)),
    logLevel: 'silent', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    oxc: { jsx: { development: false } },
    plugins: [{
      name: 'quizcrowd-ui-regression',
      resolveId: (id) => id.endsWith(entry) ? `\0${entry}` : undefined,
      load: (id) => id === `\0${entry}` ? `
        import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server.browser';
        import { AuthorEditor, blankDraft, removeOption } from './src/components/AuthorEditor';
        import { GameScreen } from './src/components/GameScreen';
        export { removeOption };
        const noop = () => {};
        export function renderEditor(patch = {}, anonymousEnabled = false) {
          return renderToStaticMarkup(h(AuthorEditor, {draft:{...blankDraft(),...patch},onChange:noop,editing:false,anonymousEnabled,busy:false,onSave:noop,onBack:noop,onLibrary:noop}));
        }
        export function renderGame(game, host = false) {
          return renderToStaticMarkup(h(GameScreen,{game,host,guest:false,nickname:'Alex',seconds:10,joinUrl:'https://test.invalid/?quiz=game',busy:false,onControl:noop,onAnswer:noop,onHome:noop,onCopyError:noop}));
        }
      ` : undefined,
    }],
    build: { write: false, minify: false, lib: { entry, name: 'QuizCrowdUI', formats: ['iife'], fileName: () => 'ui.js' } },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !('output' in bundle)) throw new Error('Expected production UI bundle.');
  const chunk = bundle.output.find((output) => output.type === 'chunk');
  if (!chunk) throw new Error('Expected production UI chunk.');
  const scope = { TextEncoder, TextDecoder, MessageChannel, ReadableStream, setTimeout, clearTimeout, QuizCrowdUI: undefined as typeof ui | undefined };
  runInNewContext(chunk.code, scope);
  if (!scope.QuizCrowdUI) throw new Error('UI render exports missing.');
  ui = scope.QuizCrowdUI;
}, 20000);

describe('original QuizCrowd screen structure with Fabric authorization controls', () => {
  it('keeps the join preview out of the UI, the footer minimal and secondary text white', async () => {
    const app = await readFile(new URL('../packages/frontend/src/App.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../packages/frontend/src/global.css', import.meta.url), 'utf8');
    expect(app).not.toContain('View questions');
    expect(app).not.toContain("command: 'preview'");
    expect(app).toContain('<footer>QuizCrowd for Microsoft Fabric</footer>');
    expect(css).toContain('--qc-secondary-fg: #ffffff');
    expect(css).not.toContain('--qc-secondary-fg: #281326');
  });
  it('renders host QR invitation only in the lobby and disables empty-game start', () => {
    const lobby = ui.renderGame({ ...game, players: [] }, true);
    expect(lobby).toContain('Session Lobby');
    expect(lobby).toContain('<svg');
    expect(lobby).toMatch(/disabled=""[^>]*>Start Game/);
    expect(ui.renderGame({ ...game, phase: 'leaderboard', rankings: [] }, true)).not.toContain('Scan to join');
  });
  it('uses the distinct attendee waiting screen without host invitation/control', () => {
    const lobby = ui.renderGame(game);
    expect(lobby).toContain('Waiting for host');
    expect(lobby).not.toContain('Start Game');
    expect(lobby).not.toContain('Copy invite');
  });
  it('never fabricates an answer key or score while wait_all is open', () => {
    const submitted = ui.renderGame({ ...game, phase: 'question', myOption: 0, question: { text: 'Question', options: ['A', 'B'], duration: 20 } });
    expect(submitted).toContain('Answer submitted!');
    expect(submitted).not.toContain('Correct Answer');
    expect(submitted).not.toContain('pts');
    expect(submitted).not.toContain('onClick');
  });
  it('renders the supplied after_response key/result and keeps host answers noninteractive', () => {
    const question = { ...game, phase: 'question' as const, question: { text: 'Question', options: ['A', 'B'], duration: 20 } };
    expect(ui.renderGame({ ...question, myOption: 0, correctIndex: 0, myResult: { correct: true, points: 1400, score: 1400 } })).toContain('+1400 pts');
    expect(ui.renderGame(question, true)).toContain('<div class="answer answer-0">');
    expect(ui.renderGame(question)).toContain('<button class="answer answer-0"');
  });
  it('preserves no-key reveal and survey distribution without announcing correctness', () => {
    const reveal = ui.renderGame({ ...game, mode: 'survey', phase: 'reveal', question: { text: 'Survey', options: ['A', 'B'], duration: 20 }, distribution: [2, 1] });
    expect(reveal).toContain('Responses are in!');
    expect(reveal).toContain('2 responses');
    expect(reveal).not.toContain('Correct Answer');
  });
  it('renders podium order by actual ranks, including a single winner', () => {
    const ranks = [1, 2, 3].map((rank) => ({ nickname: `Player${rank}`, rank, score: 1000, streak: 1 }));
    const podium = ui.renderGame({ ...game, phase: 'finished', rankings: ranks });
    expect(podium.indexOf('Player2')).toBeLessThan(podium.indexOf('Player1'));
    expect(podium.indexOf('Player1')).toBeLessThan(podium.indexOf('Player3'));
    expect(ui.renderGame({ ...game, phase: 'finished', rankings: [ranks[0]!] })).toContain('podium-entry place-1');
  });
  it('retains explicit public acknowledgement and publisher-off disabling', () => {
    const editor = ui.renderEditor();
    expect(editor).toContain('value="public" disabled=""');
    expect(editor).toContain('Internal Only');
    expect(ui.renderEditor({ visibility: 'public' }, true)).toContain('all questions and response options accessible to anyone');
    expect(ui.renderEditor({ visibility: 'public' }, true)).toContain('I understand and choose public access.');
  });
  it('uses native keyboard-accessible answer radios and omits them for surveys', () => {
    expect(ui.renderEditor()).toContain('type="radio"');
    expect(ui.renderEditor({ mode: 'survey' })).not.toContain('type="radio"');
  });
  it('adjusts selected answer indices when removing an option without changing survey nulls', () => {
    const question = { text: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 2, duration: 20 };
    expect(ui.removeOption(question, 0).correctIndex).toBe(1);
    expect(ui.removeOption(question, 2).correctIndex).toBeNull();
    expect(ui.removeOption({ ...question, correctIndex: null }, 0).correctIndex).toBeNull();
  });
});

describe('pre-render two-theme bootstrap', () => {
  it('retains the source-derived dark palette, card sizes and reduced-motion escape', async () => {
    const css = await readFile(new URL('../packages/frontend/src/global.css', import.meta.url), 'utf8');
    for (const token of ['--qc-bg: #1a1a2e', '--qc-bg-two: #16213e', '--qc-bg-three: #0f3460', '--qc-bg-four: #2d1b69', '--qc-primary: #6c63ff', '--qc-secondary: #ff6584', '--qc-success: #43e97b']) expect(css).toContain(token);
    expect(css).toContain('.lobby.host-lobby { max-width: 448px; }');
    expect(css).toContain('.question-screen { max-width: 672px; }');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toContain('prefers-color-scheme');
  });
  async function bootstrap(saved: string | null, unavailable = false) {
    const html = await readFile(new URL('../packages/frontend/index.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('Theme bootstrap script missing.');
    const attributes: Record<string, string> = {};
    const dataset: Record<string, string> = {};
    runInNewContext(script, {
      document: { documentElement: { dataset, setAttribute(name: string, value: string) { attributes[name] = value; } } },
      localStorage: { getItem() { if (unavailable) throw new Error('Blocked storage'); return saved; } },
    });
    return { theme: attributes['data-theme'], dataset };
  }
  it('defaults to the original dark theme without consulting system or URL', async () => {
    expect((await bootstrap(null)).theme).toBe('dark');
    expect((await bootstrap('system')).theme).toBe('dark');
    expect((await bootstrap('arbitrary')).theme).toBe('dark');
  });
  it('restores exactly the explicit dark/light preference before React loads', async () => {
    expect((await bootstrap('light')).theme).toBe('light');
    expect((await bootstrap('dark')).theme).toBe('dark');
  });
  it('flags unavailable storage while still rendering dark', async () => {
    expect(await bootstrap(null, true)).toEqual({ theme: 'dark', dataset: { themeStorage: 'unavailable' } });
  });
});
