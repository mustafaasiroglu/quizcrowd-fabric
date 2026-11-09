import type { QuizSummary } from '@rayfin-app/shared';
import { Icon } from './Icon';

export function SessionLibrary({ quizzes, busy, onOpen, onDuplicate, onDelete }: {
  quizzes: QuizSummary[]; busy: boolean;
  onOpen(quiz: QuizSummary): void; onDuplicate(id: string): void; onDelete(id: string): void;
}) {
  return <section className="recent-sessions" aria-labelledby="recent-heading">
    <div className="section-heading"><h2 id="recent-heading">Recent Quiz &amp; Surveys</h2></div>
    {!quizzes.length && <div className="card empty-library"><p className="muted">No sessions yet. Create a live quiz or survey to get started.</p></div>}
    <div className="session-grid">{quizzes.map((quiz) => <article className="card session-card" key={quiz.id}>
      <div className={`session-cover cover-${quiz.mode}`} aria-hidden="true"><Icon name={quiz.mode === 'quiz' ? 'quiz' : 'survey'} /></div>
      <div className="session-card-body">
        <div className="section-heading"><span className="session-type">{quiz.mode === 'quiz' ? 'Live Quiz' : 'Live Survey'}</span><span className={`badge phase-${quiz.phase}`}>{quiz.phase === 'lobby' ? 'Not started' : quiz.phase}</span></div>
        <h3><button className="session-title" disabled={busy} onClick={() => onOpen(quiz)}>{quiz.title}</button></h3>
        <p className="muted small">Created on <time dateTime={new Date(quiz.createdAt).toISOString()}>{new Date(quiz.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time></p>
        <div className="session-metrics"><span><Icon name="users" /><span>{quiz.participantCount} participants</span></span><strong>{quiz.responseCount} responses</strong></div>
        <div className="section-heading session-card-actions">
          <button className="text-button" disabled={busy} onClick={() => onOpen(quiz)}>{quiz.readOnly ? 'View' : 'Open'}</button>
          <details className="session-menu" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
          }}><summary aria-label={`Actions for ${quiz.title}`}><Icon name="more" /></summary>
            <div className="session-menu-items">
              <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onOpen(quiz); }}>Open</button>
              <button disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDuplicate(quiz.id); }}>Duplicate</button>
              <button className="delete-action" disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(quiz.id); }}>Delete</button>
            </div>
          </details>
        </div>
      </div>
    </article>)}</div>
  </section>;
}
