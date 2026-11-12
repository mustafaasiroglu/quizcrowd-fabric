import { useState } from 'react';
import type { QuizSummary } from '@rayfin-app/shared';
import { Icon } from './Icon';
const status: Record<QuizSummary['phase'], string> = { lobby: 'Not started', question: 'In progress', reveal: 'Showing results', leaderboard: 'Leaderboard', finished: 'Finished' };

export function SessionLibrary({ quizzes, loadState, busy, onOpen, onDuplicate, onDelete }: {
  quizzes: QuizSummary[]; loadState: 'loading' | 'ready' | 'error'; busy: boolean;
  onOpen(quiz: QuizSummary): void; onDuplicate(id: string): void; onDelete(id: string): void;
}) {
  const [layout, setLayout] = useState<'list' | 'cards'>(() => {
    try { return localStorage.getItem('quizcrowd-recent-layout') === 'cards' ? 'cards' : 'list'; }
    catch { return 'list'; }
  });
  const [storageError, setStorageError] = useState(false);
  function chooseLayout(next: 'list' | 'cards') {
    setLayout(next);
    try { localStorage.setItem('quizcrowd-recent-layout', next); setStorageError(false); }
    catch { setStorageError(true); }
  }
  const collectionClass = layout === 'list' ? 'session-grid session-list' : 'session-grid';
  return <section className="recent-sessions" aria-labelledby="recent-heading" aria-busy={loadState === 'loading'}>
    <div className="recent-heading"><div><h2 id="recent-heading">Recent Items</h2><p className="small muted">Your recent quiz and surveys.</p></div>
      <div className="recent-layout" role="group" aria-label="Recent items view">
        <button type="button" aria-pressed={layout === 'list'} onClick={() => chooseLayout('list')}>List</button>
        <button type="button" aria-pressed={layout === 'cards'} onClick={() => chooseLayout('cards')}>Cards</button>
      </div>
    </div>
    {storageError && <p className="small muted" role="status">Browser storage is unavailable. Your recent items view will reset on reload.</p>}
    {loadState === 'loading' ? <div role="status" className="library-loading"><span className="sr-only">Loading recent items...</span>
      <div className={collectionClass} aria-hidden="true">{[0, 1, 2].map(index => <div key={index} className="card session-placeholder"><span /><span /><span /></div>)}</div>
    </div> : loadState === 'error' ? <p className="muted">Recent items could not be loaded.</p> : <>
    {!quizzes.length && <div className="card empty-library"><p className="muted">No recent items</p></div>}
    <div className={collectionClass}>{quizzes.map((quiz) => <article className="card session-card" key={quiz.id}>
      <button className="session-open" disabled={busy} aria-label={`${quiz.readOnly ? 'View' : 'Open'} ${quiz.title}`} aria-describedby={`status-${quiz.id} date-${quiz.id} metrics-${quiz.id}`} onClick={() => onOpen(quiz)}>
        <span className="session-card-heading"><span className="session-type"><Icon name={quiz.mode === 'quiz' ? 'quiz' : 'survey'} />{quiz.mode === 'quiz' ? 'Live Quiz' : 'Live Survey'}</span><span id={`status-${quiz.id}`} className={`badge phase-${quiz.phase}`}>{status[quiz.phase]}</span></span>
        <span className="session-title">{quiz.title}</span>
        <span id={`date-${quiz.id}`} className="session-date muted small"><Icon name="calendar" /><span className="sr-only">Created on </span><time dateTime={new Date(quiz.createdAt).toISOString()}>{new Date(quiz.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time></span>
        <span id={`metrics-${quiz.id}`} className="session-metrics"><span><Icon name="questions" /><span>{quiz.questionCount} Questions</span></span><span><Icon name="responses" /><span>{quiz.responseCount} Responses</span></span></span>
      </button>
      <div className="session-card-actions">
          <details className="session-menu" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
          }}><summary aria-label={`Actions for ${quiz.title}`}><Icon name="more" /></summary>
            <div className="session-menu-items">
              <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onOpen(quiz); }}><Icon name="open" />Open</button>
              <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDuplicate(quiz.id); }}><Icon name="copy" />Duplicate</button>
              <button className="delete-action" disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(quiz.id); }}><Icon name="trash" />Delete</button>
            </div>
          </details>
      </div>
    </article>)}</div></>}
  </section>;
}
