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
  renderEditor(draft?: Partial<Draft>, anonymousEnabled?: boolean, readOnly?: boolean, editing?: boolean, session?: { joinUnavailableReason?: string; busy?: boolean }): string;
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
        export function renderEditor(patch = {}, anonymousEnabled = false, readOnly = false, editing = false, session) {
          return renderToStaticMarkup(h(AuthorEditor, {draft:{...blankDraft(),...patch},onChange:noop,editing,anonymousEnabled,readOnly,busy:session?.busy ?? false,onSave:noop,onBack:noop,onHost:session ? noop : undefined,onJoin:session ? noop : undefined,joinUnavailableReason:session?.joinUnavailableReason}));
        }
        export function renderGame(game, host = false) {
          return renderToStaticMarkup(h(GameScreen,{game,host,guest:false,nickname:'Alex',joinUrl:'https://test.invalid/?quiz=game',busy:false,onControl:noop,onAnswer:noop,onSurveyAnswer:noop,onHome:noop,onCopyError:noop}));
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
  it('keeps owner lobby controls and adds normal attendee navigation only to read-only sessions', () => {
    for (const mode of ['quiz', 'survey'] as const) {
      const owner = ui.renderEditor({ mode }, false, true, true, {});
      expect(owner).toContain('Join As Attendee</button>');
      expect(owner).toContain('Open Lobby</button>');
      expect(owner).toContain('class="author-session-actions"');
      expect(ui.renderEditor({ mode }, false, false, true, {})).not.toContain('Join As Attendee');
      expect(ui.renderEditor({ mode }, false, true, true)).not.toContain('Join As Attendee');
      for (const joinUnavailableReason of ['This session has finished.', 'This session does not allow late joins.']) {
        const closed = ui.renderEditor({ mode }, false, true, true, { joinUnavailableReason });
        expect(closed).toContain('disabled="" aria-describedby="attendee-join-reason"');
        expect(closed).toContain(`id="attendee-join-reason" class="muted small attendee-join-reason">${joinUnavailableReason}`);
        expect(closed).toContain('class="primary"><svg');
      }
      expect(ui.renderEditor({ mode }, false, true, true, { busy: true })).toContain('class="subtle" disabled=""');
    }
  });
  it('gives all ten filled answer colors white-compatible palettes independently of podium and editor text', async () => {
    const css = await readFile(new URL('../packages/frontend/src/global.css', import.meta.url), 'utf8');
    expect(css).toContain('--qc-answer-fg: #ffffff;');
    expect(css).toContain('color: var(--qc-answer-fg)');
    expect(css).toContain('--qc-option-fg: #101426;');
    expect(css).not.toContain('filter: brightness(1.08)');
    expect(css).toContain('button.answer:disabled { opacity: 1;');
    for (let index = 0; index < 10; index++) {
      const token = css.match(new RegExp(`\\.answer-${index} \\{ background: var\\((--qc-answer-\\d)\\); \\}`))?.[1];
      expect(token).toBeDefined();
      const hex = css.match(new RegExp(`${token}: #([0-9a-f]{6});`))?.[1];
      expect(hex).toBeDefined();
      const rgb = hex!.match(/../g)!.map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      const luminance = .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
      expect(1.05 / (luminance + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('uses filled square/circle/triangle/square shapes with a secondary final square and an accessible brand', () => {
    const brand = ui.renderBrand();
    expect(brand).toContain('aria-label="QuizCrowd home"');
    expect(brand).toContain('class="brand-wordmark"><span>Quiz</span><span>Crowd</span>');
    expect(brand).toContain('viewBox="0 0 24 24"');
    expect(brand).toContain('aria-hidden="true" focusable="false"');
    expect(brand.match(/<rect /g)).toHaveLength(2);
    expect(brand).toContain('<circle cx="18" cy="6" r="4">');
    expect(brand).toContain('<path d="M6 13 11 22H1Z">');
    expect(brand).not.toContain('fill="none"');
    expect(brand).toContain('class="brand-secondary"');
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
      expect(ui.renderEditor(draft).split(`d="${path}"`).length - 1).toBe(1);
    }
  });
  it('keeps the join preview out of the UI, the footer minimal and secondary text white', async () => {
    const app = await readFile(new URL('../packages/frontend/src/App.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../packages/frontend/src/global.css', import.meta.url), 'utf8');
    expect(app).not.toContain('View questions');
    expect(app).not.toContain("command: 'preview'");
    expect(app).toContain('<AppFooter />');
    const footer = await readFile(new URL('../packages/frontend/src/components/AppFooter.tsx', import.meta.url), 'utf8');
    expect(footer).toContain('QuizCrowd for Microsoft Fabric');
    expect(footer).toContain('About QuizCrowd');
    expect(footer).toContain('source code is available on');
    expect(footer).not.toContain('fully open source');
    expect(css).toContain('--qc-secondary-fg: #ffffff');
    expect(css).not.toContain('--qc-secondary-fg: #281326');
  });
  it('renders host QR invitation only in the lobby and disables empty-game start', () => {
    const lobby = ui.renderGame({ ...game, players: [] }, true);
    expect(lobby).toContain('Waiting for Users');
    expect(lobby).toContain('Share this code with attendees');
    expect(lobby).toContain('0 attendees joined');
    expect(lobby).toContain('class="game-context muted small">Source parity quiz</p>');
    expect(lobby).toContain('<svg');
    expect(lobby).toMatch(/disabled=""[^>]*>Start Quiz/);
    expect(ui.renderGame({ ...game, mode: 'survey' }, true)).toContain('Start Survey');
    expect(ui.renderGame(game, true)).toContain('1 attendee joined');
    expect(ui.renderGame({ ...game, players: ['Alex', 'Sam'] }, true)).toContain('2 attendees joined');
    expect(ui.renderGame({ ...game, phase: 'leaderboard', rankings: [] }, true)).not.toContain('Scan to join');
  });
  it('uses the distinct attendee waiting screen without host invitation/control', () => {
    const lobby = ui.renderGame(game);
    expect(lobby).toContain('Waiting for host');
    expect(lobby).not.toContain('Start Quiz');
    expect(lobby).not.toContain('Start Survey');
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
    expect(editor).toContain('Anonymous response, no sign-in required.');
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
    if (readOnly) expect(hint).toBe(-1);
    else expect(hint).toBeGreaterThan(quiz.indexOf('class="option-editor-grid"'));
    if (!readOnly) {
      expect(quiz).toContain('Add option</button>');
      expect(hint).toBeLessThan(quiz.indexOf('Add option</button>'));
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
    expect(locked).toContain('Customize each question');
    expect(locked).not.toContain('custom-duration-help');
    expect(locked).toContain('class="author-content" disabled=""');
  });
  it('places the submit action before content and settings, leaving only Add Question at the bottom', () => {
    const create = ui.renderEditor();
    expect(create.indexOf('class="author-submit"')).toBeLessThan(create.indexOf('class="author-content"'));
    expect(create).toContain('Create &amp; Open Lobby');
    expect(create.match(/type="submit"/g)).toHaveLength(1);
    expect(create).toMatch(/class="editor-actions"><button[^>]+>[\s\S]*?Add Question<\/button><\/div>/);
    expect(ui.renderEditor({}, false, false, true)).toContain('Save &amp; Open Lobby');
    expect(ui.renderEditor({}, false, true, true)).not.toContain('author-submit');
  });
  it('shows survey aggregate summaries instead of rankings, with explicit ties, private text and empty cases', () => {
    const surveyResults = [
      { questionIndex: 0, text: 'Pick topics', responseCount: 2, mostSelected: [{ label: 'A', count: 1 }, { label: 'B', count: 1 }], writtenCount: 0, textOnly: false },
      { questionIndex: 1, text: 'Written feedback', responseCount: 1, mostSelected: [], writtenCount: 1, textOnly: true },
      { questionIndex: 2, text: 'Skipped question', responseCount: 0, mostSelected: [], writtenCount: 0, textOnly: false },
    ];
    for (const phase of ['leaderboard', 'finished'] as const) {
      const html = ui.renderGame({ ...game, mode: 'survey', phase, surveyResults, rankings: [{ nickname: 'Never rank this name', score: 900, streak: 3, rank: 1 }] });
      for (const expected of ['Most selected answers (tie)', 'Written response text is private.', 'No responses collected.', 'Pick topics', 'Written feedback', 'Skipped question']) expect(html).toContain(expected);
      for (const forbidden of ['Never rank this name', ' pts', 'class="podium"', '📊 Leaderboard']) expect(html).not.toContain(forbidden);
    }
    expect(ui.renderGame({ ...game, mode: 'survey', phase: 'reveal' })).toContain('Results coming up...');
    expect(ui.renderGame({ ...game, mode: 'survey' }, true)).toContain('Scan to join this survey');
  });
  it('adjusts selected answer indices when removing an option without changing survey nulls', () => {
    const question = { text: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 2, duration: 20 };
    expect(ui.removeOption(question, 0).correctIndex).toBe(1);
    expect(ui.removeOption(question, 2).correctIndex).toBeNull();
    expect(ui.removeOption({ ...question, correctIndex: null }, 0).correctIndex).toBeNull();
  });
  it('offers a Survey type menu and optional Other in Single and Multiple, preserving text-only removal', () => {
    expect(ui.renderEditor()).not.toContain('Allow multiple');
    expect(ui.renderEditor()).not.toContain('Add Other');
    const single = ui.renderEditor({ mode: 'survey' });
    expect(single).toContain('Single Select');
    expect(single).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(single).toContain('Add Other');
    expect(ui.renderEditor({ mode: 'survey', questions: [{ text: 'Q', options: ['A', 'B'], correctIndex: null, duration: 20, survey: { other: false, allowMultiple: true } }] })).toContain('Add Other');
    const question: Question = { text: 'Write feedback', options: ['A'], correctIndex: null, duration: 20, survey: { other: true, allowMultiple: true } };
    const onlyOther = ui.removeOption(question, 0);
    expect(onlyOther).toMatchObject({ options: [], correctIndex: null, survey: { other: true, allowMultiple: false } });
    const editor = ui.renderEditor({ mode: 'survey', questions: [onlyOther] });
    expect(editor).toContain('aria-label="Question 1 response type: Free Text"');
    expect(editor).toContain('class="question-type question-popover-trigger" value="text"');
    expect(editor).not.toContain('Add Other');
    expect(editor).not.toContain('class="other-option"');
    expect(editor).not.toContain('Add option</button>');
    expect(ui.renderEditor({ mode: 'survey', questions: [onlyOther] }, false, true)).toContain('class="author-content" disabled=""');
  });
  it('groups question controls on the right and shows a borderless Survey-only menu trigger', () => {
    const quiz = ui.renderEditor({ answerDuration: { mode: 'custom', seconds: 20 } });
    expect(quiz).toContain('class="question-duration question-popover-trigger"');
    expect(quiz).toContain('aria-label="Question 1 duration in seconds: 20" aria-haspopup="dialog" aria-expanded="false"');
    expect(quiz).toMatch(/class="question-duration question-popover-trigger"[^>]*><svg[^]*?<\/svg><span>20s<\/span>/);
    expect(quiz).toContain('role="dialog" aria-label="Question 1 duration in seconds" hidden=""');
    expect(quiz).not.toContain('class="question-type ');
    const survey = ui.renderEditor({ mode: 'survey' });
    expect(survey).toContain('class="question-type question-popover-trigger" value="single"');
    expect(survey).toMatch(/class="question-type question-popover-trigger"[^>]*><svg[^]*?<\/svg><span>Single Select<\/span>/);
    expect(survey).not.toContain('<select class="question-type"');
    expect(survey).not.toContain('question-settings');
    expect(survey).not.toContain('name="survey-type-0" type="radio"');
    expect(survey).toContain('<h2 id="settings-heading">');
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
  it('defaults to light without consulting system or URL', async () => {
    expect((await bootstrap(null)).theme).toBe('light');
    expect((await bootstrap('system')).theme).toBe('light');
    expect((await bootstrap('arbitrary')).theme).toBe('light');
  });
  it('restores exactly the explicit dark/light preference before React loads', async () => {
    expect((await bootstrap('light')).theme).toBe('light');
    expect((await bootstrap('dark')).theme).toBe('dark');
  });
  it('flags unavailable storage while still rendering light', async () => {
    expect(await bootstrap(null, true)).toEqual({ theme: 'light', dataset: { themeStorage: 'unavailable' } });
  });
});
