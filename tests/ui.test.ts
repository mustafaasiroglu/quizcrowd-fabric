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
  renderEditor(draft?: Partial<Draft>, anonymousEnabled?: boolean, readOnly?: boolean, editing?: boolean): string;
  removeOption(question: Question, index: number): Question;
  renderIcon(): string;
  renderBrand(): string;
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
        import { Icon } from './src/components/Icon';
        import { Brand } from './src/components/Brand';
        export { removeOption };
        const noop = () => {};
        export function renderIcon() { return renderToStaticMarkup(h(Icon, {name:'settings'})); }
        export function renderBrand() { return renderToStaticMarkup(h(Brand, {onHome:noop})); }
        export function renderEditor(patch = {}, anonymousEnabled = false, readOnly = false, editing = false) {
          return renderToStaticMarkup(h(AuthorEditor, {draft:{...blankDraft(),...patch},onChange:noop,editing,anonymousEnabled,readOnly,busy:false,onSave:noop,onBack:noop}));
        }
        export function renderGame(game, host = false) {
          return renderToStaticMarkup(h(GameScreen,{game,host,guest:false,nickname:'Alex',seconds:10,joinUrl:'https://test.invalid/?quiz=game',busy:false,onControl:noop,onAnswer:noop,onSurveyAnswer:noop,onHome:noop,onCopyError:noop}));
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
  it('uses an original four-tile monochrome mark with one outlined tile and an accessible home brand', () => {
    const brand = ui.renderBrand();
    expect(brand).toContain('aria-label="QuizCrowd home"');
    expect(brand).toContain('class="brand-wordmark"><span>Quiz</span><span>Crowd</span>');
    expect(brand).toContain('viewBox="0 0 24 24"');
    expect(brand).toContain('aria-hidden="true" focusable="false"');
    expect(brand.match(/<rect /g)).toHaveLength(4);
    expect(brand.match(/fill="none"/g)).toHaveLength(1);
    expect(brand).toContain('stroke="currentColor" stroke-width="2"');
  });
  it('reuses the compact clock/value/s control and associates indented custom-duration help', () => {
    const shared = ui.renderEditor();
    expect(shared).toContain('class="duration" for="shared-duration"');
    expect(shared).toContain('<span aria-hidden="true">s</span>');
    expect(shared).not.toContain('class="global-duration"');
    expect(shared).not.toContain('>seconds</span>');
    const custom = ui.renderEditor({ answerDuration: { mode: 'custom', seconds: 20 } });
    expect(custom).toContain('aria-describedby="custom-duration-help"');
    expect(custom).toContain('id="custom-duration-help" class="small muted option-help"');
    expect(custom).toContain('Question 1 duration in seconds');
  });
  it('shares one closed gear outline and independently centered ring without changing icon presentation', () => {
    const icon = ui.renderIcon();
    expect(icon).toContain('class="icon"');
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).toContain('fill="none"');
    expect(icon).toContain('viewBox="0 0 24 24"');
    expect(icon).toContain('stroke="currentColor"');
    expect(icon).toContain('stroke-width="2"');
    const path = icon.match(/ d="([^"]+)"/)?.[1];
    expect(path).toContain('ZM15 12');
    expect(path?.match(/M/g)).toHaveLength(2);
    for (const draft of [{}, { mode: 'survey' as const }]) {
      expect(ui.renderEditor(draft).split(`d="${path}"`).length - 1).toBe(draft.mode === 'survey' ? 2 : 1);
    }
  });
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
    expect(editor).toMatch(/disabled=""[^>]*value="public"/);
    expect(editor).toContain('Only people in my organization');
    expect(ui.renderEditor({ visibility: 'public' }, true)).toContain('all questions and response options accessible to anyone');
    expect(ui.renderEditor({ visibility: 'public' }, true)).toContain('I understand and choose public access.');
  });
  it.each([
    ['quiz', false], ['quiz', true], ['survey', false], ['survey', true],
  ] as const)('uses the exact ordered audience copy in %s, readonly=%s', (mode, readOnly) => {
    const editor = ui.renderEditor({ mode }, false, readOnly);
    expect(editor.indexOf('Only people in my organization')).toBeLessThan(editor.indexOf('Anyone with link'));
    expect(editor).toContain('Anyone with link (disabled by admin)');
    expect(editor).not.toContain('Public attendance is disabled by the publisher.');
    expect(ui.renderEditor({ mode }, true, readOnly)).not.toContain('Anyone with link (disabled by admin)');
    expect(editor).toContain('Requires sign-in with organization account');
    expect(editor).toContain('Anonymous response, doesn&#x27;t require sign-in');
    expect(editor).toMatch(/<input(?=[^>]*name="audience")(?=[^>]*value="internal")(?=[^>]*checked="")[^>]*>/);
    expect(editor).toMatch(/<input(?=[^>]*name="audience")(?=[^>]*value="public")(?=[^>]*disabled="")[^>]*>/);
  });
  it('uses native keyboard-accessible answer radios and omits them for surveys', () => {
    expect(ui.renderEditor()).toContain('type="radio"');
    expect(ui.renderEditor({ mode: 'survey' })).not.toContain('correct option');
    expect(ui.renderEditor({ mode: 'survey' })).not.toContain('answer-reveal-settings');
  });
  it('renders the Forms-style settings sidebar and started-session read-only state', () => {
    const editable = ui.renderEditor();
    expect(editable).toContain('author-layout');
    expect(editable).toContain('settings-panel');
    expect(editable).not.toContain('Content Type');
    expect(editable.indexOf('Who can respond?')).toBeLessThan(editable.indexOf('Answer duration'));
    expect(editable).not.toContain('value="quiz"');
    expect(editable).toContain('Same for all questions');
    expect(editable).toContain('id="shared-duration"');
    expect(editable.slice(0, editable.indexOf('<aside'))).not.toContain('class="duration"');
    expect(editable).toContain('<legend>Answer duration</legend>');
    const custom = ui.renderEditor({ answerDuration: { mode: 'custom', seconds: 20 }, questions: [20, 35].map(duration => ({ text: 'Question', options: ['A', 'B'], correctIndex: 0, duration })) });
    expect(custom).toContain('class="duration"');
    expect(custom).not.toContain('id="shared-duration"');
    const locked = ui.renderEditor({}, false, true);
    expect(locked).toContain('Read-only:');
    expect(locked).toContain('class="author-content" disabled=""');
    expect(locked).not.toContain('Save &amp; Open Lobby');
    expect(locked).not.toContain('Remove question');
  });
  it('uses visible native radio groups for late joins and answer reveal, preserving checked and disabled state', () => {
    const editable = ui.renderEditor({ lateJoin: true, showAnswer: 'never' });
    expect(editable).not.toContain('<select');
    expect(editable).toContain('class="shared-duration-choice"');
    expect(editable).toContain('Duration in seconds for all questions');
    expect(editable.match(/class="settings-group"/g)).toHaveLength(4);
    for (const [name, value] of [['late-join', 'allow'], ['answer-reveal', 'never']]) {
      expect(editable).toMatch(new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*value="${value}")(?=[^>]*checked="")[^>]*>`));
    }
    expect(ui.renderEditor({ mode: 'survey' })).not.toContain('answer-reveal-settings');
    const readonly = ui.renderEditor({ lateJoin: true, showAnswer: 'after_response' }, true, true);
    expect(readonly).toContain('class="author-content" disabled=""');
    expect(readonly).toMatch(/<input(?=[^>]*name="answer-reveal")(?=[^>]*value="after_response")(?=[^>]*checked="")[^>]*>/);
  });
  it.each([[false, false], [true, false], [true, true]])('keeps sentence-case quiz settings and post-option help, editing=%s readonly=%s', (editing, readOnly) => {
    const questions = [{ text: 'Question', options: ['A', 'B', 'C'], correctIndex: 0, duration: 20 }];
    const quiz = ui.renderEditor({ questions }, false, readOnly, editing);
    for (const text of ['Allow late joins?', 'Don&#x27;t allow late join', 'Allow join after game start', 'Show correct answers?', 'Wait for all users', 'Show after user response', 'Never show']) {
      expect(quiz).toContain(text);
    }
    expect(quiz).toContain('answer-reveal-settings');
    const hint = quiz.indexOf('Select the circle beside the correct answer.');
    expect(hint).toBeGreaterThan(quiz.indexOf('class="option-editor-grid"'));
    if (!readOnly) {
      expect(quiz).toContain('Add option</button>');
      expect(hint).toBeGreaterThan(quiz.indexOf('Add option</button>'));
    }
    const survey = ui.renderEditor({ mode: 'survey', questions: questions.map(q => ({ ...q, correctIndex: null })) }, false, readOnly, editing);
    expect(survey).not.toContain('answer-reveal-settings');
    expect(survey).not.toContain('Show correct answers?');
    expect(survey).not.toContain('Disabled for surveys');
    expect(survey).not.toContain('Select the circle beside the correct answer.');
    expect(survey.match(/class="settings-group"/g)).toHaveLength(3);
  });
  it('keeps equal-valued custom mode selected and visible in read-only views', () => {
    const locked = ui.renderEditor({ answerDuration: { mode: 'custom', seconds: 35 },
      questions: [35, 35].map(duration => ({ text: 'Question', options: ['A', 'B'], correctIndex: 0, duration })) }, false, true);
    expect(locked).toMatch(/<input(?=[^>]*name="answer-duration")(?=[^>]*value="custom")(?=[^>]*checked="")[^>]*>/);
    expect(locked.match(/class="duration"/g)).toHaveLength(2);
    expect(locked).not.toContain('id="shared-duration"');
    expect(locked).toContain('class="author-content" disabled=""');
  });
  it('adjusts selected answer indices when removing an option without changing survey nulls', () => {
    const question = { text: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 2, duration: 20 };
    expect(ui.removeOption(question, 0).correctIndex).toBe(1);
    expect(ui.removeOption(question, 2).correctIndex).toBeNull();
    expect(ui.removeOption({ ...question, correctIndex: null }, 0).correctIndex).toBeNull();
  });
  it('offers three Survey types and Other only for multiple choices, normalizing the last option removal', () => {
    expect(ui.renderEditor()).not.toContain('Allow multiple');
    expect(ui.renderEditor()).not.toContain('Add Other');
    const single = ui.renderEditor({ mode: 'survey' });
    for (const label of ['Single Select', 'Multiple Select', 'Free Text']) expect(single).toContain(label);
    expect(single).not.toContain('Add Other');
    expect(ui.renderEditor({ mode: 'survey', questions: [{ text: 'Q', options: ['A', 'B'], correctIndex: null, duration: 20, survey: { other: false, allowMultiple: true } }] })).toContain('Add Other');
    const question: Question = { text: 'Write feedback', options: ['A'], correctIndex: null, duration: 20, survey: { other: true, allowMultiple: true } };
    const onlyOther = ui.removeOption(question, 0);
    expect(onlyOther).toMatchObject({ options: [], correctIndex: null, survey: { other: true, allowMultiple: false } });
    const editor = ui.renderEditor({ mode: 'survey', questions: [onlyOther] });
    expect(editor).toContain('Question 1 settings');
    expect(editor).toMatch(/<input(?=[^>]*name="survey-type-0")(?=[^>]*value="text")(?=[^>]*checked="")[^>]*>/);
    expect(editor).not.toContain('Add Other');
    expect(editor).not.toContain('class="other-option"');
    expect(editor).not.toContain('Add option</button>');
    expect(ui.renderEditor({ mode: 'survey', questions: [onlyOther] }, false, true)).toContain('class="author-content" disabled=""');
  });
  it('renders accessible survey radios/checkboxes and Other-only input without a visible Other label', () => {
    const question: Question = { text: 'Feedback', options: ['A', 'B'], correctIndex: null, duration: 20, survey: { other: true, allowMultiple: false } };
    const normal = ui.renderGame({ ...game, mode: 'survey', phase: 'question', question });
    expect(normal.match(/type="radio"/g)).toHaveLength(3);
    expect(normal).toContain('Submit response');
    const multi = ui.renderGame({ ...game, mode: 'survey', phase: 'question', question: { ...question, survey: { other: true, allowMultiple: true } } });
    expect(multi.match(/type="checkbox"/g)).toHaveLength(3);
    expect(multi).toContain('Choose all that apply');
    const only = ui.renderGame({ ...game, mode: 'survey', phase: 'question', question: { ...question, options: [] } });
    expect(only).toContain('Your response');
    expect(only).toContain('maxLength="500"');
    expect(only).not.toContain('>Other<');
    expect(only).not.toContain('Your Other response');
    expect(only).not.toContain('type="radio"');
    expect(ui.renderGame({ ...game, mode: 'survey', phase: 'question', question, myResponse: { options: [], other: 'Private text' } })).toContain('Answer submitted!');
    expect(ui.renderGame({ ...game, mode: 'survey', phase: 'reveal', question, distribution: [2, 1], otherCount: 3 })).toContain('3 responses');
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
