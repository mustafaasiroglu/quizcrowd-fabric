// This module replaces the connection module only in the isolated UI test server.
import { copyTitle } from '@rayfin-app/shared';

const parameters = new URLSearchParams(location.search);
const previous = JSON.parse(sessionStorage.getItem('quizcrowd-test-fixture') ?? 'null');
const requestedExample = parameters.get('example');
const example = ['survey-multiple', 'survey-single', 'survey-other-only', 'survey-legacy-single-other'].includes(requestedExample) ? requestedExample : previous?.example;
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
let questionIndex = 0;
let myOption;
let myResponse;
let version = 1;
const players = ['Alex', 'Sam', 'Taylor', 'Jordan'];
if (!stored && example) {
  currentDraft = { ...draft, title: example === 'survey-multiple' ? 'Live Survey demo - multiple and Other' : 'Live Survey demo - written feedback',
    mode: 'survey', lateJoin: true, questions: [{ text: 'What should we include in our next event?',
      options: example === 'survey-other-only' ? [] : ['Product sessions', 'Workshops'],
      correctIndex: null, duration: 120, survey: { other: example !== 'survey-single', allowMultiple: example === 'survey-multiple' } }] };
  phase = 'question';
}
if (stored) {
  currentDraft = stored.currentDraft; deleted = stored.deleted; currentCode = stored.currentCode;
  phase = stored.phase; questionIndex = stored.questionIndex; myOption = stored.myOption; myResponse = stored.myResponse; version = stored.version;
  players.splice(0, players.length, ...stored.players);
}
function snapshot() {
  return structuredClone({ currentDraft, deleted, currentCode, createdAt, phase, questionIndex, myOption, myResponse, version, players });
}
function activate(id, record) {
  activeId = id;
  ({ currentDraft, deleted, currentCode, createdAt, phase, questionIndex, myOption, myResponse, version } = structuredClone(record));
  players.splice(0, players.length, ...record.players);
}
function persist() {
  records.set(activeId, snapshot());
  sessionStorage.setItem('quizcrowd-test-fixture', JSON.stringify({ example, authenticated, admin, owner, settings, ...snapshot(), activeId, records: [...records] }));
}
function session() { return { isAuthenticated: authenticated, isAnonymous: !authenticated, user: authenticated ? { id: 'test-only-verified-subject' } : undefined }; }
function view(attendee) {
  const q = currentDraft.questions[questionIndex];
  const rankings = players.map((nickname, i) => ({ nickname, score: 2900 - i * 350, streak: i === 0 ? 3 : 1, rank: i + 1 }));
  return {
    id: activeId, code: currentCode, title: currentDraft.title, mode: currentDraft.mode,
    phase, version, questionIndex, totalQuestions: currentDraft.questions.length, serverNow: Date.now(),
    players, answerCount: myOption === undefined && myResponse === undefined ? 0 : 1,
    ...(phase === 'question' || phase === 'reveal' ? { question: { text: q.text, options: q.options, duration: q.duration, survey: q.survey }, questionStartedAt: Date.now() - 15000 } : {}),
    ...(attendee && myOption !== undefined ? { myOption } : {}),
    ...(attendee && myResponse !== undefined ? { myResponse: structuredClone(myResponse) } : {}),
    ...(currentDraft.mode === 'quiz' && (phase === 'reveal' || (phase === 'question' && attendee && myOption !== undefined && currentDraft.showAnswer === 'after_response')) ? {
      correctIndex: q.correctIndex, ...(attendee ? { myResult: { correct: myOption === q.correctIndex, points: 1450, score: 2900 } } : {}),
    } : {}),
    ...(phase === 'reveal' ? { distribution: q.options.map((_, i) => currentDraft.mode === 'survey' ? Number(myResponse?.options.includes(i) ?? myOption === i) : i === 0 ? 3 : 1),
      ...(q.survey?.other ? { otherCount: myResponse?.other === undefined ? 0 : 1 } : {}) } : {}),
    ...(phase === 'leaderboard' || phase === 'finished' ? { rankings: currentDraft.mode === 'quiz' ? rankings : rankings.map((r) => ({ ...r, score: 0, streak: 0 })) } : {}),
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
  phase(next) { phase = next; version++; },
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
      const used = new Set([...records.values()].map(record => record.currentCode));
      let candidate = Number(currentCode);
      for (let attempt = 0; attempt < 1000000; attempt++) {
        candidate = (candidate + 1) % 1000000;
        if (!used.has(candidate.toString().padStart(6, '0'))) break;
      }
      const code = candidate.toString().padStart(6, '0');
      if (used.has(code)) throw new Error('Demo join-code space exhausted.');
      currentDraft = { ...structuredClone(currentDraft), title: copyTitle(currentDraft.title), visibility: 'internal', publicAcknowledged: false };
      activeId = crypto.randomUUID(); currentCode = code; createdAt = Date.now();
      phase = 'lobby'; questionIndex = -1; version = 0; myOption = undefined; myResponse = undefined; deleted = false;
      players.splice(0);
      return { id: activeId, code: currentCode };
    }
    case 'create':
      if (!authenticated) throw new Error('Sign in to create.');
      currentDraft = structuredClone(request.draft); phase = 'lobby'; questionIndex = 0; myOption = undefined; myResponse = undefined; deleted = false;
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
      if (request.nickname && !players.includes(request.nickname)) players.push(request.nickname);
      return { id: activeId, token: 'test-only-attendee-credential' };
    case 'control':
      if (!authenticated || request.version !== version) throw new Error('Host version or identity rejected.');
      if (request.action === 'start') { phase = 'question'; questionIndex = 0; }
      else if (questionIndex + 1 === currentDraft.questions.length) phase = 'finished';
      else { questionIndex++; phase = 'question'; }
      version++; myOption = undefined; myResponse = undefined;
      return undefined;
    case 'answer':
      if (!token || phase !== 'question') throw new Error('Answer rejected.');
      myOption = request.option;
      myResponse = request.response ? structuredClone(request.response) : undefined;
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
