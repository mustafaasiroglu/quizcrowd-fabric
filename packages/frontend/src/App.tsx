import { useEffect, useRef, useState } from 'react';
import type { Draft, GameView, QuizSummary, SettingsView } from '@rayfin-app/shared';
import { PUBLIC_WARNING } from '@rayfin-app/shared';
import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { call, connect, type Connection } from './lib/rayfin-client';
import { AuthorEditor, blankDraft } from './components/AuthorEditor';
import { GameScreen } from './components/GameScreen';
import { Icon } from './components/Icon';
import { ThemeSwitch } from './components/ThemeSwitch';

type Ticket = { id: string; token: string; guest: boolean };
type Preview = { title: string; mode: string; questions: { text: string; options: string[] }[] };
type Page = 'home' | 'join' | 'library' | 'admin' | 'author' | 'game';
const TICKET_KEY = 'quizcrowd-attendee-credential';
const queryCode = new URLSearchParams(location.search).get('quiz') ?? new URLSearchParams(location.search).get('code') ?? '';

export default function App() {
  const [connection, setConnection] = useState<Connection>();
  const [session, setSession] = useState<OpaqueSession | null>(null);
  const [settings, setSettings] = useState<SettingsView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>(queryCode ? 'join' : 'home');
  const [joinStep, setJoinStep] = useState<'code' | 'nickname'>(queryCode ? 'nickname' : 'code');
  const [code, setCode] = useState(queryCode);
  const [nickname, setNickname] = useState('');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<string>();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [ticket, setTicket] = useState<Ticket>();
  const [hostId, setHostId] = useState<string>();
  const [game, setGame] = useState<GameView>();
  const [clock, setClock] = useState(Date.now());
  const content = useRef<HTMLDivElement>(null);
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
        setGame(undefined); setTicket(undefined); setHostId(undefined); setQuizzes([]); setSettings(undefined);
        setPage((current) => current === 'game' || current === 'admin' || current === 'author' ? 'home' : current);
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
    content.current?.focus();
    window.scrollTo(0, 0);
  }, [page]);
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
    // The Fabric broker must be invoked synchronously from the user gesture.
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
  function home() {
    sessionStorage.removeItem(TICKET_KEY);
    setTicket(undefined); setGame(undefined); setHostId(undefined); setPreview(undefined); setError(''); setPage('home');
    if (connection) void run(() => refresh());
  }
  function create() { setDraft(blankDraft()); setEditing(undefined); setPage('author'); }
  const joinUrl = game ? `${location.origin}${location.pathname}?quiz=${game.id}` : '';
  const seconds = game?.question && game.questionStartedAt
    ? Math.max(0, Math.ceil((game.questionStartedAt + game.question.duration * 1000 - clock - skew.current) / 1000)) : 0;
  const back = <button className="icon-button" aria-label="Go back" onClick={home}><Icon name="back" /></button>;

  return <>
    <div className="shapes-wrapper" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="app-toolbar">
      {page !== 'home' && <button className="brand small-brand" onClick={home}><span>Quiz</span><span>Crowd</span></button>}
      <nav className="toolbar-actions" aria-label="Account and appearance">
        {signedIn && <button className="text-button" onClick={() => setPage('library')}>Your Quizzes</button>}
        {signedIn && settings?.isAdmin && <button className="text-button" onClick={() => setPage('admin')}>Publisher controls</button>}
        <ThemeSwitch />
        {signedIn ? <button className="subtle" disabled={busy} onClick={() => void run(async () => {
          await connection!.client.auth.signOut();
          setDraft(blankDraft()); setPreview(undefined); setEditing(undefined);
        })}>Sign out</button> : <button className="subtle" disabled={!connection || busy} onClick={signIn}>Sign in with Microsoft Entra</button>}
      </nav>
    </header>
    <main id="content" ref={content} tabIndex={-1} className={`app-content page-${page}`}>
      {error && <div role="alert" className="error">{error}</div>}
      {!connection && !error && <p role="status" className="connection-status muted">Connecting to Fabric...</p>}
      {page === 'home' && <div className="home-screen">
        <div className="home-heading"><h1 className="brand"><span>Quiz</span><span>Crowd</span></h1><p className="muted">Real-time &amp; multi-player quizzes, for free!</p></div>
        <div className="home-actions"><button className="primary large-button" onClick={() => { setPage('join'); setJoinStep(code ? 'nickname' : 'code'); }}>Join a Quiz</button><button className="secondary large-button" onClick={() => signedIn ? create() : setPage('library')}>Host a Quiz</button></div>
        <div className="home-description"><p>QuizCrowd brings live classroom and team games to Microsoft Fabric. Create multiple-choice quizzes or surveys, share a code, and play.</p><p className="small">Microsoft Entra sign-in is required by default. Anonymous attendance is controlled by the publisher.</p></div>
      </div>}
      {page === 'join' && <div className="centered-page">
        <section className="card join-card">
          <div className="section-heading page-heading"><button className="icon-button" aria-label="Go back" onClick={() => joinStep === 'nickname' ? setJoinStep('code') : home()}><Icon name="back" /></button><h1>Join Quiz</h1></div>
          {joinStep === 'code' ? <form onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 4) setJoinStep('nickname'); }}>
            <label htmlFor="session-code">Session Code or Quiz ID</label>
            <input id="session-code" className="code-input" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')); setPreview(undefined); }} placeholder="ABCDEF" maxLength={36} autoComplete="off" required minLength={4} />
            <button type="submit" className="primary full-width" disabled={code.trim().length < 4}>Next</button>
          </form> : <form onSubmit={(e) => { e.preventDefault(); if (signedIn) void run(() => enter(false)); }}>
            <p className="muted join-code">Code: <strong>{code}</strong></p>
            <label htmlFor="nickname">Your Nickname</label>
            <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Enter nickname..." maxLength={24} required />
            {signedIn ? <button type="submit" className="primary full-width" disabled={busy || !nickname.trim()}>{busy ? 'Joining...' : 'Join Game'}</button> : <button type="button" className="primary full-width" disabled={busy || !connection} onClick={signIn}>Sign in to attend</button>}
            {settings?.anonymousEnabled && <button type="button" className="secondary full-width guest-join" disabled={busy || !nickname.trim()} onClick={() => void run(() => enter(true))}>Join as anonymous guest</button>}
            <p className="muted small">Use a pseudonym. Nicknames and leaderboard scores are visible to other attendees. Your secret attendee credential stays in this tab.</p>
            {!settings?.anonymousEnabled && <p className="muted small">Anonymous attendance is disabled by the publisher.</p>}
            <button type="button" className="text-button" disabled={busy || !connection} onClick={() => void run(async () => { setPreview(await call<Preview>(connection!, { command: 'preview', id: code.toUpperCase() })); })}>View questions</button>
          </form>}
          {preview && <article className="question-preview"><h2>{preview.title}</h2>{preview.questions.map((q, i) => <div key={i}><strong>{i + 1}. {q.text}</strong><p className="muted small">{q.options.join(' / ')}</p></div>)}</article>}
        </section>
      </div>}
      {page === 'library' && <div className="library-page page-container">
        <div className="section-heading page-heading">{back}<div><h1>Your Quizzes</h1><p className="muted small">Your sessions, saved in Fabric SQL.</p></div>{signedIn && <button className="subtle" disabled={busy} onClick={() => void run(() => refresh())}>Refresh library</button>}</div>
        {!signedIn ? <section className="card sign-in-card"><h2>Host your next session</h2><p className="muted">Authoring and hosting always require Microsoft Entra sign-in. Create multiple-choice quizzes or manually author surveys.</p><button className="primary full-width" disabled={!connection || busy} onClick={signIn}>Sign in to create</button></section> : <>
          <div className="library-stats"><div><span className="muted small">Your Sessions</span><strong>{quizzes.length}</strong></div><div><span className="muted small">In Lobby</span><strong>{quizzes.filter((q) => q.phase === 'lobby').length}</strong></div><div><span className="muted small">Finished</span><strong>{quizzes.filter((q) => q.phase === 'finished').length}</strong></div></div>
          <button className="secondary full-width create-session" onClick={create}>Create quiz or survey</button>
          {!quizzes.length && <section className="card empty-library"><p className="muted">No quizzes yet. Create your first session.</p></section>}
          {quizzes.map((q) => <article className="card library-item" key={q.id}>
            <div className="section-heading"><h2>{q.title}</h2><span className={`badge phase-${q.phase}`}>{q.phase}</span></div><p className="muted small">{q.code} · {q.visibility === 'public' ? 'Anyone (Public)' : 'Internal Only'}</p>
            <div className="actions">
              <button className="primary" onClick={() => { setHostId(q.id); setTicket(undefined); setGame(undefined); setPage('game'); }}>Host</button>
              <button disabled={busy} onClick={() => void run(() => loadDraft(q.id, false))}>Edit</button>
              <button disabled={busy} onClick={() => void run(() => loadDraft(q.id, true))}>Duplicate</button>
              <button disabled={busy || (q.visibility === 'internal' && !settings?.anonymousEnabled)} onClick={() => void run(async () => {
                const visibility = q.visibility === 'public' ? 'internal' : 'public';
                if (visibility === 'public' && !window.confirm(PUBLIC_WARNING)) return;
                await call(connection!, { command: 'visibility', id: q.id, visibility, publicAcknowledged: visibility === 'public' }); await refresh();
              })}>{q.visibility === 'public' ? 'Make internal' : 'Make public'}</button>
              <button className="danger" disabled={busy} onClick={() => void run(async () => {
                if (window.confirm('Delete this quiz and all participant responses permanently?')) { await call(connection!, { command: 'delete', id: q.id }); await refresh(); }
              })}>Delete</button>
            </div>
          </article>)}
          <details className="bootstrap-details"><summary>Publisher bootstrap identity</summary><p className="muted small">Your verified caller subject for trusted SQL bootstrap: <code>{session?.user?.id}</code></p></details>
        </>}
      </div>}
      {page === 'admin' && signedIn && settings?.isAdmin && <div className="publisher-page page-container">
        <div className="section-heading page-heading">{back}<h1>Publisher controls</h1></div>
        <section className="card"><h2>Anonymous attendance</h2><p className="muted">Disabling anonymous access denies all further guest operations, including existing guest sessions, after in-flight transactions finish. Previously downloaded public questions cannot be recalled.</p>
          <label className="check"><input type="checkbox" checked={settings.anonymousEnabled} disabled={busy} onChange={(e) => {
            const enabled = e.target.checked; void run(async () => { await call(connection!, { command: 'configure', enabled }); await refresh(); });
          }} />Allow anonymous attendees (database setting)</label>
          <p className="muted small">Enable only after completing the public deployment and negative-authorization checks in the deployment guide.</p><p className="badge">Revocation generation: {settings.guestEpoch}</p>
        </section>
      </div>}
      {page === 'author' && signedIn && <AuthorEditor draft={draft} onChange={setDraft} editing={!!editing} anonymousEnabled={!!settings?.anonymousEnabled} busy={busy} onBack={() => setPage('library')} onLibrary={() => setPage('library')} onSave={() => void run(async () => {
        const saved = await call<{ id: string }>(connection!, { command: editing ? 'edit' : 'create', id: editing, draft });
        setHostId(saved.id); setTicket(undefined); setGame(undefined); setPage('game');
      })} />}
      {page === 'game' && (!game ? <div className="centered-page"><section className="card loading-card"><div className="loading-spinner" /><p role="status">{error ? 'Session unavailable.' : 'Loading session...'}</p>{error && <button className="primary" onClick={home}>Back to Home</button>}</section></div> : <GameScreen game={game} host={showingHost} guest={!!ticket?.guest} nickname={nickname} seconds={seconds} joinUrl={joinUrl} busy={busy} onCopyError={(e) => setError(`Could not copy to clipboard: ${message(e)}`)} onHome={home} onControl={() => void run(async () => {
        await call(connection!, { command: 'control', id: game.id, action: game.phase === 'lobby' ? 'start' : 'next', version: game.version });
        setGame(await call<GameView>(connection!, { command: 'host', id: game.id }));
      })} onAnswer={(option) => void run(async () => {
        await call(connection!, { command: 'answer', id: game.id, questionIndex: game.questionIndex, option }, ticket!.token, ticket!.guest);
        setGame(await call<GameView>(connection!, { command: 'state', id: game.id }, ticket!.token, ticket!.guest));
      })} />)}
    </main>
    <footer>QuizCrowd for Microsoft Fabric · Entra-secured authoring · Publisher-controlled guests</footer>
  </>;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
