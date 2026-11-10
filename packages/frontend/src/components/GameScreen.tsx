import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { GameView, SurveyQuestionResult, SurveyResponse } from '@rayfin-app/shared';
import { Icon } from './Icon';
import { hasLongOptions, SurveyAnswers } from './SurveyAnswers';
import { useQuestionCountdown } from '../lib/useQuestionCountdown';
import { useFullscreen } from '../lib/useFullscreen';

type Ranking = NonNullable<GameView['rankings']>[number];
function SurveyResults({ results }: { results: SurveyQuestionResult[] }) {
  return <div className="survey-results" aria-label="Survey question summaries">
    {results.map(result => <section key={result.questionIndex} className="survey-result">
      <h2>Question {result.questionIndex + 1}</h2><p>{result.text}</p>
      <p className="muted small">{result.responseCount} response{result.responseCount !== 1 ? 's' : ''}</p>
      {!result.responseCount ? <p className="muted">No responses collected.</p> : result.textOnly
        ? <p className="muted">{result.writtenCount} written response{result.writtenCount !== 1 ? 's' : ''} collected. Written response text is private.</p>
        : <><h3>{result.mostSelected.length > 1 ? 'Most selected answers (tie)' : 'Most selected answer'}</h3>
          <ul className="distribution">{result.mostSelected.map((answer, index) => <li key={index}><span>{answer.label}</span><strong>{answer.count} response{answer.count !== 1 ? 's' : ''}</strong></li>)}</ul>
          {result.writtenCount > 0 && <p className="muted small">Written responses are grouped; their text is not shown.</p>}
        </>}
    </section>)}
  </div>;
}
export function Podium({ rankings }: { rankings: Ranking[] }) {
  return <div className="podium" aria-label="Top three players">
    {[2, 1, 3].map((rank) => {
      const entry = rankings.find((r) => r.rank === rank);
      return entry && <div className={`podium-entry place-${rank}`} key={rank}>
        <div className="podium-label"><span className="medal" aria-label={`Place ${rank}`}>{['🥇', '🥈', '🥉'][rank - 1]}</span><strong title={entry.nickname}>{entry.nickname}</strong><span className="muted small">{entry.score} pts</span></div>
        <div className="podium-block"><span>{rank}</span></div>
      </div>;
    })}
  </div>;
}
export function GameScreen({ game, host, nickname, joinUrl, busy, onControl, onAnswer, onSurveyAnswer, onHome, onCopyError }: {
  game: GameView; host: boolean; guest: boolean; nickname: string; joinUrl: string; busy: boolean;
  onControl(): void; onAnswer(option: number): void; onSurveyAnswer(response: SurveyResponse): void; onHome(): void; onCopyError(error: unknown): void;
}) {
  const { seconds, fill } = useQuestionCountdown(game);
  const fullscreen = useFullscreen();
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(''), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); }
    catch (error) { onCopyError(error); }
  }
  const question = game.question;
  const questionLabel = `Question ${game.questionIndex + 1} / ${game.totalQuestions}`;
  const correct = game.correctIndex === undefined ? undefined : question?.options[game.correctIndex];
  const answered = game.myOption !== undefined || game.myResponse !== undefined;
  const last = game.questionIndex + 1 >= game.totalQuestions;
  const rankings = game.rankings ?? [];
  function leaderboard(entries: Ranking[]) {
    return <ol className="rankings">{entries.map((entry) => <li key={entry.rank} className={entry.nickname === nickname && !host ? 'is-me' : ''}>
      <div className="ranking-name"><span className="rank-number">#{entry.rank}</span><strong>{entry.nickname}</strong>{entry.streak >= 3 && <span className="streak" aria-label={`${entry.streak} answer streak`}>🔥 {entry.streak}</span>}</div><span className="ranking-score">{entry.score} pts</span>
    </li>)}</ol>;
  }
  return <div className={`game-stage stage-${game.phase} ${host ? 'host-stage' : 'attendee-stage'}`} data-phase={game.phase}>
    {game.phase === 'lobby' ? <section className={`card lobby ${host ? 'host-lobby' : 'attendee-lobby'}`}>
      {host ? <>
        <h1>{game.title}</h1><p className="muted">Scan QR code or visit link to join...</p>
        <div className="lobby-invitation">
        <div className="qr-container"><QRCodeSVG value={joinUrl} size={160} title={`Scan to join this ${game.mode}`} /></div>
        <div className="code-panel"><div className="session-code"><strong>{game.code}</strong><button className="icon-button" aria-label="Copy session code" onClick={() => void copy(game.code)}><Icon name={copied === game.code ? 'check' : 'copy'} /></button></div>
          <div className="join-link"><a href={joinUrl}>{joinUrl}</a><button className="icon-button" aria-label="Copy invite link" onClick={() => void copy(joinUrl)}><Icon name={copied === joinUrl ? 'check' : 'copy'} /></button></div>
        </div>
        </div>
        {copied && <span role="status" className="sr-only">Copied to clipboard.</span>}
        <p className="muted small">{game.players.length} attendee{game.players.length !== 1 ? 's' : ''} joined</p>
        <div className="players">{game.players.map((player, index) => <span key={index}>{player}</span>)}</div>
        <button className="primary full-width large-button" disabled={busy || !game.players.length} onClick={onControl}>{busy ? 'Starting...' : game.mode === 'quiz' ? 'Start Quiz' : 'Start Survey'}</button>
        {!fullscreen && <p className="muted small fullscreen-tip">Tip: Press F11 to make full screen</p>}
      </> : <>
        <h1>You're in! <span aria-hidden="true">🎉</span></h1>
        {nickname && <p className="nickname">{nickname}</p>}
        <p className="muted">Waiting for host to start...</p><div className="loading-spinner" role="status" aria-label="Waiting for host" />
        <div className="players">{game.players.map((player, index) => <span key={index} className={player === nickname ? 'is-me' : ''}>{player}</span>)}</div>
      </>}
      {!host && <p className="game-context muted small">{game.title}</p>}
    </section> : game.phase === 'question' && question ? <>
      <section className={host ? 'card question-screen' : 'attendee-question'}>
        <div className="timer" role="timer" aria-label={`${seconds} seconds remaining`}>
          <span className={seconds <= 5 ? 'urgent' : 'muted'}>{seconds}s</span>
          <div className="timer-track" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={question.duration} aria-valuenow={seconds}><div ref={fill} className="timer-fill" /></div>
        </div>
        <div className="question-text"><p className="muted small">{questionLabel}</p><h1>{question.text}</h1></div>
        {!host && !answered && game.mode === 'survey' ? <SurveyAnswers key={`${game.id}-${game.questionIndex}`} question={question} disabled={busy || seconds === 0} onSubmit={onSurveyAnswer} />
          : host || !answered ? <div className={`answers ${question.options.length <= 2 && !host ? 'two-options' : ''} ${hasLongOptions(question.options) ? 'long-options' : ''}`}>{question.options.map((option, i) => host
          ? <div className={`answer answer-${i}`} key={i}>{option}</div>
          : <button className={`answer answer-${i}`} key={i} disabled={busy || seconds === 0} onClick={() => onAnswer(i)}>{option}</button>)}
          {host && question.survey?.other && <div className="answer other-choice">{question.options.length ? 'Other (written response)' : 'Written response'}</div>}</div>
          : <div className="card submitted" role="status">
            <div className={`result-symbol ${game.myResult ? game.myResult.correct ? 'success' : 'danger-text' : ''}`} aria-hidden="true">{game.myResult && !game.myResult.correct ? '✗' : '✓'}</div>
            {correct !== undefined && <div className="correct-answer"><p className="small muted">Correct Answer</p><strong>{correct}</strong></div>}
            <h2>{game.myResult ? game.myResult.correct ? `+${game.myResult.points} pts` : 'Not quite!' : 'Answer submitted!'}</h2>
            <p className="muted small">Waiting for results...</p>
          </div>}
        {host && <p className="muted small answer-count">{game.answerCount} / {game.players.length} answered</p>}
      </section>
    </> : game.phase === 'reveal' ? <section className={`card reveal-screen ${host ? 'wide-result' : ''}`}>
      <p className="muted small">{question?.text}</p>
      {!host && game.mode === 'quiz' && <div className={`result-symbol ${game.myResult?.correct ? 'success' : 'danger-text'}`} aria-hidden="true">{game.myResult ? game.myResult.correct ? '✓' : '✗' : '—'}</div>}
      <h1>{correct !== undefined ? 'Correct Answer' : game.mode === 'survey' ? 'Responses are in!' : 'Results are in!'}</h1>
      {correct !== undefined && <div className="correct-answer"><strong>{correct}</strong></div>}
      {!host && game.myResult && <div><p className={`result-points ${game.myResult.correct ? 'success' : 'danger-text'}`}>{game.myResult.correct ? `+${game.myResult.points} pts` : 'Not quite!'}</p><p className="muted small">Total: {game.myResult.score} pts</p></div>}
      {game.distribution && question && <ul className="distribution" aria-label="Response distribution">{question.options.map((option, i) => <li key={i}><span>{option}</span><strong>{game.distribution![i]} responses</strong></li>)}{game.otherCount !== undefined && <li><span>{question.options.length ? 'Other' : 'Written responses'}</span><strong>{game.otherCount} responses</strong></li>}</ul>}
      <p className="muted small">{game.mode === 'survey' ? 'Results coming up...' : 'Leaderboard coming up...'}</p>
    </section> : game.phase === 'leaderboard' ? <section className={`card leaderboard ${host ? 'wide-result' : ''}`}>
      <h1>{game.mode === 'survey' ? 'Survey Results' : last && host ? '🏁 Final Standings' : '📊 Leaderboard'}</h1>
      {game.mode === 'survey' ? <SurveyResults results={game.surveyResults ?? []} /> : leaderboard(rankings)}
      {host ? <button className="primary full-width large-button" disabled={busy} onClick={onControl}>{last ? 'See Final Results →' : 'Next Question →'}</button> : <p className="muted small">Waiting for next question...</p>}
    </section> : game.phase === 'finished' ? <section className="card finished-screen">
      <h1>{game.mode === 'survey' ? 'Survey Complete!' : '🏆 Game Over!'}</h1>
      {game.mode === 'quiz' ? <><Podium rankings={rankings} />{leaderboard(rankings.slice(3))}</> : <><p className="muted">Thank you for sharing your responses.</p><SurveyResults results={game.surveyResults ?? []} /></>}
      <button className="primary full-width" onClick={onHome}>{host || game.mode === 'survey' ? 'Back to Home' : 'Play Again'}</button>
    </section> : <p role="status">Waiting for session state...</p>}
  </div>;
}
