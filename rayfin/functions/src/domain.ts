import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Draft, GameView, Phase, QuizSummary, SettingsView } from '@rayfin-app/shared';

export class Denied extends Error {}
export class Conflict extends Error {}
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  mode: z.enum(['quiz', 'survey']),
  visibility: z.enum(['internal', 'public']).default('internal'),
  publicAcknowledged: z.boolean().default(false),
  lateJoin: z.boolean().default(false),
  showAnswer: z.enum(['wait_all', 'after_response', 'never']).default('wait_all'),
  questions: z.array(z.object({
    text: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(6)
      .refine((xs) => new Set(xs).size === xs.length, 'Options must be distinct'),
    correctIndex: z.number().int().min(0).nullable(),
    duration: z.number().int().min(5).max(120),
  }).strict()).min(1).max(40),
}).strict().superRefine((draft, ctx) => {
  draft.questions.forEach((q, i) => {
    if (draft.mode === 'quiz' && (q.correctIndex === null || q.correctIndex >= q.options.length)) {
      ctx.addIssue({ code: 'custom', message: 'Select a correct answer', path: ['questions', i] });
    }
    if (draft.mode === 'survey' && q.correctIndex !== null) {
      ctx.addIssue({ code: 'custom', message: 'Surveys cannot have an answer key', path: ['questions', i] });
    }
  });
});

export interface Settings {
  anonymousEnabled: boolean;
  guestEpoch: number;
}
export interface Participant {
  id: string;
  nickname: string;
  subject: string | null;
  tokenHash: string;
  expiresAt: number;
  guestEpoch: number;
  score: number;
  streak: number;
}
export interface Answer {
  participantId: string;
  questionIndex: number;
  option: number;
  correct: boolean;
  points: number;
}
export interface Game extends Draft {
  id: string;
  code: string;
  owner: string;
  createdAt: number;
  phase: Phase;
  version: number;
  questionIndex: number;
  questionStartedAt: number;
  revealStartedAt: number;
  participants: Participant[];
  answers: Answer[];
}
export const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
export function signed(subject: string | null): string {
  if (!subject) throw new Denied('Sign in with Microsoft Entra to perform this operation.');
  return subject;
}
export function own(game: Game, subject: string | null): void {
  if (game.owner !== signed(subject)) throw new Denied('Only the quiz creator can manage this game.');
}
export function guestAllowed(game: Game, settings: Settings): void {
  if (!settings.anonymousEnabled || game.visibility !== 'public') {
    throw new Denied('Anonymous attendance is disabled or this quiz is internal only.');
  }
}
export function visibilityAllowed(draft: Draft, settings: Settings): void {
  if (draft.visibility === 'public' && (!settings.anonymousEnabled || !draft.publicAcknowledged)) {
    throw new Denied('Public quizzes require enabled guest access and explicit acknowledgement.');
  }
}
export function createGame(input: unknown, subject: string | null, settings: Settings, now: number): Game {
  const owner = signed(subject);
  const draft = draftSchema.parse(input);
  visibilityAllowed(draft, settings);
  return {
    ...draft, id: randomUUID(), code: randomInt(1000000).toString().padStart(6, '0'),
    owner, createdAt: now, phase: 'lobby', version: 0, questionIndex: -1,
    questionStartedAt: 0, revealStartedAt: 0, participants: [], answers: [],
  };
}
export const readOnly = (game: Game): boolean => game.phase !== 'lobby' || game.answers.length > 0;
export function summary(game: Game): QuizSummary {
  const { id, code, title, mode, phase, visibility, createdAt } = game;
  return { id, code, title, mode, phase, visibility, createdAt,
    participantCount: game.participants.length, responseCount: game.answers.length, readOnly: readOnly(game) };
}
export function authorDraft(game: Game): Draft {
  const { title, mode, visibility, publicAcknowledged, lateJoin, showAnswer, questions } = game;
  return { title, mode, visibility, publicAcknowledged, lateJoin, showAnswer, questions };
}
export function preview(game: Game, subject: string | null, settings: Settings) {
  if (!subject) guestAllowed(game, settings);
  return {
    id: game.id, code: game.code, title: game.title, mode: game.mode,
    questions: game.questions.map(({ text, options, duration }) => ({ text, options, duration })),
  };
}
export function participant(
  game: Game, token: string, subject: string | null, settings: Settings, now: number,
): Participant {
  if (!token || token.length > 128) throw new Denied('Join the quiz first.');
  const p = game.participants.find((item) => item.tokenHash === hash(token));
  if (!p || p.expiresAt <= now || p.subject !== subject) throw new Denied('Attendee session is invalid or expired.');
  if (p.subject === null) {
    guestAllowed(game, settings);
    if (p.guestEpoch !== settings.guestEpoch) throw new Denied('Guest session was revoked. Join again.');
  }
  return p;
}
export function join(game: Game, nickname: unknown, subject: string | null, settings: Settings, now: number) {
  if (!subject) guestAllowed(game, settings);
  const returning = subject && game.participants.find((p) => p.subject === subject);
  if (returning) {
    const token = randomBytes(32).toString('base64url');
    returning.tokenHash = hash(token);
    returning.expiresAt = now + 12 * 60 * 60 * 1000;
    return { id: game.id, token };
  }
  advance(game, now);
  if (game.phase === 'finished' || (game.phase !== 'lobby' && !game.lateJoin)) {
    throw new Conflict('This game is not accepting new attendees.');
  }
  const name = z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N} _.-]+$/u).parse(nickname);
  if (game.participants.length >= 500) throw new Conflict('The 500-attendee limit has been reached.');
  if (game.participants.some((p) => p.nickname.toLowerCase() === name.toLowerCase())) {
    throw new Conflict('Nickname is already in use.');
  }
  const token = randomBytes(32).toString('base64url');
  game.participants.push({
    id: randomUUID(), nickname: name, subject, tokenHash: hash(token),
    expiresAt: now + 12 * 60 * 60 * 1000, guestEpoch: settings.guestEpoch, score: 0, streak: 0,
  });
  return { id: game.id, token };
}
function reveal(game: Game, now: number): void {
  for (const p of game.participants) {
    if (!game.answers.some((a) => a.participantId === p.id && a.questionIndex === game.questionIndex)) {
      p.streak = 0;
    }
  }
  game.phase = 'reveal';
  game.revealStartedAt = now;
  game.version++;
}
export function advance(game: Game, now: number): void {
  if (game.phase === 'question') {
    const count = game.answers.filter((a) => a.questionIndex === game.questionIndex).length;
    if (now >= game.questionStartedAt + game.questions[game.questionIndex].duration * 1000 ||
        (game.participants.length > 0 && count === game.participants.length)) reveal(game, now);
  }
  if (game.phase === 'reveal' && now >= game.revealStartedAt + 4000) {
    game.phase = 'leaderboard';
    game.version++;
  }
}
export function control(game: Game, action: string, version: number, subject: string | null, now: number): void {
  own(game, subject);
  advance(game, now);
  if (version !== game.version) throw new Conflict('Game changed; refresh before trying again.');
  if (action === 'start' && game.phase === 'lobby') {
    game.questionIndex = 0;
  } else if (action === 'next' && game.phase === 'leaderboard') {
    if (game.questionIndex === game.questions.length - 1) {
      game.phase = 'finished';
      game.version++;
      return;
    }
    game.questionIndex++;
  } else throw new Conflict('That host action is not valid in this phase.');
  game.phase = 'question';
  game.questionStartedAt = now;
  game.version++;
}
export function answer(
  game: Game, token: string, subject: string | null, settings: Settings,
  questionIndex: number, option: number, now: number,
): { accepted: true } {
  const p = participant(game, token, subject, settings, now);
  const existing = game.answers.find((a) => a.participantId === p.id && a.questionIndex === questionIndex);
  if (existing) {
    if (existing.option !== option) throw new Conflict('An answer cannot be changed.');
    return { accepted: true };
  }
  advance(game, now);
  if (game.phase !== 'question' || questionIndex !== game.questionIndex) throw new Conflict('Question is closed.');
  const question = game.questions[questionIndex];
  if (!Number.isInteger(option) || option < 0 || option >= question.options.length) {
    throw new Conflict('Invalid response option.');
  }
  const correct = game.mode === 'quiz' && option === question.correctIndex;
  const ratio = Math.max(0, 1 - (now - game.questionStartedAt) / (question.duration * 1000));
  const points = correct ? 1000 + Math.round(ratio * 500) : 0;
  p.score += points;
  p.streak = correct ? p.streak + 1 : 0;
  game.answers.push({ participantId: p.id, questionIndex, option, correct, points });
  advance(game, now);
  return { accepted: true };
}
export function view(
  game: Game, token: string, subject: string | null, settings: Settings, now: number, host = false,
): GameView {
  if (host) own(game, subject);
  const p = host ? undefined : participant(game, token, subject, settings, now);
  advance(game, now);
  const answers = game.answers.filter((a) => a.questionIndex === game.questionIndex);
  const mine = p && answers.find((a) => a.participantId === p.id);
  const q = game.questions[game.questionIndex];
  const result: GameView = {
    id: game.id, code: game.code, title: game.title, mode: game.mode,
    phase: game.phase, version: game.version, questionIndex: game.questionIndex,
    totalQuestions: game.questions.length, serverNow: now,
    players: game.participants.map((p) => p.nickname), answerCount: answers.length,
  };
  if (q) {
    result.question = { text: q.text, options: q.options, duration: q.duration };
    result.questionStartedAt = game.questionStartedAt;
  }
  if (mine) result.myOption = mine.option;
  const revealed = game.phase !== 'question' && game.phase !== 'lobby';
  const showOwn = revealed || (game.showAnswer === 'after_response' && !!mine);
  if (q && game.mode === 'quiz' && game.showAnswer !== 'never' && showOwn) {
    result.correctIndex = q.correctIndex ?? undefined;
  }
  if (mine && p && showOwn && game.mode === 'quiz') {
    result.myResult = { correct: mine.correct, points: mine.points, score: p.score };
  }
  if (revealed && q) result.distribution = q.options.map((_, i) => answers.filter((a) => a.option === i).length);
  if (game.phase === 'leaderboard' || game.phase === 'finished') {
    result.rankings = [...game.participants].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
      .map((p, i) => ({ nickname: p.nickname, score: p.score, streak: p.streak, rank: i + 1 }));
  }
  return result;
}
export function settingsView(settings: Settings, isAdmin: boolean): SettingsView {
  return { ...settings, isAdmin };
}
