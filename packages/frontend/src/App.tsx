import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Draft, GameView, QuizSummary, SettingsView } from '@rayfin-app/shared';
import { PUBLIC_WARNING } from '@rayfin-app/shared';
import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { call, connect, type Connection } from './lib/rayfin-client';

const blankQuestion = () => ({ text: '', options: ['', '', '', ''], correctIndex: 0, duration: 20 });
const blankDraft = (): Draft => ({
  title: '', mode: 'quiz', visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all', questions: [blankQuestion()],
});
type Ticket = { id: string; token: string; guest: boolean };
type Preview = { title: string; mode: string; questions: { text: string; options: string[] }[] };
const TICKET_KEY = 'quizcrowd-attendee-credential';

export default function App() {
  const [connection, setConnection] = useState<Connection>();
  const [session, setSession] = useState<OpaqueSession | null>(null);
  const [settings, setSettings] = useState<SettingsView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<'home' | 'author' | 'game'>('home');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('quiz') ?? '');
  const [nickname, setNickname] = useState('');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<string>();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [ticket, setTicket] = useState<Ticket>();
  const [hostId, setHostId] = useState<string>();
  const [game, setGame] = useState<GameView>();
  const [clock, setClock] = useState(Date.now());
  const skew = useRef(0);
  const signedIn = !!session?.isAuthenticated && !session.isAnonymous;
  const showingHost = !!hostId;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    connect().then((c) => {
      if (!active) return;
      setConnection(c);
      setSession(c.client.auth.getSession());
      const saved = sessionStorage.getItem(TICKET_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'token' in parsed && 'guest' in parsed &&
            typeof parsed.id === 'string' && typeof parsed.token === 'string' && typeof parsed.guest === 'boolean') {
          setTicket({ id: parsed.id, token: parsed.token, guest: parsed.guest });
          setPage('game');
        } else throw new Error('Stored attendee credential is invalid. Clear this tab session storage and join again.');
      }
      unsubscribe = c.client.auth.onSessionChange((s) => {
        setSession(s);
        sessionStorage.removeItem(TICKET_KEY);
        setGame(undefined); setTicket(undefined); setHostId(undefined); setQuizzes([]);
        setPage('home');
      });
    }).catch((e: unknown) => setError(message(e)));
    return () => { active = false; unsubscribe?.(); };
  }, []);

  async function refresh(c = connection) {
    if (!c) return;
    const config = await call<SettingsView>(c, { command: 'settings' });
    setSettings(config);
    if (c.client.auth.getSession().isAuthenticated && !c.client.auth.getSession().isAnonymous) {
      setQuizzes(await call<QuizSummary[]>(c, { command: 'list' }));
    }
  }
  useEffect(() => {
    if (connection) refresh(connection).catch((e: unknown) => setError(message(e)));
  }, [connection, session]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!connection || page !== 'game' || (!hostId && !ticket)) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call<GameView>(connection, {
          command: hostId ? 'host' : 'state', id: hostId ?? ticket?.id,
        }, ticket?.token, ticket?.guest);
        if (!stopped) {
          skew.current = next.serverNow - Date.now();
          setGame(next); setError('');
        }
      } catch (e) {
        if (!stopped) { setGame(undefined); setError(message(e)); }
      } finally {
        if (!stopped) timeout = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timeout); };
  }, [connection, page, hostId, ticket]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  function signIn() {
    if (!connection) return;
    // Invoke synchronously from the click, before awaiting any other work.
    const result = connection.signIn();
    void run(async () => { setSession(await result); });
  }
  async function enter(guest: boolean) {
    if (!connection) return;
    const result = await call<{ id: string; token: string }>(connection,
      { command: 'join', id: code.toUpperCase(), nickname }, '', guest);
    sessionStorage.setItem(TICKET_KEY, JSON.stringify({ ...result, guest }));
    setHostId(undefined); setTicket({ ...result, guest }); setGame(undefined); setPage('game');
  }
  async function loadDraft(id: string, duplicate: boolean) {
    if (!connection) return;
    const saved = await call<Draft>(connection, { command: 'edit', id });
    setDraft(duplicate ? { ...saved, visibility: 'internal', publicAcknowledged: false } : saved);
    setEditing(duplicate ? undefined : id); setPage('author');
  }
  const joinUrl = game ? `${location.origin}${location.pathname}?quiz=${game.id}` : '';
  const seconds = game?.question && game.questionStartedAt
    ? Math.max(0, Math.ceil((game.questionStartedAt + game.question.duration * 1000 - clock - skew.current) / 1000)) : 0;

  return <main>
    <header>
      <button className="brand" onClick={() => { setPage('home'); setGame(undefined); setHostId(undefined); }}>Quiz<span>Crowd</span></button>
      <span className="badge">Microsoft Fabric Apps</span>
      {signedIn ? <button onClick={() => void run(async () => {
        await connection!.client.auth.signOut();
        setDraft(blankDraft()); setPreview(undefined); setEditing(undefined);
      })}>Sign out</button> : <button disabled={!connection || busy} onClick={signIn}>Sign in with Microsoft Entra</button>}
    </header>
    {error && <div role="alert" className="error">{error}</div>}
    {!connection && !error && <p role="status">Connecting to Fabric...</p>}
    {page === 'home' && <>
      <section className="hero"><h1>Bring your crowd together.</h1><p>Live quizzes, shared moments, and surveys. Your data stays in Fabric SQL.</p></section>
      <div className="columns">
        <section className="card">
          <h2>Join a quiz</h2>
          <label>Quiz ID or session code<input value={code} onChange={(e) => { setCode(e.target.value.trim()); setPreview(undefined); }} maxLength={36} /></label>
          <label>Display nickname<input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} /></label>
          <p className="muted">Use a pseudonym. Nicknames and leaderboard scores are visible to other attendees. The attendee credential is kept only in this tab's session storage; quiz data remains in Fabric SQL.</p>
          <div className="actions">
            {signedIn && <button className="primary" disabled={busy || !code || !nickname} onClick={() => void run(() => enter(false))}>Join signed in</button>}
            {!signedIn && <button disabled={busy || !connection} onClick={signIn}>Sign in to attend</button>}
            {settings?.anonymousEnabled && <button disabled={busy || !code || !nickname} onClick={() => void run(() => enter(true))}>Join as anonymous guest</button>}
            <button disabled={busy || !code || !connection} onClick={() => void run(async () => {
              setPreview(await call<Preview>(connection!, { command: 'preview', id: code.toUpperCase() }));
            })}>View questions</button>
          </div>
          {!settings?.anonymousEnabled && <p className="muted">Anonymous attendance is disabled by the publisher.</p>}
          {preview && <article><h3>{preview.title}</h3>{preview.questions.map((q, i) =>
            <div className="question-preview" key={i}><strong>{i + 1}. {q.text}</strong><p>{q.options.join(' / ')}</p></div>)}</article>}
        </section>
        <section className="card">
          <h2>Host your next session</h2>
          <p>Create multiple-choice quizzes or manually author surveys. Authoring and hosting always require Microsoft Entra sign-in.</p>
          {signedIn ? <>
            <button className="primary" onClick={() => { setDraft(blankDraft()); setEditing(undefined); setPage('author'); }}>Create quiz or survey</button>
            <p className="muted">Your caller subject for publisher bootstrap: <code>{session?.user?.id}</code></p>
            <h3>Your quizzes</h3>
            <button disabled={busy} onClick={() => void run(() => refresh())}>Refresh library</button>
            {quizzes.map((q) => <article className="library-item" key={q.id}>
              <strong>{q.title}</strong><p>{q.visibility === 'public' ? 'Anyone (Public)' : 'Internal Only'} / {q.phase}</p>
              <div className="actions">
                <button onClick={() => { setHostId(q.id); setTicket(undefined); setGame(undefined); setPage('game'); }}>Host</button>
                <button disabled={busy} onClick={() => void run(() => loadDraft(q.id, false))}>Edit</button>
                <button disabled={busy} onClick={() => void run(() => loadDraft(q.id, true))}>Duplicate</button>
                <button disabled={busy || (q.visibility === 'internal' && !settings?.anonymousEnabled)} onClick={() => void run(async () => {
                  const visibility = q.visibility === 'public' ? 'internal' : 'public';
                  if (visibility === 'public' && !window.confirm(PUBLIC_WARNING)) return;
                  await call(connection!, { command: 'visibility', id: q.id, visibility, publicAcknowledged: visibility === 'public' });
                  await refresh();
                })}>{q.visibility === 'public' ? 'Make internal' : 'Make public'}</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  if (window.confirm('Delete this quiz and all participant responses permanently?')) {
                    await call(connection!, { command: 'delete', id: q.id }); await refresh();
                  }
                })}>Delete</button>
              </div>
            </article>)}
          </> : <button disabled={!connection || busy} onClick={signIn}>Sign in to create</button>}
        </section>
      </div>
      {settings?.isAdmin && <section className="card admin">
        <h2>Publisher controls</h2><p>Disabling anonymous access denies all further guest operations, including existing guest sessions, after in-flight transactions finish. Previously downloaded public questions cannot be recalled.</p>
        <label className="check"><input type="checkbox" checked={settings.anonymousEnabled} disabled={busy} onChange={(e) => {
          const enabled = e.target.checked;
          void run(async () => {
            await call(connection!, { command: 'configure', enabled }); await refresh();
          });
        }} />Allow anonymous attendees (database setting)</label>
        <p className="muted">Enable only after completing the public deployment and negative-authorization checks in the deployment guide. Revocation generation: {settings.guestEpoch}.</p>
      </section>}
    </>}
    {page === 'author' && signedIn && <section className="card author">
      <h1>{editing ? 'Edit your quiz' : 'Create your session'}</h1>
      <form onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const saved = await call<{ id: string }>(connection!, { command: editing ? 'edit' : 'create', id: editing, draft });
          setHostId(saved.id); setTicket(undefined); setGame(undefined); setPage('game');
        });
      }}>
        <label>Title<input required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Session type<select value={draft.mode} onChange={(e) => {
          const mode = e.target.value as Draft['mode'];
          setDraft({ ...draft, mode, questions: draft.questions.map((q) => ({ ...q, correctIndex: mode === 'survey' ? null : 0 })) });
        }}><option value="quiz">Scored quiz</option><option value="survey">Survey (no correct answers)</option></select></label>
        <label>Audience<select value={draft.visibility} onChange={(e) => setDraft({
          ...draft, visibility: e.target.value as Draft['visibility'], publicAcknowledged: false,
        })}><option value="internal">Internal Only</option><option value="public" disabled={!settings?.anonymousEnabled}>Anyone (Public)</option></select></label>
        {draft.visibility === 'public' && <div className="warning">
          <p>{PUBLIC_WARNING}</p><label className="check"><input type="checkbox" checked={draft.publicAcknowledged}
            onChange={(e) => setDraft({ ...draft, publicAcknowledged: e.target.checked })} required />I understand and choose public access.</label>
        </div>}
        <label className="check"><input type="checkbox" checked={draft.lateJoin} onChange={(e) => setDraft({ ...draft, lateJoin: e.target.checked })} />Allow late join</label>
        <label>Reveal correct answers<select value={draft.showAnswer} onChange={(e) => setDraft({ ...draft, showAnswer: e.target.value as Draft['showAnswer'] })}>
          <option value="wait_all">After everyone answers or timer expires</option><option value="after_response">After each attendee responds</option><option value="never">Never show the answer key</option>
        </select></label>
        {draft.questions.map((q, i) => <fieldset key={i}>
          <legend>Question {i + 1}</legend>
          <label>Question text<textarea required maxLength={1000} value={q.text} onChange={(e) => setDraft({
            ...draft, questions: draft.questions.map((v, j) => j === i ? { ...v, text: e.target.value } : v),
          })} /></label>
          {q.options.map((option, k) => <label key={k}>Option {k + 1}
            <input required maxLength={300} value={option} onChange={(e) => setDraft({
              ...draft, questions: draft.questions.map((v, j) => j === i ? { ...v, options: v.options.map((o, n) => n === k ? e.target.value : o) } : v),
            })} /></label>)}
          {draft.mode === 'quiz' && <label>Correct option<select value={q.correctIndex ?? 0} onChange={(e) => setDraft({
            ...draft, questions: draft.questions.map((v, j) => j === i ? { ...v, correctIndex: Number(e.target.value) } : v),
          })}>{q.options.map((_, k) => <option value={k} key={k}>Option {k + 1}</option>)}</select></label>}
          <label>Duration (seconds)<input type="number" min={5} max={120} required value={q.duration} onChange={(e) => setDraft({
            ...draft, questions: draft.questions.map((v, j) => j === i ? { ...v, duration: Number(e.target.value) } : v),
          })} /></label>
          {draft.questions.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => i !== j) })}>Remove question</button>}
        </fieldset>)}
        <div className="actions"><button type="button" disabled={draft.questions.length >= 40} onClick={() => setDraft({
          ...draft, questions: [...draft.questions, { ...blankQuestion(), correctIndex: draft.mode === 'survey' ? null : 0 }],
        })}>Add question</button>
        <button className="primary" disabled={busy || (draft.visibility === 'public' && (!settings?.anonymousEnabled || !draft.publicAcknowledged))}>Save and open lobby</button></div>
      </form>
    </section>}
    {page === 'game' && <section className="card game">
      {!game ? <p role="status">{error ? 'Session unavailable.' : 'Loading session...'}</p> : <>
        <span className="badge">{showingHost ? 'Host' : ticket?.guest ? 'Anonymous attendee' : 'Attendee'} / {game.mode}</span>
        <h1>{game.title}</h1><p className="session-code">Session code: <strong>{game.code}</strong></p>
        {showingHost && <div className="invite"><QRCodeSVG value={joinUrl} size={160} /><a href={joinUrl}>{joinUrl}</a></div>}
        <p>{game.players.length} attendees / {game.answerCount} answers</p>
        {game.phase === 'lobby' && <><h2>You're in. Waiting for the host...</h2><p>{game.players.join(' / ') || 'Share the quiz URL or session code.'}</p></>}
        {game.question && <><p>Question {game.questionIndex + 1} of {game.totalQuestions}</p><h2>{game.question.text}</h2>
          {game.phase === 'question' && <><progress max={game.question.duration} value={seconds} /><p aria-live="off">{seconds} seconds</p></>}
          <div className="answers">{game.question.options.map((option, i) => <button key={i}
            className={`${game.correctIndex === i ? 'correct' : ''} ${game.myOption === i ? 'selected' : ''}`}
            disabled={showingHost || game.phase !== 'question' || game.myOption !== undefined || busy || seconds === 0}
            onClick={() => void run(async () => {
              await call(connection!, { command: 'answer', id: game.id, questionIndex: game.questionIndex, option: i }, ticket!.token, ticket!.guest);
              setGame(await call<GameView>(connection!, { command: 'state', id: game.id }, ticket!.token, ticket!.guest));
            })}>{String.fromCharCode(65 + i)}. {option}{game.distribution && <span> ({game.distribution[i]} responses)</span>}</button>)}</div>
          {game.myOption !== undefined && <p>Response recorded.</p>}
          {game.myResult && <p className="result">{game.myResult.correct ? 'Correct!' : 'Not quite.'} +{game.myResult.points} points / Total {game.myResult.score}</p>}
        </>}
        {game.phase === 'reveal' && <h2>Results are in!</h2>}
        {game.rankings && <><h2>{game.phase === 'finished' ? 'Final podium' : 'Leaderboard'}</h2>
          <ol className="rankings">{game.rankings.map((p) => <li key={p.rank}><strong>{p.rank}. {p.nickname}</strong><span>{p.score} points / streak {p.streak}</span></li>)}</ol></>}
        {showingHost && (game.phase === 'lobby' || game.phase === 'leaderboard') && <button className="primary" disabled={busy} onClick={() => void run(async () => {
          await call(connection!, { command: 'control', id: game.id, action: game.phase === 'lobby' ? 'start' : 'next', version: game.version });
          setGame(await call<GameView>(connection!, { command: 'host', id: game.id }));
        })}>{game.phase === 'lobby' ? 'Start game' : game.questionIndex + 1 === game.totalQuestions ? 'Finish game' : 'Next question'}</button>}
      </>}
    </section>}
    <footer>QuizCrowd for Fabric / Entra-secured authoring / Anonymous access is publisher controlled</footer>
  </main>;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
