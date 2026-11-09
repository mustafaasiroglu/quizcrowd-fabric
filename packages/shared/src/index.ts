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
}
export interface Draft {
  title: string;
  mode: 'quiz' | 'survey';
  visibility: Visibility;
  publicAcknowledged: boolean;
  lateJoin: boolean;
  showAnswer: 'wait_all' | 'after_response' | 'never';
  questions: Question[];
}
export interface PublicQuestion {
  text: string;
  options: string[];
  duration: number;
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
  correctIndex?: number;
  myResult?: { correct: boolean; points: number; score: number };
  distribution?: number[];
  rankings?: { nickname: string; score: number; streak: number; rank: number }[];
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
