import { useEffect, useRef, useState } from 'react';
import type { AnswerSubmission, AuthorView, Draft, GameView, QuizSummary, SettingsView } from '@rayfin-app/shared';
import { normalizeSurveyAuthoring } from '@rayfin-app/shared';
import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { call, connect, type Connection } from './lib/rayfin-client';
import { AuthorEditor, blankDraft } from './components/AuthorEditor';
import { GameScreen } from './components/GameScreen';
import { Icon } from './components/Icon';
import { ThemeSwitch } from './components/ThemeSwitch';
import { SessionLibrary } from './components/SessionLibrary';
import { AccountMenu } from './components/AccountMenu';
import { Brand } from './components/Brand';
import { isGameId, parseRoute, routeUrl, type AppRoute } from './lib/routes';

type Ticket = { id: string; token: string; guest: boolean; nickname?: string };
const TICKET_KEY = 'quizcrowd-attendee-credential';

export default function App() {
  const [connection, setConnection] = useState<Connection>();
  const [session, setSession] = useState<OpaqueSession | null>(null);
  const [settings, setSettings] = useState<SettingsView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(new URL(location.href)));
  const page = route.page;
  const routeKey = routeUrl(route);
  const activeRouteKey = useRef(routeKey);
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const editing = route.page === 'author' && route.id ? route.id : undefined;
  const [authorReady, setAuthorReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [ticket, setTicket] = useState<Ticket>();
  const [game, setGame] = useState<GameView>();
  const [clock, setClock] = useState(Date.now());
  const content = useRef<HTMLDivElement>(null);
  const skew = useRef(0);
  const operation = useRef(0);
  const navigationVersion = useRef(0);
  const identityVersion = useRef(0);
  const refreshVersion = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const signedIn = !!session?.isAuthenticated && !session.isAnonymous;
  const showingHost = route.page === 'game' && route.host;
  const invitation = route.page === 'join' ? route.invitation : '';
  const joinStep = invitation ? 'nickname' : 'code';

  function changeRoute(next: AppRoute) {
    const key = routeUrl(next);
    if (key === activeRouteKey.current) return;
    activeRouteKey.current = key;
    navigationVersion.current++;
    operation.current++;
    refreshVersion.current++;
    setBusy(false); setRefreshing(false); setError(''); setGame(undefined); setAuthorReady(false);
    setRoute(next);
  }
  function navigate(next: AppRoute, replace = false) {
    history[replace ? 'replaceState' : 'pushState'](null, '', routeUrl(next));
    changeRoute(next);
  }
  useEffect(() => {
    const initial = parseRoute(new URL(location.href));
    if (initial.page !== 'not-found') history.replaceState(null, '', routeUrl(initial));
    const pop = () => changeRoute(parseRoute(new URL(location.href)));
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); operation.current++; refreshVersion.current++; };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    connect().then((c) => {
      if (!active) return;
      setConnection(c);
      const initialSession = c.client.auth.getSession();
      let principal = sessionKey(initialSession);
      setSession(initialSession);
      const saved = sessionStorage.getItem(TICKET_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'token' in parsed && 'guest' in parsed &&
            typeof parsed.id === 'string' && isGameId(parsed.id) && typeof parsed.token === 'string' && parsed.token.length > 0 && typeof parsed.guest === 'boolean') {
          const savedNickname = 'nickname' in parsed && typeof parsed.nickname === 'string' ? parsed.nickname : '';
          setTicket({ id: parsed.id, token: parsed.token, guest: parsed.guest, nickname: savedNickname });
          setNickname(savedNickname);
        } else throw new Error('Stored attendee credential is invalid. Clear this tab session storage and join again.');
      }
      unsubscribe = c.client.auth.onSessionChange((s) => {
        const nextPrincipal = sessionKey(s);
        if (nextPrincipal === principal) return;
        principal = nextPrincipal;
        identityVersion.current++;
        setSession(s);
        sessionStorage.removeItem(TICKET_KEY);
        operation.current++; refreshVersion.current++;
        setBusy(false); setRefreshing(false); setAuthorReady(false);
        setGame(undefined); setTicket(undefined); setQuizzes([]); setSettings(undefined); setDraft(blankDraft());
      });
    }).catch((e: unknown) => setError(message(e)));
    return () => { active = false; unsubscribe?.(); };
  }, []);

  async function refresh(c = connection) {
    if (!c) return;
    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      const config = await call<SettingsView>(c, { command: 'settings' });
      if (version !== refreshVersion.current) return;
      setSettings(config);
      if (c.client.auth.getSession().isAuthenticated && !c.client.auth.getSession().isAnonymous) {
        const items = await call<QuizSummary[]>(c, { command: 'list' });
        if (version === refreshVersion.current) setQuizzes(items);
      }
    } catch (e) {
      if (version === refreshVersion.current) setError(message(e));
    } finally {
      if (version === refreshVersion.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    if (connection) void refresh(connection);
  }, [connection, session, routeKey]);
  useEffect(() => {
    if (page !== 'join') return;
    setCode(/^\d{6}$/.test(invitation) ? invitation : '');
    if (!connection || !invitation || /^\d{6}$/.test(invitation)) return;
    let active = true;
    const navigation = navigationVersion.current, identity = identityVersion.current;
    call<{ code: string }>(connection, { command: 'resolve', id: invitation })
      .then((result) => { if (active && navigation === navigationVersion.current && identity === identityVersion.current) navigate({ page: 'join', invitation: result.code }, true); })
      .catch((e: unknown) => { if (active && navigation === navigationVersion.current && identity === identityVersion.current) setError(message(e)); });
    return () => { active = false; };
  }, [connection, page, invitation, session]);

  async function run(action: (current: () => boolean) => Promise<void>) {
    const id = ++operation.current;
    const current = () => operation.current === id;
    setBusy(true); setError('');
    try { await action(current); }
    catch (e) { if (current()) setError(message(e)); }
    finally { if (current()) setBusy(false); }
  }
  useEffect(() => {
    content.current?.focus();
    window.scrollTo(0, 0);
  }, [routeKey]);
  useEffect(() => {
    if (route.page !== 'author' || !signedIn || !connection) return;
    if (!route.id) {
      setDraft(blankDraft(route.mode)); setReadOnly(false); setAuthorReady(true); return;
    }
    let active = true;
    const navigation = navigationVersion.current, identity = identityVersion.current;
    call<AuthorView>(connection, { command: 'edit', id: route.id })
      .then((saved) => { if (active && navigation === navigationVersion.current && identity === identityVersion.current) { setDraft(saved.draft); setReadOnly(saved.readOnly); setAuthorReady(true); } })
      .catch((e: unknown) => { if (active && navigation === navigationVersion.current && identity === identityVersion.current) setError(message(e)); });
    return () => { active = false; };
  }, [connection, signedIn, session, routeKey]);
  useEffect(() => {
    if (!connection || route.page !== 'game' || (route.host ? !signedIn : ticket?.id !== route.id)) return;
    let stopped = false;
    const navigation = navigationVersion.current, identity = identityVersion.current;
    const current = () => !stopped && navigation === navigationVersion.current && identity === identityVersion.current;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call<GameView>(connection, {
          command: route.host ? 'host' : 'state', id: route.id,
        }, route.host ? '' : ticket?.token, !route.host && ticket?.guest);
        if (current()) {
          skew.current = next.serverNow - Date.now();
          setGame(next); setError('');
          if (route.host && route.lobby !== (next.phase === 'lobby')) {
            navigate({ ...route, lobby: next.phase === 'lobby' }, true);
          }
        }
      } catch (e) {
        if (current()) { setGame(undefined); setError(message(e)); }
      } finally {
        if (current()) timeout = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timeout); };
  }, [connection, routeKey, signedIn, session, ticket]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  function signIn() {
    if (!connection) return;
    // The Fabric broker must be invoked synchronously from the user gesture.
    const result = connection.signIn();
    void run(async (current) => { const next = await result; if (current()) setSession(next); });
  }
  function signOut() {
    if (!connection) return;
    const version = navigationVersion.current;
    const id = ++operation.current;
    setBusy(true); setError('');
    void connection.client.auth.signOut().catch((e: unknown) => {
      if (version === navigationVersion.current) setError(`Could not complete sign out: ${message(e)}`);
    }).finally(() => { if (id === operation.current) setBusy(false); });
  }
  async function enter(guest: boolean, current: () => boolean) {
    if (!connection) return;
    const result = await call<{ id: string; token: string }>(connection,
      { command: 'join', id: code.toUpperCase(), nickname }, '', guest);
    if (!current()) return;
    const next = { ...result, guest, nickname };
    sessionStorage.setItem(TICKET_KEY, JSON.stringify(next));
    setTicket(next); navigate({ page: 'game', id: result.id, host: false, lobby: false });
  }
  function home() {
    sessionStorage.removeItem(TICKET_KEY);
    setTicket(undefined); navigate({ page: 'home' });
  }
  function create(mode: Draft['mode']) {
    navigate({ page: 'author', id: '', mode });
    if (!signedIn) signIn();
  }
  function openDraft(id: string) { navigate({ page: 'author', id, mode: 'quiz' }); }
  function host(id: string) { setTicket(undefined); navigate({ page: 'game', id, host: true, lobby: true }); }
  async function submitAnswer(selection: AnswerSubmission, current: () => boolean) {
    if (!connection || !game || !ticket) throw new Error('Join this session before answering.');
    await call(connection, { command: 'answer', id: game.id, questionIndex: game.questionIndex, ...selection }, ticket.token, ticket.guest);
    if (!current()) return;
    const next = await call<GameView>(connection, { command: 'state', id: game.id }, ticket.token, ticket.guest);
    if (current()) setGame(next);
  }
  const joinUrl = game ? `${location.origin}${routeUrl({ page: 'join', invitation: game.code })}` : '';
  const seconds = game?.question && game.questionStartedAt
    ? Math.max(0, Math.ceil((game.questionStartedAt + game.question.duration * 1000 - clock - skew.current) / 1000)) : 0;
  const back = <button className="icon-button" aria-label="Go back" onClick={home}><Icon name="back" /></button>;
  const recent = <SessionLibrary quizzes={quizzes} busy={busy} onOpen={(q) => openDraft(q.id)}
    onDuplicate={(id) => void run(async (current) => { const copy = await call<{ id: string }>(connection!, { command: 'duplicate', id }); if (current()) openDraft(copy.id); })}
    onDelete={(id) => void run(async (current) => { if (window.confirm('Delete this session and all participant responses permanently?')) { await call(connection!, { command: 'delete', id }); if (current()) await refresh(); } })} />;
  const requiresSignIn = page === 'admin' || page === 'author' || showingHost;
  const signInGate = requiresSignIn && !signedIn;

  return <>
    {page !== 'author' && <div className={`shapes-wrapper ${page === 'home' ? 'workspace-shapes' : ''}`} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>}
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="app-toolbar">
      <Brand onHome={home} />
      <nav className="toolbar-actions" aria-label="Account and appearance">
        <ThemeSwitch />
        {signedIn ? <AccountMenu busy={busy} onSignOut={signOut} /> : <button className="subtle" disabled={!connection || busy} onClick={signIn}><Icon name="join" />Sign in with Microsoft Entra</button>}
      </nav>
    </header>
    <main id="content" ref={content} tabIndex={-1} className={`app-content screen-container page-${page}`}>
      {error && <div role="alert" className="error">{error}</div>}
      {!connection && !error && <p role="status" className="connection-status muted">Connecting to Fabric...</p>}
      {page === 'home' && <div className="home-screen forms-home">
        <h1 className="sr-only">QuizCrowd live quizzes and surveys</h1>
        <div className="home-actions">
          <button className="home-action quiz-action" aria-label="New Live Quiz" aria-describedby="new-quiz-description" disabled={!connection || busy} onClick={() => create('quiz')}><Icon name="quiz" /><span><strong>New Live Quiz</strong><span id="new-quiz-description" className="action-description">Create a quiz and host it live.</span></span></button>
          <button className="home-action survey-action" aria-label="New Live Survey" aria-describedby="new-survey-description" disabled={!connection || busy} onClick={() => create('survey')}><Icon name="survey" /><span><strong>New Live Survey</strong><span id="new-survey-description" className="action-description">Collect feedback in a live survey.</span></span></button>
          <button className="home-action join-code-button" aria-label="Join with Code" aria-describedby="join-description" disabled={busy} onClick={() => navigate({ page: 'join', invitation: '' })}><Icon name="join" /><span><strong>Join with Code</strong><span id="join-description" className="action-description">Enter a game code to take part.</span></span></button>
        </div>
        {signedIn ? <>{refreshing && <p className="muted small" role="status">Refreshing recent items...</p>}{recent}</>
          : <section className="card home-signin"><h2>Recent Items</h2><p className="muted">Your recent quiz and surveys.</p><p className="muted">Sign in with Microsoft Entra to create and manage your sessions. Attendees can join using a six-digit game code.</p></section>}
      </div>}
      {page === 'join' && <div className="centered-page">
        <section className="card join-card">
          <div className="section-heading page-heading"><button className="icon-button" aria-label="Go back" onClick={() => joinStep === 'nickname' ? navigate({ page: 'join', invitation: '' }) : home()}><Icon name="back" /></button><h1>Join Quiz</h1></div>
          {joinStep === 'code' ? <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code)) navigate({ page: 'join', invitation: code }); }}>
            <label htmlFor="session-code">Game Code</label>
            <input id="session-code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" required minLength={6} />
            <button type="submit" className="primary full-width" disabled={!/^\d{6}$/.test(code)}>Next</button>
          </form> : <form onSubmit={(e) => { e.preventDefault(); if (signedIn) void run((current) => enter(false, current)); }}>
            <p className="muted join-code">{!code ? 'Resolving invitation...' : <>Code: <strong>{code}</strong></>}</p>
            <label htmlFor="nickname">Your Nickname</label>
            <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Enter nickname..." maxLength={24} required />
            {signedIn ? <button type="submit" className="primary full-width" disabled={busy || !nickname.trim() || !/^\d{6}$/.test(code)}>{busy ? 'Joining...' : 'Join Game'}</button> : <button type="button" className="primary full-width" disabled={busy || !connection} onClick={signIn}>Sign in to attend</button>}
            {settings?.anonymousEnabled && <button type="button" className="secondary full-width guest-join" disabled={busy || !nickname.trim() || !/^\d{6}$/.test(code)} onClick={() => void run((current) => enter(true, current))}>Join as anonymous guest</button>}
            <p className="muted small">Use a pseudonym. Nicknames and leaderboard scores are visible to other attendees. Your secret attendee credential stays in this tab.</p>
            {!settings?.anonymousEnabled && <p className="muted small">Anonymous attendance is disabled by the publisher.</p>}
          </form>}
        </section>
      </div>}
      {signInGate && <div className="centered-page"><section className="card sign-in-card"><h1>Sign in required</h1><p className="muted">Sign in with your work account to open this page.</p><button className="primary" disabled={!connection || busy} onClick={signIn}>Sign in with Microsoft Entra</button></section></div>}
      {page === 'admin' && signedIn && !settings && !error && <p role="status">Checking administrator access...</p>}
      {page === 'admin' && signedIn && settings && !settings.isAdmin && <section className="card"><h1>Access denied</h1><p role="alert">Publisher controls require a bootstrapped administrator.</p></section>}
      {page === 'admin' && signedIn && settings?.isAdmin && <div className="publisher-page page-container">
        <div className="section-heading page-heading">{back}<h1>Publisher controls</h1></div>
        <section className="card"><h2>Anonymous attendance</h2><p className="muted">Disabling anonymous access denies all further guest operations, including existing guest sessions, after in-flight transactions finish. Previously downloaded public questions cannot be recalled.</p>
          <label className="check"><input type="checkbox" checked={settings.anonymousEnabled} disabled={busy} onChange={(e) => {
            const enabled = e.target.checked; void run(async (current) => { await call(connection!, { command: 'configure', enabled }); if (current()) await refresh(); });
          }} />Allow anonymous attendees (database setting)</label>
          <p className="muted small">Enable only after completing the public deployment and negative-authorization checks in the deployment guide.</p><p className="badge">Revocation generation: {settings.guestEpoch}</p>
        </section>
      </div>}
      {page === 'author' && signedIn && !authorReady && <p role="status">{error ? 'Session unavailable.' : 'Loading editor...'}</p>}
      {page === 'author' && signedIn && authorReady && <AuthorEditor key={routeKey} draft={draft} onChange={setDraft} editing={!!editing} readOnly={readOnly} anonymousEnabled={!!settings?.anonymousEnabled} busy={busy} onBack={home} onHost={editing ? () => host(editing) : undefined} onRevokePublic={editing && draft.visibility === 'public' ? () => void run(async (current) => {
        await call(connection!, { command: 'visibility', id: editing, visibility: 'internal' });
        if (current()) {
          const saved = await call<AuthorView>(connection!, { command: 'edit', id: editing });
          if (current()) { setDraft(saved.draft); setReadOnly(saved.readOnly); }
        }
      }) : undefined} onSave={() => void run(async (current) => {
        const saved = await call<{ id: string }>(connection!, { command: editing ? 'edit' : 'create', id: editing, draft: normalizeSurveyAuthoring(draft) });
        if (current()) host(saved.id);
      })} />}
      {route.page === 'game' && !route.host && ticket?.id !== route.id && <section className="card sign-in-card"><h1>Join this session</h1><p className="muted">The attendee credential is stored only in the tab where you joined.</p><button className="primary" onClick={() => navigate({ page: 'join', invitation: route.id })}>Join Quiz</button></section>}
      {route.page === 'game' && !signInGate && (route.host || ticket?.id === route.id) && (!game ? <div className="centered-page"><section className="card loading-card">{!error && <div className="loading-spinner" />}<p role="status">{error ? 'Session unavailable.' : 'Loading session...'}</p>{error && <button className="primary" onClick={home}>Back to Home</button>}</section></div> : <GameScreen game={game} host={showingHost} guest={!!ticket?.guest} nickname={nickname} seconds={seconds} joinUrl={joinUrl} busy={busy} onCopyError={(e) => setError(`Could not copy to clipboard: ${message(e)}`)} onHome={home} onControl={() => void run(async (current) => {
        await call(connection!, { command: 'control', id: game.id, action: game.phase === 'lobby' ? 'start' : 'next', version: game.version });
        if (!current()) return;
        const next = await call<GameView>(connection!, { command: 'host', id: game.id });
        if (current()) {
          setGame(next);
          if (route.host && route.lobby !== (next.phase === 'lobby')) navigate({ ...route, lobby: next.phase === 'lobby' }, true);
        }
      })} onAnswer={(option) => void run(current => submitAnswer({ option }, current))}
        onSurveyAnswer={(response) => void run(current => submitAnswer({ response }, current))} />)}
      {page === 'not-found' && <section className="card"><h1>Page not found</h1><p>The link is invalid or this page does not exist.</p><button className="primary" onClick={home}>Back to Home</button></section>}
    </main>
    <footer>QuizCrowd for Microsoft Fabric</footer>
  </>;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sessionKey(session: OpaqueSession | null): string {
  return session?.isAuthenticated && !session.isAnonymous ? session.user?.id ?? '' : '';
}
