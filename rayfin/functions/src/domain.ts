import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Draft, GameView, Phase, Question, QuizSummary, SettingsView, SurveyResponse } from '@rayfin-app/shared';
import { decodeSurveyResponse, encodeSurveyResponse, getAnswerDuration, MAX_OPTIONS, MAX_TITLE_LENGTH, MAX_SURVEY_ANSWER_LENGTH, MAX_SURVEY_TEXT_LENGTH, SURVEY_TEXT_PAGE_SIZE } from '@rayfin-app/shared';

export class Denied extends Error {}
export class InvitationDenied extends Denied {}
export class Conflict extends Error {}
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  mode: z.enum(['quiz', 'survey']),
  visibility: z.enum(['internal', 'public']).default('internal'),
  publicAcknowledged: z.boolean().default(false),
  lateJoin: z.boolean().default(false),
  pinRequired: z.boolean().default(false),
  showAnswer: z.enum(['wait_all', 'after_response', 'never']).default('wait_all'),
  answerDuration: z.object({ mode: z.enum(['same', 'custom']), seconds: z.number().int().min(5).max(120) }).strict().optional(),
  questions: z.array(z.object({
    text: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).max(MAX_OPTIONS)
      .refine((xs) => new Set(xs).size === xs.length, 'Options must be distinct'),
    correctIndex: z.number().int().min(0).nullable(),
    duration: z.number().int().min(5).max(120),
    survey: z.object({ other: z.boolean(), allowMultiple: z.boolean() }).strict().optional(),
  }).strict()).min(1).max(40),
}).strict().superRefine((draft, ctx) => {
  draft.questions.forEach((q, i) => {
    if (q.options.length < 2 && !(draft.mode === 'survey' && q.survey?.other)) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least two options or enable Other for a survey', path: ['questions', i, 'options'] });
    }
    if (draft.mode === 'quiz' && q.survey) {
      ctx.addIssue({ code: 'custom', message: 'Other and multiple selection are only supported by surveys', path: ['questions', i, 'survey'] });
    }
    if (q.survey?.allowMultiple && !q.options.length) {
      ctx.addIssue({ code: 'custom', message: 'Other-only questions cannot allow multiple choices', path: ['questions', i, 'survey'] });
    }
    if (draft.answerDuration?.mode === 'same' && q.duration !== draft.answerDuration.seconds) {
      ctx.addIssue({ code: 'custom', message: 'Every question must use the shared answer duration', path: ['questions', i, 'duration'] });
    }
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
interface AnswerBase {
  participantId: string;
  questionIndex: number;
  correct: boolean;
  points: number;
}
export type Answer = AnswerBase & ({ option: number; format?: undefined } | { option: string; format: 'survey-v1' });
export interface Game extends Draft {
  invitationPin?: { value: string; salt: string; digest: string; failures: number; windowStartedAt: number };
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
export function createJoinCode(): string {
  const suffix = randomInt(100000).toString().padStart(5, '0');
  const check = [...suffix].reduce((sum, digit) => sum + Number(digit), 0) % 10;
  return `${check}${suffix}`;
}
export function createGame(input: unknown, subject: string | null, settings: Settings, now: number): Game {
  const owner = signed(subject);
  const draft = draftSchema.parse(input);
  visibilityAllowed(draft, settings);
  const game: Game = {
    ...draft, answerDuration: getAnswerDuration(draft), id: randomUUID(), code: createJoinCode(),
    owner, createdAt: now, phase: 'lobby', version: 0, questionIndex: -1,
    questionStartedAt: 0, revealStartedAt: 0, participants: [], answers: [],
  };
  setInvitationPin(game, draft.pinRequired, now);
  return game;
}
export function setInvitationPin(game: Game, required: boolean, now: number): void {
  if (!required) { delete game.invitationPin; return; }
  if (game.invitationPin) return;
  const value = randomInt(10000).toString().padStart(4, '0'), salt = randomBytes(32).toString('hex');
  game.invitationPin = { value, salt, digest: hash(`${salt}:${value}`), failures: 0, windowStartedAt: now };
}
function checkInvitationPin(game: Game, pin: string | undefined, now: number): void {
  const gate = game.invitationPin;
  if (!gate) {
    if (game.pinRequired) throw new Error('Invitation PIN configuration is missing.');
    return;
  }
  if (now >= gate.windowStartedAt + 10 * 60 * 1000) { gate.failures = 0; gate.windowStartedAt = now; }
  if (gate.failures >= 5) throw new InvitationDenied('Invitation could not be verified. Check the code/PIN or try again later.');
  if (!pin || !/^\d{4}$/.test(pin) || !timingSafeEqual(Buffer.from(gate.digest, 'hex'), Buffer.from(hash(`${gate.salt}:${pin}`), 'hex'))) {
    gate.failures++;
    throw new InvitationDenied('Invitation could not be verified. Check the code/PIN or try again later.');
  }
}
export const readOnly = (game: Game): boolean => game.phase !== 'lobby' || game.answers.length > 0;
export function summary(game: Game): QuizSummary {
  const { id, code, title, mode, phase, visibility, createdAt } = game;
  return { id, code, title, mode, phase, visibility, createdAt,
    participantCount: game.participants.length, questionCount: game.questions.length, responseCount: game.answers.length, readOnly: readOnly(game) };
}
export function authorDraft(game: Game): Draft {
  const { title, mode, visibility, publicAcknowledged, lateJoin, showAnswer, questions } = game;
  return { title, mode, visibility, publicAcknowledged, lateJoin, pinRequired: !!game.pinRequired, showAnswer, questions, answerDuration: getAnswerDuration(game) };
}
export function preview(game: Game, subject: string | null, settings: Settings) {
  if (!subject) guestAllowed(game, settings);
  return {
    id: game.id, code: game.code, title: game.title, mode: game.mode,
    questions: game.questions.map(publicQuestion),
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
export function join(game: Game, nickname: unknown, subject: string | null, settings: Settings, now: number, pin?: string) {
  if (!subject) guestAllowed(game, settings);
  const returning = subject && game.participants.find((p) => p.subject === subject);
  if (!returning) {
    advance(game, now);
    if (game.phase === 'finished' || (game.phase !== 'lobby' && !game.lateJoin)) {
      throw new Conflict('This game is not accepting new attendees.');
    }
  }
  checkInvitationPin(game, pin, now);
  if (returning) {
    const token = randomBytes(32).toString('base64url');
    returning.tokenHash = hash(token);
    returning.expiresAt = now + 12 * 60 * 60 * 1000;
    return { id: game.id, token };
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
  questionIndex: number, selection: number | SurveyResponse, now: number,
): { accepted: true } {
  const p = participant(game, token, subject, settings, now);
  const question = game.questions[questionIndex];
  if (!question) throw new Conflict('Invalid question.');
  let option: number | undefined, response: SurveyResponse | undefined;
  if (game.mode === 'quiz') {
    if (typeof selection !== 'number' || !Number.isInteger(selection) || selection < 0 || selection >= question.options.length) {
      throw new Conflict('Invalid response option.');
    }
    option = selection;
  } else response = surveyResponse(question, typeof selection === 'number' ? { options: [selection] } : selection);
  const existing = game.answers.find((a) => a.participantId === p.id && a.questionIndex === questionIndex);
  if (existing) {
    const same = game.mode === 'quiz' ? existing.option === option
      : encodeSurveyResponse(savedSurveyResponse(existing)) === encodeSurveyResponse(response!);
    if (!same) throw new Conflict('An answer cannot be changed.');
    return { accepted: true };
  }
  advance(game, now);
  if (game.phase !== 'question' || questionIndex !== game.questionIndex) throw new Conflict('Question is closed.');
  const correct = game.mode === 'quiz' && option === question.correctIndex;
  const ratio = Math.max(0, 1 - (now - game.questionStartedAt) / (question.duration * 1000));
  const points = correct ? 1000 + Math.round(ratio * 500) : 0;
  p.score += points;
  p.streak = correct ? p.streak + 1 : 0;
  const base = { participantId: p.id, questionIndex, correct, points };
  if (response) game.answers.push({ ...base, option: encodeSurveyResponse(response), format: 'survey-v1' });
  else game.answers.push({ ...base, option: option! });
  advance(game, now);
  return { accepted: true };
}
export function surveyResponse(question: Question, input: unknown): SurveyResponse {
  const parsed = z.object({
    options: z.array(z.number().int().min(0).max(MAX_OPTIONS - 1)).max(MAX_OPTIONS),
    other: z.string().trim().min(1).max(MAX_SURVEY_TEXT_LENGTH)
      .refine(text => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), 'Invalid response characters').optional(),
  }).strict().parse(input);
  if (new Set(parsed.options).size !== parsed.options.length || parsed.options.some(i => i >= question.options.length)) {
    throw new Conflict('Invalid or duplicate response options.');
  }
  if (parsed.other !== undefined && !question.survey?.other) throw new Conflict('Other is not enabled for this question.');
  const count = parsed.options.length + (parsed.other === undefined ? 0 : 1);
  if (!count || (!question.survey?.allowMultiple && count !== 1)) throw new Conflict('Select the allowed number of responses.');
  const normalized = { ...parsed, options: [...parsed.options].sort((a, b) => a - b) };
  if (encodeSurveyResponse(normalized).length > MAX_SURVEY_ANSWER_LENGTH) throw new Conflict('Response is too long.');
  return normalized;
}
function savedSurveyResponse(answer: Answer): SurveyResponse {
  if (answer.format === 'survey-v1') return decodeSurveyResponse(answer.option);
  if (answer.format === undefined && typeof answer.option === 'number') return { options: [answer.option] };
  throw new Error('Unsupported persisted survey response format.');
}
function publicQuestion({ text, options, duration, survey }: Question) {
  return { text, options, duration, ...(survey ? { survey } : {}) };
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
    players: game.participants.map((p) => p.nickname), answerCount: game.mode === 'survey' && !host ? Number(!!mine) : answers.length,
  };
  if (host && game.invitationPin) result.invitationPin = game.invitationPin.value;
  if (q) {
    result.question = publicQuestion(q);
    result.questionStartedAt = game.questionStartedAt;
  }
  if (mine) {
    if (game.mode === 'survey') {
      result.myResponse = savedSurveyResponse(mine);
      if (result.myResponse.options.length === 1 && result.myResponse.other === undefined) result.myOption = result.myResponse.options[0];
    } else if (typeof mine.option === 'number') result.myOption = mine.option;
  }
  const revealed = game.phase !== 'question' && game.phase !== 'lobby';
  const showOwn = revealed || (game.showAnswer === 'after_response' && !!mine);
  if (q && game.mode === 'quiz' && game.showAnswer !== 'never' && showOwn) {
    result.correctIndex = q.correctIndex ?? undefined;
  }
  if (mine && p && showOwn && game.mode === 'quiz') {
    result.myResult = { correct: mine.correct, points: mine.points, score: p.score };
  }
  if (revealed && q) {
    if (game.mode === 'survey' && host) {
      const responses = answers.map(savedSurveyResponse);
      result.distribution = q.options.map((_, i) => responses.filter(r => r.options.includes(i)).length);
      if (q.survey?.other) result.otherCount = responses.filter(r => r.other !== undefined).length;
    } else if (game.mode === 'quiz') result.distribution = q.options.map((_, i) => answers.filter(a => a.option === i).length);
  }
  if (game.phase === 'leaderboard' || game.phase === 'finished') {
    if (game.mode === 'survey' && host) result.surveyResults = game.questions.slice(0, game.questionIndex + 1).map((question, questionIndex) => {
      const responses = game.answers.filter(a => a.questionIndex === questionIndex).map(savedSurveyResponse);
      const writtenCount = responses.filter(r => r.other !== undefined).length;
      const counts: { label: string; count: number; option: number | null }[] = question.options.map((label, index) => ({ label, count: responses.filter(r => r.options.includes(index)).length, option: index }));
      if (question.survey?.other && question.options.length) counts.push({ label: 'Other', count: writtenCount, option: null });
      const maximum = Math.max(0, ...counts.map(c => c.count));
      return { questionIndex, text: question.text, responseCount: responses.length, writtenCount,
        textOnly: !question.options.length, mostSelected: maximum ? counts.filter(c => c.count === maximum).map(({ label, count }) => ({ label, count })) : [],
        selections: counts, allowMultiple: !!question.survey?.allowMultiple,
        writtenResponses: responses.flatMap(r => r.other === undefined ? [] : [r.other]).slice(0, SURVEY_TEXT_PAGE_SIZE) };
    });
    else if (game.mode === 'quiz') result.rankings = [...game.participants].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
      .map((p, i) => ({ nickname: p.nickname, score: p.score, streak: p.streak, rank: i + 1 }));
  }
  return result;
}
export function surveyWrittenPage(game: Game, subject: string | null, questionIndex: number, offset: number) {
  own(game, subject);
  if (game.mode !== 'survey' || !['leaderboard', 'finished'].includes(game.phase) ||
      !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex > game.questionIndex ||
      !game.questions[questionIndex] || !Number.isInteger(offset) || offset < 0 || offset >= 500) {
    throw new Conflict('Written responses are available only for completed survey questions.');
  }
  const values = game.answers.filter(a => a.questionIndex === questionIndex).flatMap(a => {
    const response = savedSurveyResponse(a);
    return response.other === undefined ? [] : [response.other];
  });
  return { questionIndex, offset, total: values.length, values: values.slice(offset, offset + SURVEY_TEXT_PAGE_SIZE) };
}
export function settingsView(settings: Settings, isAdmin: boolean): SettingsView {
  return { ...settings, isAdmin };
}
