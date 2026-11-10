// This module replaces the connection module only in the isolated UI test server.
import { copyTitle } from '@rayfin-app/shared';

const parameters = new URLSearchParams(location.search);
const previous = JSON.parse(sessionStorage.getItem('quizcrowd-test-fixture') ?? 'null');
const requestedExample = parameters.get('example');
const example = ['survey-multiple', 'survey-single', 'survey-other-only', 'survey-legacy-single-other', 'quiz-ten', 'survey-ten', 'survey-results'].includes(requestedExample) ? requestedExample : previous?.example;
const stored = requestedExample && example !== previous?.example ? null : previous;
let authenticated = stored?.authenticated ?? parameters.get('fixture') !== 'signed-out';
const admin = stored?.admin ?? parameters.get('fixture') !== 'creator';
const owner = stored?.owner ?? parameters.get('owner') !== 'other';
const gameId = '11111111-2222-4333-8444-555555555555';
let activeId = stored?.activeId ?? gameId;
const records = new Map(stored?.records ?? []);
const listeners = new Set();
const settings = stored?.settings ?? { anonymousEnabled: parameters.get('guests') === 'on', guestEpoch: 0, isAdmin: admin };
const requests = [];
const deferred = new Map();
const draft = {
  title: 'Friday Team Quiz', mode: 'quiz', visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all',
  questions: [
    { text: 'Where does QuizCrowd store your quiz data?', options: ['Fabric SQL', 'Browser storage', 'A shared file', 'In memory'], correctIndex: 0, duration: 60 },
    { text: 'Ready for another round?', options: ['Absolutely', 'One more!'], correctIndex: 0, duration: 30 },
  ],
};
let currentDraft = structuredClone(draft);
let deleted = false;
let currentCode = '000123';
let createdAt = stored?.createdAt ?? 1794214800000;
let phase = 'lobby';
let questionStartedAt = 0;
let questionIndex = 0;
let myOption;
let myResponse;
let surveyAnswers = {};
let version = 1;
const players = ['Alex', 'Sam', 'Taylor', 'Jordan'];
if (!stored && example === 'survey-results') {
  currentCode = '600123';
  currentDraft = { ...draft, title: 'Survey results demo', mode: 'survey', lateJoin: true, questions: [
    { text: 'Which topics should we include?', options: ['Product sessions', 'Workshops'], correctIndex: null, duration: 120, survey: { other: true, allowMultiple: true } },
    { text: 'Share your feedback', options: [], correctIndex: null, duration: 120, survey: { other: true, allowMultiple: false } },
    { text: 'Which time works best?', options: ['Morning', 'Afternoon'], correctIndex: null, duration: 120 },
  ] };
  surveyAnswers = { 0: { options: [0,1] }, 1: { options: [], other: 'Private fixture text - never render in summaries' } };
  phase = 'finished'; questionIndex = 2;
} else if (!stored && example?.endsWith('-ten')) {
  currentCode = '600123'; // Fixed checksum-valid test invitation, not the production random generator.
  const survey = example === 'survey-ten';
  currentDraft = { ...draft, title: survey ? 'Ten-choice Survey demo' : 'Ten-choice Quiz demo', mode: survey ? 'survey' : 'quiz',
    lateJoin: true, questions: [{ text: 'Which of these ten topics interests you?',
      options: Array.from({ length: 10 }, (_, i) => `Topic ${i + 1}${i === 9 ? ' - literal | and \\ characters. ' + 'Long topic text '.repeat(12) : ''}`),
      correctIndex: survey ? null : 9, duration: 120, ...(survey ? { survey: { other: true, allowMultiple: true } } : {}) }] };
  phase = location.pathname.startsWith('/host/lobby/') ? 'lobby' : 'question';
} else if (!stored && example) {
  currentDraft = { ...draft, title: example === 'survey-multiple' ? 'Live Survey demo - multiple and Other' : 'Live Survey demo - written feedback',
    mode: 'survey', lateJoin: true, questions: [{ text: 'What should we include in our next event?',
      options: example === 'survey-other-only' ? [] : ['Product sessions', 'Workshops'],
      correctIndex: null, duration: 120, survey: { other: true, allowMultiple: example === 'survey-multiple' } }] };
  phase = 'question';
}
if (stored) {
  currentDraft = stored.currentDraft; deleted = stored.deleted; currentCode = stored.currentCode;
  phase = stored.phase; questionIndex = stored.questionIndex; myOption = stored.myOption; myResponse = stored.myResponse; version = stored.version;
  surveyAnswers = stored.surveyAnswers ?? {};
  players.splice(0, players.length, ...stored.players);
}
questionStartedAt = stored?.questionStartedAt ?? (phase === 'question' ? Date.now() - 15000 : 0);
function snapshot() {
  return structuredClone({ currentDraft, deleted, currentCode, createdAt, phase, questionStartedAt, questionIndex, myOption, myResponse, surveyAnswers, version, players });
}
function activate(id, record) {
  activeId = id;
  ({ currentDraft, deleted, currentCode, createdAt, phase, questionIndex, myOption, myResponse, version } = structuredClone(record));
  questionStartedAt = record.questionStartedAt ?? (phase === 'question' ? Date.now() - 15000 : 0);
  surveyAnswers = structuredClone(record.surveyAnswers ?? {});
  players.splice(0, players.length, ...record.players);
}
function persist() {
  records.set(activeId, snapshot());
  sessionStorage.setItem('quizcrowd-test-fixture', JSON.stringify({ example, authenticated, admin, owner, settings, ...snapshot(), activeId, records: [...records] }));
}
function nextDemoCode() {
  const used = new Set([currentCode, ...[...records.values()].map(record => record.currentCode)]);
  let candidate = Number(currentCode.slice(1));
  for (let attempt = 0; attempt < 100000; attempt++) {
    candidate = (candidate + 1) % 100000;
    const suffix = candidate.toString().padStart(5, '0');
    const check = [...suffix].reduce((sum, digit) => sum + Number(digit), 0) % 10;
    const code = `${check}${suffix}`;
    if (!used.has(code)) return code;
  }
  throw new Error('Demo join-code space exhausted.');
}
function session() { return { isAuthenticated: authenticated, isAnonymous: !authenticated, user: authenticated ? { id: 'test-only-verified-subject' } : undefined }; }
function view(attendee) {
  const q = currentDraft.questions[questionIndex];
  const rankings = players.map((nickname, i) => ({ nickname, score: 2900 - i * 350, streak: i === 0 ? 3 : 1, rank: i + 1 }));
  return {
    id: activeId, code: currentCode, title: currentDraft.title, mode: currentDraft.mode,
    phase, version, questionIndex, totalQuestions: currentDraft.questions.length, serverNow: Date.now(),
    players, answerCount: myOption === undefined && myResponse === undefined ? 0 : 1,
    ...(phase === 'question' || phase === 'reveal' ? { question: { text: q.text, options: q.options, duration: q.duration, survey: q.survey }, questionStartedAt } : {}),
    ...(attendee && myOption !== undefined ? { myOption } : {}),
    ...(attendee && myResponse !== undefined ? { myResponse: structuredClone(myResponse) } : {}),
    ...(currentDraft.mode === 'quiz' && (phase === 'reveal' || (phase === 'question' && attendee && myOption !== undefined && currentDraft.showAnswer === 'after_response')) ? {
      correctIndex: q.correctIndex, ...(attendee ? { myResult: { correct: myOption === q.correctIndex, points: 1450, score: 2900 } } : {}),
    } : {}),
    ...(phase === 'reveal' ? { distribution: q.options.map((_, i) => currentDraft.mode === 'survey' ? Number(myResponse?.options.includes(i) ?? myOption === i) : i === 0 ? 3 : 1),
      ...(q.survey?.other ? { otherCount: myResponse?.other === undefined ? 0 : 1 } : {}) } : {}),
    ...(phase === 'leaderboard' || phase === 'finished' ? currentDraft.mode === 'quiz' ? { rankings } : {
      surveyResults: currentDraft.questions.slice(0,questionIndex+1).map((question,index)=>{
        const response=surveyAnswers[index], writtenCount=Number(response?.other!==undefined);
        const counts=question.options.map((label,i)=>({label,count:Number(response?.options.includes(i)??false)}));
        if(question.survey?.other&&question.options.length)counts.push({label:'Other (written responses)',count:writtenCount});
        const maximum=Math.max(0,...counts.map(c=>c.count));
        return {questionIndex:index,text:question.text,responseCount:Number(!!response),writtenCount,textOnly:!question.options.length,mostSelected:maximum?counts.filter(c=>c.count===maximum):[]};
      }),
    } : {}),
  };
}
window.__quizcrowdFixture = {
  requests,
  defer(command) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    deferred.set(command, promise);
    this.release = (error) => { deferred.delete(command); release(error); };
  },
  phase(next) { if (next === 'question' && phase !== 'question') questionStartedAt = Date.now() - 15000; phase = next; version++; persist(); },
  revealMode(value) { currentDraft.showAnswer = value; },
};
function summary(id = activeId, record = snapshot()) {
  const { currentDraft: draft, phase, myOption, myResponse } = record;
  return { id, code: record.currentCode, title: draft.title, phase, visibility: draft.visibility,
    mode: draft.mode, createdAt: record.createdAt, participantCount: record.players.length, questionCount: draft.questions.length,
    responseCount: myOption === undefined && myResponse === undefined ? 0 : 1, readOnly: phase !== 'lobby' || myOption !== undefined || myResponse !== undefined };
}
const connection = {
  client: { auth: {
    getSession: session,
    onSessionChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async signOut() { authenticated = false; persist(); for (const listener of listeners) listener(session()); },
  } },
  signIn() {
    authenticated = true;
    persist();
    for (const listener of listeners) listener(session());
    return Promise.resolve(session());
  },
};
export async function connect() { return connection; }
export async function call(_connection, request, token = '', asGuest = false) {
  requests.push(structuredClone({ ...request, hasToken: !!token, asGuest }));
  const pending = deferred.get(request.command);
  if (pending) { const error = await pending; if (error) throw new Error(error); }
  if (request.id && request.id !== activeId) {
    const target = [...records].find(([id, record]) => request.id === id || request.id === record.currentCode);
    if (target) { records.set(activeId, snapshot()); activate(...target); }
  }
  if (['edit', 'host', 'duplicate', 'delete'].includes(request.command) && (request.id !== activeId || deleted || !owner || !authenticated)) throw new Error('Session not found or ownership required.');
  try {
  switch (request.command) {
    case 'settings': return { ...settings, isAdmin: authenticated && admin };
    case 'list':
      if (!authenticated) throw new Error('Sign in to list sessions.');
      records.set(activeId, snapshot());
      return [...records].filter(([, record]) => !record.deleted).map(([id, record]) => summary(id, record)).sort((a, b) => b.createdAt - a.createdAt);
    case 'edit':
      if (!authenticated) throw new Error('Sign in to edit.');
      if (request.draft) {
        if (summary().readOnly) throw new Error('Session is read-only.');
        currentDraft = structuredClone(request.draft); return { id: activeId };
      }
      return { ...summary(), draft: structuredClone(currentDraft) };
    case 'resolve': return { code: currentCode };
    case 'duplicate': {
      records.set(activeId, snapshot());
      const code = nextDemoCode(); // Predictable test-only suffix; production uses Node crypto.randomInt.
      currentDraft = { ...structuredClone(currentDraft), title: copyTitle(currentDraft.title), visibility: 'internal', publicAcknowledged: false };
      activeId = crypto.randomUUID(); currentCode = code; createdAt = Date.now();
      phase = 'lobby'; questionStartedAt = 0; questionIndex = -1; version = 0; myOption = undefined; myResponse = undefined; surveyAnswers = {}; deleted = false;
      players.splice(0);
      return { id: activeId, code: currentCode };
    }
    case 'create':
      if (!authenticated) throw new Error('Sign in to create.');
      currentCode = nextDemoCode();
      currentDraft = structuredClone(request.draft); phase = 'lobby'; questionStartedAt = 0; questionIndex = 0; myOption = undefined; myResponse = undefined; surveyAnswers = {}; deleted = false;
      return { id: activeId, code: currentCode };
    case 'host':
      if (!authenticated) throw new Error('Host ownership required.');
      return view(false);
    case 'state':
      if (!token) throw new Error('Attendee credential required.');
      return view(true);
    case 'join':
      if (request.id !== currentCode) throw new Error('Session not found.');
      if (!authenticated && !asGuest) throw new Error('Sign in to join.');
      if (asGuest && !settings.anonymousEnabled) throw new Error('Guests are disabled.');
      if (phase === 'finished' || (phase !== 'lobby' && !currentDraft.lateJoin)) throw new Error('This game is not accepting new attendees.');
      if (request.nickname && !players.includes(request.nickname)) players.push(request.nickname);
      return { id: activeId, token: 'test-only-attendee-credential' };
    case 'control':
      if (!authenticated || request.version !== version) throw new Error('Host version or identity rejected.');
      if (request.action === 'start') { phase = 'question'; questionIndex = 0; questionStartedAt = Date.now(); }
      else if (questionIndex + 1 === currentDraft.questions.length) phase = 'finished';
      else { questionIndex++; phase = 'question'; questionStartedAt = Date.now(); }
      version++; myOption = undefined; myResponse = undefined;
      return undefined;
    case 'answer':
      if (!token || phase !== 'question') throw new Error('Answer rejected.');
      myOption = request.option;
      myResponse = request.response ? structuredClone(request.response) : undefined;
      if(currentDraft.mode==='survey')surveyAnswers[questionIndex]=myResponse??{options:[myOption]};
      return { accepted: true };
    case 'configure':
      if (!authenticated || !admin) throw new Error('Administrator required.');
      if (settings.anonymousEnabled !== request.enabled) settings.guestEpoch++;
      settings.anonymousEnabled = request.enabled;
      return undefined;
    case 'visibility': currentDraft.visibility = request.visibility; return undefined;
    case 'preview': return { title: currentDraft.title, mode: currentDraft.mode, questions: currentDraft.questions.map(({ text, options, duration, survey }) => ({ text, options, duration, survey })) };
    case 'delete': deleted = true; return { deleted: true };
    default: throw new Error(`Unknown fixture command: ${request.command}`);
  }
  } finally { persist(); }
}
