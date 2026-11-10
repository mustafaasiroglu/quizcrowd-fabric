import { describe, expect, it } from 'vitest';
import {
  answer, control, createGame, Denied, join, preview, view,
  type Game, type Settings,
} from '../rayfin/functions/src/domain';
import { execute } from '../rayfin/functions/src/service';
import type { Store, UnitOfWork } from '../rayfin/functions/src/sql-store';

const enabled: Settings = { anonymousEnabled: true, guestEpoch: 0 };
const disabled: Settings = { anonymousEnabled: false, guestEpoch: 1 };
const draft = {
  title: 'Fabric Friday', mode: 'quiz', visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all',
  questions: [
    { text: 'Which service stores this quiz?', options: ['Fabric SQL', 'Browser memory'], correctIndex: 0, duration: 20 },
    { text: 'Which identity hosts?', options: ['Entra', 'Password'], correctIndex: 0, duration: 10 },
  ],
};
const make = (changes = {}) => createGame({ ...draft, ...changes }, 'owner', enabled, 1000);
const makePublic = (changes = {}) => make({ visibility: 'public', publicAcknowledged: true, ...changes });
const start = (g: Game) => control(g, 'start', g.version, 'owner', 2000);

describe('authorization and private projections', () => {
  it('defaults to internal and rejects anonymous creation', () => {
    expect(make().visibility).toBe('internal');
    const { visibility: _, ...withoutAudience } = draft;
    expect(createGame(withoutAudience, 'owner', enabled, 1000).visibility).toBe('internal');
    expect(() => createGame(draft, null, enabled, 1)).toThrow(Denied);
  });
  it('enforces authoring limits and rejects caller-assigned ownership', () => {
    const question = draft.questions[0];
    expect(make({ questions: Array.from({ length: 40 }, () => ({ ...question, duration: 5 })) }).questions).toHaveLength(40);
    expect(make({ questions: [{ ...question, duration: 120 }] }).questions[0].duration).toBe(120);
    expect(() => make({ questions: Array.from({ length: 41 }, () => question) })).toThrow();
    for (const duration of [4, 121]) expect(() => make({ questions: [{ ...question, duration }] })).toThrow();
    expect(() => make({ owner: 'another-account' })).toThrow();
  });
  it('caps new attendees at exactly 500', () => {
    const g = makePublic();
    for (let i = 0; i < 500; i++) join(g, `Player${i}`, null, enabled, 1000);
    expect(g.participants).toHaveLength(500);
    expect(() => join(g, 'Player500', null, enabled, 1000)).toThrow('500-attendee limit');
  });
  it('requires both global permission and public acknowledgement', () => {
    expect(() => make({ visibility: 'public' })).toThrow();
    expect(() => createGame({ ...draft, visibility: 'public', publicAcknowledged: true }, 'owner', disabled, 1)).toThrow();
  });
  it('denies guest preview/join for internal quizzes and global off', () => {
    expect(() => preview(make(), null, enabled)).toThrow();
    expect(() => join(make(), 'Guest', null, enabled, 1000)).toThrow();
    expect(() => preview(makePublic(), null, disabled)).toThrow();
  });
  it('publishes all question text/options, not answers, identities or responses', () => {
    const g = makePublic();
    join(g, 'Guest', null, enabled, 1000);
    const p = preview(g, null, enabled);
    expect(p.questions).toHaveLength(2);
    const json = JSON.stringify(p);
    for (const secret of ['correctIndex', 'owner', 'participants', 'tokenHash', 'Guest']) expect(json).not.toContain(secret);
  });
  it('binds signed-in tickets to verified account, not arbitrary row IDs', () => {
    const g = make();
    const ticket = join(g, 'Player', 'alice', enabled, 1000);
    expect(() => view(g, ticket.token, 'bob', enabled, 1500)).toThrow();
    expect(() => view(make(), ticket.token, 'alice', enabled, 1500)).toThrow();
    expect(() => view(g, g.participants[0].id, 'alice', enabled, 1500)).toThrow();
    expect(() => view(g, ticket.token, 'alice', enabled, 13 * 3600000)).toThrow();
  });
  it('resumes a signed-in participant by rotating their secret credential', () => {
    const g = make();
    const first = join(g, 'Alice', 'alice', enabled, 1000);
    start(g);
    const second = join(g, 'Alice', 'alice', enabled, 3000);
    expect(g.participants).toHaveLength(1);
    expect(() => view(g, first.token, 'alice', enabled, 3000)).toThrow();
    expect(view(g, second.token, 'alice', enabled, 3000).phase).toBe('question');
  });
  it('applies new-attendee status and audience gates even when the owner joins as an attendee', () => {
    for (const mode of ['quiz', 'survey']) {
      const questions = draft.questions.map(question => ({ ...question, correctIndex: mode === 'quiz' ? 0 : null }));
      const closed = make({ mode, questions });
      start(closed);
      expect(() => join(closed, 'Owner attendee', 'owner', enabled, 3000)).toThrow('not accepting new attendees');
      const open = make({ mode, questions, lateJoin: true });
      start(open);
      const ticket = join(open, 'Owner attendee', 'owner', enabled, 3000);
      expect(view(open, ticket.token, 'owner', enabled, 3000).phase).toBe('question');
      expect(open.participants[0].subject).toBe('owner');
      expect(() => join(open, 'Guest', null, enabled, 3000)).toThrow(Denied);
      open.phase = 'finished';
      expect(() => join(open, 'New attendee', 'new-subject', enabled, 3000)).toThrow('not accepting new attendees');
      expect(join(open, 'Owner attendee', 'owner', enabled, 3000).token).not.toBe(ticket.token);
    }
  });
  it('revokes existing guests and does not resurrect them when reenabled', () => {
    const g = makePublic();
    const ticket = join(g, 'Guest', null, enabled, 1000);
    expect(() => view(g, ticket.token, null, disabled, 1500)).toThrow();
    expect(() => answer(g, ticket.token, null, disabled, 0, 0, 1500)).toThrow();
    expect(() => view(g, ticket.token, null, { anonymousEnabled: true, guestEpoch: 2 }, 1500)).toThrow();
  });
  it('denies nonowner host control and host state even when signed in', () => {
    const g = makePublic();
    expect(() => control(g, 'start', 0, 'not-owner', 2000)).toThrow();
    expect(() => view(g, '', 'not-owner', enabled, 2000, true)).toThrow();
    expect(() => control(g, 'start', 0, null, 2000)).toThrow();
  });
  it('hides answer keys and other participant responses during questions', () => {
    const g = makePublic();
    const alice = join(g, 'Alice', null, enabled, 1000);
    const bob = join(g, 'Bob', null, enabled, 1000);
    start(g);
    expect(answer(g, alice.token, null, enabled, 0, 0, 3000)).toEqual({ accepted: true });
    const a = view(g, alice.token, null, enabled, 3000);
    const b = view(g, bob.token, null, enabled, 3000);
    expect(a.correctIndex).toBeUndefined(); expect(a.myResult).toBeUndefined();
    expect(b.myOption).toBeUndefined(); expect(b.rankings).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('participantId');
  });
  it('after_response reveals only after that attendee submits', () => {
    const g = makePublic({ showAnswer: 'after_response' });
    const a = join(g, 'A', null, enabled, 1000); const b = join(g, 'B', null, enabled, 1000);
    start(g); answer(g, a.token, null, enabled, 0, 0, 3000);
    expect(view(g, a.token, null, enabled, 3000).correctIndex).toBe(0);
    expect(view(g, b.token, null, enabled, 3000).correctIndex).toBeUndefined();
  });
  it('never does not expose a correctness key even after reveal', () => {
    const g = makePublic({ showAnswer: 'never' });
    const a = join(g, 'A', null, enabled, 1000);
    start(g); answer(g, a.token, null, enabled, 0, 0, 3000);
    expect(view(g, a.token, null, enabled, 3000).correctIndex).toBeUndefined();
  });
});
describe('game transitions and repeat submissions', () => {
  it('scores once, returns idempotent acknowledgement, and rejects changed responses', () => {
    const g = makePublic(); const a = join(g, 'A', null, enabled, 1000);
    start(g); answer(g, a.token, null, enabled, 0, 0, 3000);
    expect(g.participants[0].score).toBe(1475);
    answer(g, a.token, null, enabled, 0, 0, 3001);
    expect(g.participants[0].score).toBe(1475); expect(g.answers).toHaveLength(1);
    expect(() => answer(g, a.token, null, enabled, 0, 1, 3002)).toThrow();
  });
  it('runs the complete game flow and rejects stale host versions', () => {
    const g = makePublic(); const a = join(g, 'A', null, enabled, 1000);
    start(g); answer(g, a.token, null, enabled, 0, 0, 3000);
    expect(g.phase).toBe('reveal');
    expect(view(g, a.token, null, enabled, 7000).phase).toBe('leaderboard');
    const version = g.version; control(g, 'next', version, 'owner', 7100);
    expect(() => control(g, 'next', version, 'owner', 7101)).toThrow();
    answer(g, a.token, null, enabled, 1, 0, 8100);
    expect(view(g, a.token, null, enabled, 12100).rankings?.[0].streak).toBe(2);
    control(g, 'next', g.version, 'owner', 12200);
    expect(g.phase).toBe('finished');
  });
  it('rejects late answers, resets missed streaks, and honors late-join policy', () => {
    const g = makePublic(); const a = join(g, 'A', null, enabled, 1000);
    g.participants[0].streak = 4; start(g);
    expect(() => join(g, 'B', null, enabled, 3000)).toThrow();
    expect(() => answer(g, a.token, null, enabled, 0, 0, 22000)).toThrow();
    expect(g.participants[0].streak).toBe(0);
  });
  it('supports surveys with aggregated results and no answer key or scoring', () => {
    const g = makePublic({ mode: 'survey', questions: [{ ...draft.questions[0], correctIndex: null }] });
    const a = join(g, 'A', null, enabled, 1000);
    start(g); answer(g, a.token, null, enabled, 0, 1, 3000);
    const result = view(g, a.token, null, enabled, 3000);
    expect(result.distribution).toEqual([0, 1]);
    expect(result.correctIndex).toBeUndefined(); expect(result.myResult).toBeUndefined();
    expect(g.participants[0].score).toBe(0);
  });
});

// A serialized test double, not a SQL emulator or proof of platform permissions.
function fixture(game = makePublic()) {
  let settings = { ...enabled }; let document = structuredClone(game);
  let queue = Promise.resolve();
  const uow: UnitOfWork = {
    settings: async () => ({ ...settings }),
    isAdmin: async (s) => s === 'trusted-admin',
    setAnonymous: async (_, value) => (settings = { anonymousEnabled: value, guestEpoch: settings.guestEpoch + 1 }),
    get: async (id) => id === document.id || id === document.code ? structuredClone(document) : null,
    save: async (g) => { document = structuredClone(g); },
    remove: async () => { throw new Error('not used'); },
    list: async (s) => s === document.owner ? [structuredClone(document)] : [],
  };
  const store: Store = {
    transact<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
      const current = queue.then(() => work(uow));
      queue = current.then(() => undefined, () => undefined);
      return current;
    },
  };
  return { store, game, saved: () => document };
}
describe('service boundary with mocked transactional store', () => {
  it('requires bootstrap admin, not merely an authenticated user', async () => {
    const { store } = fixture();
    await expect(execute(store, { command: 'configure', enabled: false }, 'owner', '')).rejects.toThrow();
    await expect(execute(store, { command: 'configure', enabled: false }, null, '')).rejects.toThrow();
    await expect(execute(store, { command: 'configure', enabled: false }, 'trusted-admin', '')).resolves.toMatchObject({ anonymousEnabled: false });
  });
  it('denies guest authoring, library enumeration, editing and config', async () => {
    const { store, game } = fixture();
    for (const command of ['list', 'edit', 'delete', 'host', 'configure', 'create']) {
      await expect(execute(store, { command, id: game.id, enabled: true }, null, '')).rejects.toThrow();
    }
    await expect(execute(store, { command: 'list' }, 'not-owner', '')).resolves.toEqual([]);
  });
  it('serializes competing submissions and records exactly one award', async () => {
    const f = fixture();
    const a = await execute(f.store, { command: 'join', id: f.game.id, nickname: 'Guest' }, null, '', 1000) as { token: string };
    await execute(f.store, { command: 'control', id: f.game.id, action: 'start', version: 0 }, 'owner', '', 2000);
    await Promise.all(Array.from({ length: 10 }, () =>
      execute(f.store, { command: 'answer', id: f.game.id, questionIndex: 0, option: 0 }, null, a.token, 3000)));
    expect(f.saved().answers).toHaveLength(1); expect(f.saved().participants[0].score).toBe(1475);
  });
  it('accepts one competing answer and one versioned host transition', async () => {
    const f = fixture();
    const a = await execute(f.store, { command: 'join', id: f.game.id, nickname: 'Guest' }, null, '', 1000) as { token: string };
    await execute(f.store, { command: 'control', id: f.game.id, action: 'start', version: 0 }, 'owner', '', 2000);
    const answers = await Promise.allSettled([0, 1].map((option) =>
      execute(f.store, { command: 'answer', id: f.game.id, questionIndex: 0, option }, null, a.token, 3000)));
    expect(answers.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(f.saved().answers).toHaveLength(1);
    expect(f.saved().participants[0].score).toBe(1475);
    await execute(f.store, { command: 'host', id: f.game.id }, 'owner', '', 7000);
    const version = f.saved().version;
    const controls = await Promise.allSettled([0, 1].map(() =>
      execute(f.store, { command: 'control', id: f.game.id, action: 'next', version }, 'owner', '', 7100)));
    expect(controls.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(f.saved().questionIndex).toBe(1);
  });
  it('rechecks DB switch on every existing guest operation', async () => {
    const f = fixture();
    const a = await execute(f.store, { command: 'join', id: f.game.id, nickname: 'Guest' }, null, '', 1000) as { token: string };
    await execute(f.store, { command: 'configure', enabled: false }, 'trusted-admin', '', 1100);
    for (const command of ['preview', 'state', 'join', 'answer']) {
      await expect(execute(f.store, { command, id: f.game.id, nickname: 'New', option: 0, questionIndex: 0 }, null, a.token, 1200)).rejects.toThrow();
    }
  });
  it('allows creator to revoke per-quiz public access during a running game', async () => {
    const f = fixture();
    const a = await execute(f.store, { command: 'join', id: f.game.id, nickname: 'Guest' }, null, '', 1000) as { token: string };
    await expect(execute(f.store, { command: 'visibility', id: f.game.id, visibility: 'internal' }, 'not-owner', '')).rejects.toThrow();
    await execute(f.store, { command: 'visibility', id: f.game.id, visibility: 'internal' }, 'owner', '');
    await expect(execute(f.store, { command: 'state', id: f.game.id }, null, a.token, 1200)).rejects.toThrow();
  });
});
