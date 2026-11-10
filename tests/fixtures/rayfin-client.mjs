// This module replaces the connection module only in the isolated UI test server.
const parameters = new URLSearchParams(location.search);
const stored = JSON.parse(sessionStorage.getItem('quizcrowd-test-fixture') ?? 'null');
let authenticated = stored?.authenticated ?? parameters.get('fixture') !== 'signed-out';
const admin = stored?.admin ?? parameters.get('fixture') !== 'creator';
const owner = stored?.owner ?? parameters.get('owner') !== 'other';
const gameId = '11111111-2222-4333-8444-555555555555';
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
let phase = 'lobby';
let questionIndex = 0;
let myOption;
let version = 1;
const players = ['Alex', 'Sam', 'Taylor', 'Jordan'];
if (stored) {
  currentDraft = stored.currentDraft; deleted = stored.deleted; currentCode = stored.currentCode;
  phase = stored.phase; questionIndex = stored.questionIndex; myOption = stored.myOption; version = stored.version;
  players.splice(0, players.length, ...stored.players);
}
function persist() {
  sessionStorage.setItem('quizcrowd-test-fixture', JSON.stringify({ authenticated, admin, owner, settings, currentDraft, deleted, currentCode, phase, questionIndex, myOption, version, players }));
}
const rankings = players.map((nickname, i) => ({ nickname, score: 2900 - i * 350, streak: i === 0 ? 3 : 1, rank: i + 1 }));
function session() { return { isAuthenticated: authenticated, isAnonymous: !authenticated, user: authenticated ? { id: 'test-only-verified-subject' } : undefined }; }
function view(attendee) {
  const q = currentDraft.questions[questionIndex];
  return {
    id: gameId, code: currentCode, title: currentDraft.title, mode: currentDraft.mode,
    phase, version, questionIndex, totalQuestions: currentDraft.questions.length, serverNow: Date.now(),
    players, answerCount: myOption === undefined ? 0 : 1,
    ...(phase === 'question' || phase === 'reveal' ? { question: { text: q.text, options: q.options, duration: q.duration }, questionStartedAt: Date.now() - 15000 } : {}),
    ...(attendee && myOption !== undefined ? { myOption } : {}),
    ...(currentDraft.mode === 'quiz' && (phase === 'reveal' || (phase === 'question' && attendee && myOption !== undefined && currentDraft.showAnswer === 'after_response')) ? {
      correctIndex: q.correctIndex, ...(attendee ? { myResult: { correct: myOption === q.correctIndex, points: 1450, score: 2900 } } : {}),
    } : {}),
    ...(phase === 'reveal' ? { distribution: q.options.map((_, i) => i === 0 ? 3 : 1) } : {}),
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
function summary() {
  return { id: gameId, code: currentCode, title: currentDraft.title, phase, visibility: currentDraft.visibility,
    mode: currentDraft.mode, createdAt: 1794214800000, participantCount: players.length, questionCount: currentDraft.questions.length,
    responseCount: myOption === undefined ? 0 : 1, readOnly: phase !== 'lobby' || myOption !== undefined };
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
  if (['edit', 'host'].includes(request.command) && (request.id !== gameId || deleted || !owner)) throw new Error('Session not found or ownership required.');
  try {
  switch (request.command) {
    case 'settings': return { ...settings, isAdmin: authenticated && admin };
    case 'list':
      if (!authenticated) throw new Error('Sign in to list sessions.');
      return deleted ? [] : [summary()];
    case 'edit':
      if (!authenticated) throw new Error('Sign in to edit.');
      if (request.draft) {
        if (summary().readOnly) throw new Error('Session is read-only.');
        currentDraft = structuredClone(request.draft); return { id: gameId };
      }
      return { ...summary(), draft: structuredClone(currentDraft) };
    case 'resolve': return { code: currentCode };
    case 'duplicate':
      currentDraft = { ...structuredClone(currentDraft), visibility: 'internal', publicAcknowledged: false };
      phase = 'lobby'; questionIndex = 0; myOption = undefined; deleted = false;
      players.splice(0); currentCode = '000124';
      return { id: gameId, code: currentCode };
    case 'create':
      if (!authenticated) throw new Error('Sign in to create.');
      currentDraft = structuredClone(request.draft); phase = 'lobby'; questionIndex = 0; myOption = undefined; deleted = false;
      return { id: gameId, code: '000123' };
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
      return { id: gameId, token: 'test-only-attendee-credential' };
    case 'control':
      if (!authenticated || request.version !== version) throw new Error('Host version or identity rejected.');
      if (request.action === 'start') phase = 'question';
      else if (questionIndex + 1 === currentDraft.questions.length) phase = 'finished';
      else { questionIndex++; phase = 'question'; }
      version++; myOption = undefined;
      return undefined;
    case 'answer':
      if (!token || phase !== 'question') throw new Error('Answer rejected.');
      myOption = request.option;
      return { accepted: true };
    case 'configure':
      if (!authenticated || !admin) throw new Error('Administrator required.');
      if (settings.anonymousEnabled !== request.enabled) settings.guestEpoch++;
      settings.anonymousEnabled = request.enabled;
      return undefined;
    case 'visibility': currentDraft.visibility = request.visibility; return undefined;
    case 'preview': return { title: currentDraft.title, mode: currentDraft.mode, questions: currentDraft.questions.map(({ text, options }) => ({ text, options })) };
    case 'delete': deleted = true; return { deleted: true };
    default: throw new Error(`Unknown fixture command: ${request.command}`);
  }
  } finally { persist(); }
}
