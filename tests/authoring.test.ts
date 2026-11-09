import sql from 'mssql';
import { describe, expect, it, vi } from 'vitest';
import { execute } from '../rayfin/functions/src/service';
import { authorDraft, createGame, draftSchema } from '../rayfin/functions/src/domain';
import { isJoinCodeCollision, retryJoinCode, type Store, type UnitOfWork } from '../rayfin/functions/src/sql-store';

const random = vi.hoisted(() => ({ value: 7 }));
vi.mock('node:crypto', async (original) => ({ ...await original<typeof import('node:crypto')>(), randomInt: () => random.value++ }));
const settings = { anonymousEnabled: false, guestEpoch: 0 };
const draft = { title: 'Team session', mode: 'quiz', visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all', questions: [{ text: 'Question', options: ['A', 'B'], correctIndex: 0, duration: 20 }] };
function fixture() {
  let games = [createGame(draft, 'owner', settings, 1000)];
  const legacy = 'A1B2C3D4E5';
  let queue = Promise.resolve();
  const store: Store = { transact<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      let working = structuredClone(games);
      const tx: UnitOfWork = {
        settings: async () => ({ ...settings }), isAdmin: async (s) => s === 'admin',
        setAnonymous: async () => { throw Error('Not used'); },
        get: async (key) => working.find((g) => g.id === key || g.code === key || (key === legacy && g.id === games[0].id)) ?? null,
        save: async (g, create) => { if (create) working.push(g); else working = working.map((old) => old.id === g.id ? g : old); },
        list: async (s) => working.filter((g) => g.owner === s), remove: async (id) => { working = working.filter((g) => g.id !== id); },
      };
      const value = await work(tx); games = working; return value;
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  } };
  return { store, legacy, games: () => games, game: () => games[0] };
}
describe('six-digit codes and owner authoring transactions (test store)', () => {
  it('rejects quiz/survey type mutation and duplicates the original type', async () => {
    const f = fixture();
    const survey = { ...draft, mode: 'survey', questions: draft.questions.map(q => ({ ...q, correctIndex: null })) };
    await expect(execute(f.store, { command: 'edit', id: f.game().id, draft: survey }, 'owner', '')).rejects.toThrow('Content type cannot be changed');
    expect(f.game().mode).toBe('quiz');
    const copy = await execute(f.store, { command: 'duplicate', id: f.game().id }, 'owner', '') as { id: string };
    expect(f.games().find(g => g.id === copy.id)?.mode).toBe('quiz');
    const created = await execute(f.store, { command: 'create', draft: survey }, 'owner', '') as { id: string };
    await expect(execute(f.store, { command: 'edit', id: created.id, draft }, 'owner', '')).rejects.toThrow('Content type cannot be changed');
  });
  it('preserves actual question durations through save, reopen and duplicate without mode metadata', async () => {
    const f = fixture();
    const same = { ...authorDraft(f.game()), questions: f.game().questions.map(q => ({ ...q, duration: 35 })) };
    await execute(f.store, { command: 'edit', id: f.game().id, draft: same }, 'owner', '');
    expect(f.game().questions.map(q => q.duration)).toEqual([35]);
    expect(await execute(f.store, { command: 'edit', id: f.game().id }, 'owner', '')).toMatchObject({ draft: { questions: [{ duration: 35 }] } });
    const custom = { ...same, questions: [...same.questions, { ...same.questions[0], text: 'Second', duration: 50 }] };
    await execute(f.store, { command: 'edit', id: f.game().id, draft: custom }, 'owner', '');
    const copy = await execute(f.store, { command: 'duplicate', id: f.game().id }, 'owner', '') as { id: string };
    expect(f.games().find(g => g.id === copy.id)).toMatchObject({ questions: [{ duration: 35 }, { duration: 50 }] });
    for (const game of f.games()) expect(game).not.toHaveProperty('answerDuration');
    expect(f.game().questions.map(q => q.duration)).toEqual([35, 50]);
    f.game().phase = 'question';
    await expect(execute(f.store, { command: 'edit', id: f.game().id, draft: same }, 'owner', '')).rejects.toThrow('read-only');
    expect(f.game().questions.map(q => q.duration)).toEqual([35, 50]);
  });
  it('returns existing mixed durations unchanged without rewriting stored content on read', async () => {
    const f = fixture();
    f.game().questions.push({ ...f.game().questions[0], duration: 50 });
    const before = structuredClone(f.game());
    expect(await execute(f.store, { command: 'edit', id: f.game().id }, 'owner', '')).toMatchObject({ draft: { questions: [{ duration: 20 }, { duration: 50 }] } });
    expect(f.game()).toEqual(before);
    const copy = await execute(f.store, { command: 'duplicate', id: f.game().id }, 'owner', '') as { id: string };
    expect(f.games().find(g => g.id === copy.id)?.questions.map(q => q.duration)).toEqual([20, 50]);
  });
  it('validates real question durations and rejects unnecessary duration-mode metadata', () => {
    expect(createGame(draft, 'owner', settings, 1000)).not.toHaveProperty('answerDuration');
    for (const seconds of [0, 4, 121, 20.5, '20']) {
      expect(draftSchema.safeParse({ ...draft, questions: draft.questions.map(q => ({ ...q, duration: seconds })) }).success).toBe(false);
    }
    expect(draftSchema.safeParse({ ...draft, answerDuration: { mode: 'same', seconds: 30 } }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, answerDuration: { mode: 'custom', seconds: 30 } }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, questions: [5, 120].map(duration => ({ ...draft.questions[0], duration })) }).success).toBe(true);
  });
  it('uses the saved question duration for real scoring', async () => {
    const f = fixture();
    const same = { ...authorDraft(f.game()), questions: f.game().questions.map(q => ({ ...q, duration: 40 })) };
    await execute(f.store, { command: 'edit', id: f.game().id, draft: same }, 'owner', '');
    const ticket = await execute(f.store, { command: 'join', id: f.game().id, nickname: 'A' }, 'a', '', 1000) as { token: string };
    await execute(f.store, { command: 'control', id: f.game().id, action: 'start', version: f.game().version }, 'owner', '', 2000);
    await execute(f.store, { command: 'answer', id: f.game().id, questionIndex: 0, option: 0 }, 'a', ticket.token, 22000);
    expect(f.game().answers[0].points).toBe(1250);
  });
  it.each(['quiz', 'survey'] as const)('uses per-question custom timeouts for %s without changing timed live semantics', async (mode) => {
    const f = fixture();
    const custom = { ...authorDraft(f.game()),
      questions: [35, 50].map((duration, i) => ({ ...f.game().questions[0], text: `Question ${i}`, duration })) };
    if (mode === 'survey') {
      f.game().mode = 'survey'; custom.mode = 'survey'; custom.questions.forEach(q => { q.correctIndex = null; });
    }
    await execute(f.store, { command: 'edit', id: f.game().id, draft: custom }, 'owner', '');
    const ticket = await execute(f.store, { command: 'join', id: f.game().id, nickname: 'A' }, 'a', '', 1000) as { token: string };
    await execute(f.store, { command: 'control', id: f.game().id, action: 'start', version: f.game().version }, 'owner', '', 2000);
    expect(await execute(f.store, { command: 'state', id: f.game().id }, 'a', ticket.token, 36999)).toMatchObject({ phase: 'question', question: { duration: 35 } });
    expect(await execute(f.store, { command: 'state', id: f.game().id }, 'a', ticket.token, 37000)).toMatchObject({ phase: 'reveal' });
    await execute(f.store, { command: 'host', id: f.game().id }, 'owner', '', 42000);
    await execute(f.store, { command: 'control', id: f.game().id, action: 'next', version: f.game().version }, 'owner', '', 42001);
    expect(await execute(f.store, { command: 'state', id: f.game().id }, 'a', ticket.token, 92000)).toMatchObject({ phase: 'question', question: { duration: 50 } });
    expect(await execute(f.store, { command: 'state', id: f.game().id }, 'a', ticket.token, 92001)).toMatchObject({ phase: 'reveal' });
  });
  it('creates numeric string codes with leading zeros and keeps IDs private routing identifiers', async () => {
    random.value = 7;
    const f = fixture();
    expect(f.game().code).toBe('000007');
    expect(f.game().id).not.toBe(f.game().code);
    expect(await execute(f.store, { command: 'resolve', id: '000007' }, 'attendee', '')).toEqual({ code: '000007' });
    expect(await execute(f.store, { command: 'resolve', id: f.legacy }, 'attendee', '')).toEqual({ code: '000007' });
    expect(await execute(f.store, { command: 'resolve', id: f.game().id }, 'attendee', '')).toEqual({ code: '000007' });
    await expect(execute(f.store, { command: 'resolve', id: f.game().id }, null, '')).rejects.toThrow();
    for (const id of ['12345', '1234567', '12345X', '------------------------------------']) {
      await expect(execute(f.store, { command: 'join', id, nickname: 'A' }, 'attendee', '')).rejects.toThrow();
    }
  });
  it('lists actual metadata without keys, subjects or participant records', async () => {
    const f = fixture(); f.game().participants.push({ id: 'p', nickname: 'P', subject: 'a', tokenHash: 'secret', expiresAt: 9999, guestEpoch: 0, score: 0, streak: 0 });
    f.game().answers.push({ participantId: 'p', questionIndex: 0, option: 0, correct: true, points: 2 }, { participantId: 'p', questionIndex: 1, option: 0, correct: true, points: 2 });
    const result = await execute(f.store, { command: 'list' }, 'owner', '');
    expect(result).toMatchObject([{ mode: 'quiz', createdAt: 1000, participantCount: 1, questionCount: 1, responseCount: 2, readOnly: true }]);
    for (const secret of ['correctIndex', 'tokenHash', 'participantId', 'owner']) expect(JSON.stringify(result)).not.toContain(secret);
    expect(await execute(f.store, { command: 'list' }, 'stranger', '')).toEqual([]);
  });
  it.each(['question', 'reveal', 'leaderboard', 'finished'] as const)('locks %s even with no answers and allows owner view/host', async (phase) => {
    const f = fixture(); f.game().phase = phase;
    expect(await execute(f.store, { command: 'edit', id: f.game().id }, 'owner', '')).toMatchObject({ readOnly: true, draft: { title: draft.title } });
    await expect(execute(f.store, { command: 'edit', id: f.game().id, draft: { ...draft, title: 'Changed' } }, 'owner', '')).rejects.toThrow('read-only');
    expect(f.game().title).toBe(draft.title);
    await expect(execute(f.store, { command: 'edit', id: f.game().id }, 'stranger', '')).rejects.toThrow();
  });
  it('locks a lobby with a response but permits an unanswered lobby with participants', async () => {
    const f = fixture();
    await execute(f.store, { command: 'join', id: f.game().code, nickname: 'A' }, 'a', '', 1001);
    await execute(f.store, { command: 'edit', id: f.game().id, draft: { ...draft, title: 'Before start' } }, 'owner', '');
    expect(f.game().participants).toHaveLength(1);
    f.game().answers.push({ participantId: f.game().participants[0].id, questionIndex: 0, option: 0, correct: true, points: 1 });
    await expect(execute(f.store, { command: 'edit', id: f.game().id, draft }, 'owner', '')).rejects.toThrow('read-only');
  });
  it('serializes host start against edits and keeps host next independent of editor lock', async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      execute(f.store, { command: 'control', id: f.game().id, action: 'start', version: 0 }, 'owner', '', 1001),
      execute(f.store, { command: 'edit', id: f.game().id, draft }, 'owner', '', 1001),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    f.game().phase = 'leaderboard';
    await expect(execute(f.store, { command: 'control', id: f.game().id, action: 'next', version: f.game().version }, 'owner', '', 1002)).resolves.toEqual({ updated: true });
  });
  it('duplicates a started public source into a fresh private session without copying activity', async () => {
    const f = fixture(); f.game().visibility = 'public'; f.game().publicAcknowledged = true; f.game().phase = 'finished';
    f.game().answers.push({ participantId: 'p', questionIndex: 0, option: 0, correct: true, points: 2 });
    const source = structuredClone(f.game());
    const copy = await execute(f.store, { command: 'duplicate', id: source.id }, 'owner', '', 5000) as { id: string; code: string };
    const created = f.games().find((g) => g.id === copy.id)!;
    expect(copy.code).toMatch(/^\d{6}$/); expect(copy.id).not.toBe(source.id); expect(copy.code).not.toBe(source.code);
    expect(created).toMatchObject({ owner: 'owner', createdAt: 5000, visibility: 'internal', publicAcknowledged: false, phase: 'lobby', version: 0, questionIndex: -1, participants: [], answers: [], questions: source.questions });
    expect(f.game()).toEqual(source);
    for (const subject of [null, 'stranger', 'admin']) await expect(execute(f.store, { command: 'duplicate', id: source.id }, subject, '')).rejects.toThrow();
  });
  it('limits delete to the owner, not another creator or global config admin', async () => {
    const f = fixture();
    for (const subject of [null, 'stranger', 'admin']) await expect(execute(f.store, { command: 'delete', id: f.game().id }, subject, '')).rejects.toThrow();
    await execute(f.store, { command: 'delete', id: f.game().id }, 'owner', '');
    expect(f.games()).toEqual([]);
  });
});
describe('SQL uniqueness retry boundary', () => {
  function collision(number = 2627, name = 'UQ_QuizCrowdCode') {
    const error = new sql.RequestError(`Violation of ${name}`, 'EREQUEST'); error.number = number; return error;
  }
  it('retries only real Code uniqueness failures after full rollback and regenerates code', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const codes: string[] = [];
      const result = await retryJoinCode(async () => {
        const game = createGame(draft, 'owner', settings, 1000); codes.push(game.code);
        if (codes.length < 3) throw collision();
        return game;
      });
      expect(codes).toHaveLength(3); expect(new Set(codes).size).toBe(3); expect(result.code).toBe(codes[2]);
      expect(isJoinCodeCollision(collision(2601))).toBe(true);
      for (const error of [collision(2627, 'PK_QuizCrowdGames'), collision(1205), Error('UQ_QuizCrowdCode')]) {
        expect(isJoinCodeCollision(error)).toBe(false);
        let attempts = 0;
        await expect(retryJoinCode(async () => { attempts++; throw error; })).rejects.toBe(error);
        expect(attempts).toBe(1);
      }
      let attempts = 0;
      await expect(retryJoinCode(async () => { attempts++; throw collision(); })).rejects.toThrow('UQ_QuizCrowdCode');
      expect(attempts).toBe(6);
    } finally { warning.mockRestore(); }
  });
});
