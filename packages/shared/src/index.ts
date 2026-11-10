export type UniversalAppSchema = {
  CallerIdentity: { id: string; subject: string };
};

export type Visibility = 'internal' | 'public';
export type Phase = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'finished';
export interface Question {
  text: string;
  options: string[];
  correctIndex: number | null;
  duration: number;
  survey?: SurveySettings;
}
export interface SurveySettings { other: boolean; allowMultiple: boolean }
export type SurveyQuestionType = 'single' | 'multiple' | 'text';
export function getSurveyQuestionType(question: Question): SurveyQuestionType {
  if (!question.options.length && question.survey?.other) return 'text';
  return question.survey?.allowMultiple ? 'multiple' : 'single';
}
export function setSurveyQuestionType(question: Question, type: SurveyQuestionType, previousOptions = question.options): Question {
  const options = [...previousOptions];
  while (options.length < 2) options.push('');
  return { ...question, options: type === 'text' ? [] : options, correctIndex: null,
    survey: { other: type === 'text' || !!question.survey?.other, allowMultiple: type === 'multiple' } };
}
export interface SurveyResponse { options: number[]; other?: string }
export type AnswerSubmission = { option: number; response?: never } | { response: SurveyResponse; option?: never };
export const MAX_OPTIONS = 10;
export const MAX_SURVEY_TEXT_LENGTH = 500;
export const MAX_SURVEY_ANSWER_LENGTH = 2048;
export function encodeSurveyResponse(response: SurveyResponse): string {
  const parts = response.options.map(index => `o:${index}`);
  if (response.other !== undefined) parts.push(`t:${response.other.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')}`);
  return parts.join('|');
}
export function decodeSurveyResponse(value: string): SurveyResponse {
  if (!value || value.length > MAX_SURVEY_ANSWER_LENGTH) throw new Error('Invalid persisted survey response.');
  const parts: string[] = [];
  let part = '', escaped = false;
  for (const character of value) {
    if (escaped) {
      if (character !== '\\' && character !== '|') throw new Error('Invalid persisted survey escape.');
      part += character; escaped = false;
    } else if (character === '\\') escaped = true;
    else if (character === '|') { parts.push(part); part = ''; }
    else part += character;
  }
  if (escaped) throw new Error('Incomplete persisted survey escape.');
  parts.push(part);
  const result: SurveyResponse = { options: [] };
  for (const token of parts) {
    if (/^o:[0-9]$/.test(token) && Number(token.slice(2)) < MAX_OPTIONS && result.other === undefined) result.options.push(Number(token.slice(2)));
    else if (token.startsWith('t:') && token.length > 2 && result.other === undefined) result.other = token.slice(2);
    else throw new Error('Invalid persisted survey token.');
  }
  if (new Set(result.options).size !== result.options.length || (result.other?.length ?? 0) > MAX_SURVEY_TEXT_LENGTH) {
    throw new Error('Invalid persisted survey selections.');
  }
  return result;
}
export interface AnswerDuration {
  mode: 'same' | 'custom';
  seconds: number;
}
export const MAX_TITLE_LENGTH = 120;
export function copyTitle(title: string): string {
  const prefix = 'Copy - ';
  let result = prefix;
  for (const character of title.startsWith(prefix) ? title.slice(prefix.length) : title) {
    if (result.length + character.length > MAX_TITLE_LENGTH) break;
    result += character;
  }
  return result.trimEnd();
}
export interface Draft {
  title: string;
  mode: 'quiz' | 'survey';
  visibility: Visibility;
  publicAcknowledged: boolean;
  lateJoin: boolean;
  showAnswer: 'wait_all' | 'after_response' | 'never';
  questions: Question[];
  answerDuration?: AnswerDuration;
}
export function getAnswerDuration(draft: Pick<Draft, 'questions' | 'answerDuration'>): AnswerDuration {
  if (draft.answerDuration) return draft.answerDuration;
  const seconds = draft.questions[0]?.duration ?? 20;
  return { mode: draft.questions.every(q => q.duration === seconds) ? 'same' : 'custom', seconds };
}
export function setAnswerDuration(draft: Draft, answerDuration: AnswerDuration): Draft {
  return { ...draft, answerDuration, questions: draft.questions.map(q =>
    ({ ...q, duration: answerDuration.mode === 'same' ? answerDuration.seconds : q.duration })) };
}
export interface PublicQuestion {
  text: string;
  options: string[];
  duration: number;
  survey?: SurveySettings;
}
export interface GameView {
  id: string;
  code: string;
  title: string;
  mode: 'quiz' | 'survey';
  phase: Phase;
  version: number;
  questionIndex: number;
  totalQuestions: number;
  question?: PublicQuestion;
  questionStartedAt?: number;
  serverNow: number;
  players: string[];
  answerCount: number;
  myOption?: number;
  myResponse?: SurveyResponse;
  correctIndex?: number;
  myResult?: { correct: boolean; points: number; score: number };
  distribution?: number[];
  otherCount?: number;
  rankings?: { nickname: string; score: number; streak: number; rank: number }[];
  surveyResults?: SurveyQuestionResult[];
}
export interface SurveyQuestionResult {
  questionIndex: number;
  text: string;
  responseCount: number;
  mostSelected: { label: string; count: number }[];
  writtenCount: number;
  textOnly: boolean;
}
export interface QuizSummary {
  id: string;
  code: string;
  title: string;
  phase: Phase;
  visibility: Visibility;
  mode: Draft['mode'];
  createdAt: number;
  participantCount: number;
  questionCount: number;
  responseCount: number;
  readOnly: boolean;
}
export interface AuthorView extends QuizSummary { draft: Draft }
export interface SettingsView {
  anonymousEnabled: boolean;
  guestEpoch: number;
  isAdmin: boolean;
}
export const PUBLIC_WARNING =
  'Anyone (Public) makes all questions and response options accessible to anyone with the quiz URL, including before the game starts. Answer keys, individual responses and personal data are not included.';
