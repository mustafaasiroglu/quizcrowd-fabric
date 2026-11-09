import { useRef, useState } from 'react';
import type { Draft, Question } from '@rayfin-app/shared';
import { PUBLIC_WARNING } from '@rayfin-app/shared';
import { Icon } from './Icon';
import { Modal } from './Modal';

export const blankQuestion = (): Question => ({ text: '', options: ['', '', '', ''], correctIndex: null, duration: 20 });
export const blankDraft = (): Draft => ({
  title: '', mode: 'quiz', visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all', questions: [blankQuestion()],
});
export function removeOption(question: Question, index: number): Question {
  const correct = question.correctIndex;
  return {
    ...question, options: question.options.filter((_, i) => i !== index),
    correctIndex: correct === null || correct === index ? null : correct > index ? correct - 1 : correct,
  };
}
export function AuthorEditor({ draft, onChange, editing, anonymousEnabled, busy, onSave, onBack, onLibrary }: {
  draft: Draft; onChange(draft: Draft): void; editing: boolean; anonymousEnabled: boolean;
  busy: boolean; onSave(): void; onBack(): void; onLibrary(): void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removing, setRemoving] = useState<number>();
  const questionsRef = useRef<HTMLDivElement>(null);
  function updateQuestion(index: number, patch: Partial<Question>) {
    onChange({ ...draft, questions: draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  }
  function move(index: number, direction: -1 | 1) {
    const questions = [...draft.questions];
    const next = index + direction;
    if (next < 0 || next >= questions.length) return;
    [questions[index], questions[next]] = [questions[next]!, questions[index]!];
    onChange({ ...draft, questions });
  }
  return <div className="author page-container">
    <div className="section-heading page-heading"><button className="icon-button" aria-label="Go back" onClick={onBack}><Icon name="back" /></button><h1>{editing ? 'Edit Quiz' : 'Create Quiz'}</h1><button className="subtle library-shortcut" onClick={onLibrary}><Icon name="copy" />Your Quizzes</button></div>
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <section className="card title-card">
        <div className="section-heading"><label htmlFor="quiz-title">Quiz Title</label><button type="button" className="icon-button" aria-label="Game settings" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button></div>
        <input id="quiz-title" placeholder="My Amazing Quiz" required maxLength={120} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
        <div className="form-grid fabric-fields">
          <label>Session type<select value={draft.mode} onChange={(e) => {
            const mode = e.target.value as Draft['mode'];
            onChange({ ...draft, mode, questions: draft.questions.map((q) => ({ ...q, correctIndex: mode === 'survey' ? null : q.correctIndex })) });
          }}><option value="quiz">Scored quiz</option><option value="survey">Survey (no correct answers)</option></select></label>
          <label>Audience<select value={draft.visibility} onChange={(e) => onChange({ ...draft, visibility: e.target.value as Draft['visibility'], publicAcknowledged: false })}><option value="internal">Internal Only</option><option value="public" disabled={!anonymousEnabled}>Anyone (Public)</option></select></label>
        </div>
        {!anonymousEnabled && <p className="muted small">Public attendance is disabled by the publisher.</p>}
        {draft.visibility === 'public' && <div className="warning"><p>{PUBLIC_WARNING}</p><label className="check"><input type="checkbox" checked={draft.publicAcknowledged} onChange={(e) => onChange({ ...draft, publicAcknowledged: e.target.checked })} required />I understand and choose public access.</label></div>}
      </section>
      <div ref={questionsRef}>
        {draft.questions.map((q, i) => <fieldset className="card question-editor" key={i}>
          <legend className="sr-only">Question {i + 1}</legend>
          <div className="section-heading question-heading">
            <h2>Question {i + 1}</h2>
            {draft.questions.length > 1 && <div className="reorder">
              <button type="button" className="icon-button" disabled={i === 0} aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)}><Icon name="up" /></button>
              <button type="button" className="icon-button" disabled={i === draft.questions.length - 1} aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)}><Icon name="down" /></button>
            </div>}
            <label className="duration"><Icon name="clock" /><span className="sr-only">Question {i + 1} duration in seconds</span><input type="number" min={5} max={120} required value={q.duration} onChange={(e) => updateQuestion(i, { duration: Number(e.target.value) })} /><span>s</span></label>
            {draft.questions.length > 1 && <button type="button" className="icon-button danger" aria-label={`Remove question ${i + 1}`} onClick={() => setRemoving(i)}><Icon name="trash" /></button>}
          </div>
          <label className="sr-only" htmlFor={`question-${i}`}>Question {i + 1} text</label>
          <textarea id={`question-${i}`} placeholder="Start typing your question..." required maxLength={1000} rows={2} value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })} />
          <div className="option-editor-grid">
            {q.options.map((option, k) => <div className={`option-editor ${draft.mode === 'quiz' && q.correctIndex === k ? 'is-correct' : ''}`} key={k}>
              {draft.mode === 'quiz' && <input type="radio" name={`correct-${i}`} required aria-label={`Question ${i + 1}, correct option ${k + 1}`} checked={q.correctIndex === k} onChange={() => updateQuestion(i, { correctIndex: k })} />}
              <label className="sr-only" htmlFor={`option-${i}-${k}`}>Question {i + 1}, option {k + 1}</label>
              <input id={`option-${i}-${k}`} placeholder={`Option ${k + 1}`} required maxLength={300} value={option} onChange={(e) => updateQuestion(i, { options: q.options.map((o, n) => n === k ? e.target.value : o) })} />
              {q.options.length > 2 && <button type="button" className="icon-button danger remove-option" aria-label={`Remove question ${i + 1} option ${k + 1}`} onClick={() => updateQuestion(i, removeOption(q, k))}><Icon name="trash" /></button>}
            </div>)}
          </div>
          {draft.mode === 'quiz' && <p className="muted small option-hint">Select the circle beside the correct answer.</p>}
          {q.options.length < 4 && <button type="button" className="text-button" onClick={() => updateQuestion(i, { options: [...q.options, ''] })}>+ Add option</button>}
        </fieldset>)}
      </div>
      <div className="editor-actions">
        <button type="button" className="outline-success" disabled={draft.questions.length >= 40} onClick={() => {
          onChange({ ...draft, questions: [...draft.questions, blankQuestion()] });
          requestAnimationFrame(() => questionsRef.current?.querySelector<HTMLTextAreaElement>('fieldset:last-child textarea')?.focus());
        }}>+ Add Question</button>
        <button type="submit" className="outline-primary" disabled={busy || (draft.visibility === 'public' && (!anonymousEnabled || !draft.publicAcknowledged))}>{busy ? 'Saving...' : editing ? 'Save & Open Lobby' : 'Create & Open Lobby'}</button>
      </div>
    </form>
    {settingsOpen && <Modal title="Game Settings" onClose={() => setSettingsOpen(false)}>
      <label>Allow Late Joins?<select value={draft.lateJoin ? 'allow' : 'deny'} onChange={(e) => onChange({ ...draft, lateJoin: e.target.value === 'allow' })}><option value="deny">Don't Allow Late Join</option><option value="allow">Allow Join After Game Start</option></select></label>
      <label>Show Correct Answers?<select value={draft.showAnswer} onChange={(e) => onChange({ ...draft, showAnswer: e.target.value as Draft['showAnswer'] })}><option value="wait_all">Wait for All Users</option><option value="after_response">Show After User Response</option><option value="never">Never Show</option></select></label>
      <button type="button" className="primary full-width" onClick={() => setSettingsOpen(false)}>Done</button>
    </Modal>}
    {removing !== undefined && <Modal title={`Delete Question ${removing + 1}?`} onClose={() => setRemoving(undefined)}>
      <p className="muted">This action cannot be undone.</p>
      <div className="actions equal-actions"><button onClick={() => setRemoving(undefined)}>Cancel</button><button className="danger" onClick={() => {
        onChange({ ...draft, questions: draft.questions.filter((_, i) => i !== removing) }); setRemoving(undefined);
      }}>Delete</button></div>
    </Modal>}
  </div>;
}
