import { useRef, useState } from 'react';
import type { Draft, Question } from '@rayfin-app/shared';
import { getAnswerDuration, PUBLIC_WARNING, setAnswerDuration } from '@rayfin-app/shared';
import { Icon } from './Icon';
import { Modal } from './Modal';

export const blankQuestion = (duration = 20): Question => ({ text: '', options: ['', '', '', ''], correctIndex: null, duration });
export const blankDraft = (mode: Draft['mode'] = 'quiz'): Draft => ({
  title: '', mode, visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all', questions: [blankQuestion()], answerDuration: { mode: 'same', seconds: 20 },
});
export function removeOption(question: Question, index: number): Question {
  const correct = question.correctIndex;
  return { ...question, options: question.options.filter((_, i) => i !== index),
    correctIndex: correct === null || correct === index ? null : correct > index ? correct - 1 : correct };
}
export function AuthorEditor({ draft, onChange, editing, anonymousEnabled, busy, readOnly = false, onSave, onBack, onHost, onRevokePublic }: {
  draft: Draft; onChange(draft: Draft): void; editing: boolean; anonymousEnabled: boolean;
  busy: boolean; readOnly?: boolean; onSave(): void; onBack(): void; onHost?(): void; onRevokePublic?(): void;
}) {
  const [removing, setRemoving] = useState<number>();
  const questionsRef = useRef<HTMLDivElement>(null);
  const timing = getAnswerDuration(draft);
  function setDuration(mode: 'same' | 'custom', seconds = timing.seconds) {
    onChange(setAnswerDuration(draft, { mode, seconds }));
  }
  function updateQuestion(index: number, patch: Partial<Question>) {
    onChange({ ...draft, answerDuration: timing, questions: draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  }
  function move(index: number, direction: -1 | 1) {
    const questions = [...draft.questions], next = index + direction;
    if (next < 0 || next >= questions.length) return;
    [questions[index], questions[next]] = [questions[next]!, questions[index]!];
    onChange({ ...draft, answerDuration: timing, questions });
  }
  return <div className="author page-container">
    <div className="section-heading page-heading"><button className="icon-button" aria-label="Go back" onClick={onBack}><Icon name="back" /></button><h1>{readOnly ? 'View' : editing ? 'Edit' : 'New'} Live {draft.mode === 'quiz' ? 'Quiz' : 'Survey'}</h1>{onHost && <button className="primary" disabled={busy} onClick={onHost}><Icon name="play" />Open Lobby</button>}</div>
    {readOnly && <p className="readonly-notice" role="status">Read-only: this session has started or has responses. Duplicate it to make an editable copy. Host controls remain available in the lobby.</p>}
    <form className="author-layout" onSubmit={(event) => { event.preventDefault(); if (!readOnly) onSave(); }}>
      <fieldset className="author-content" disabled={readOnly || busy}>
        <legend className="sr-only">Session content</legend>
        <section className="card title-card"><label htmlFor="quiz-title">Title</label><input id="quiz-title" placeholder={draft.mode === 'quiz' ? 'Untitled live quiz' : 'Untitled live survey'} required maxLength={120} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} /></section>
        <div ref={questionsRef}>{draft.questions.map((q, i) => <fieldset className="card question-editor" key={i}>
          <legend className="sr-only">Question {i + 1}</legend>
          <div className="section-heading question-heading"><h2>Question {i + 1}</h2>
            {!readOnly && draft.questions.length > 1 && <div className="reorder">
              <button type="button" className="icon-button" disabled={i === 0} aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)}><Icon name="up" /></button>
              <button type="button" className="icon-button" disabled={i === draft.questions.length - 1} aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)}><Icon name="down" /></button>
            </div>}
            {timing.mode === 'custom' && <label className="duration"><Icon name="clock" /><span className="sr-only">Question {i + 1} duration in seconds</span><input type="number" min={5} max={120} required value={q.duration} onChange={(e) => updateQuestion(i, { duration: Number(e.target.value) })} /><span>s</span></label>}
            {!readOnly && draft.questions.length > 1 && <button type="button" className="icon-button delete-action" aria-label={`Remove question ${i + 1}`} onClick={() => setRemoving(i)}><Icon name="trash" /></button>}
          </div>
          <label className="sr-only" htmlFor={`question-${i}`}>Question {i + 1} text</label><textarea id={`question-${i}`} placeholder="Enter your question" required maxLength={1000} rows={2} value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })} />
          <div className="option-editor-grid">{q.options.map((option, k) => <div className={`option-editor ${draft.mode === 'quiz' && q.correctIndex === k ? 'is-correct' : ''}`} key={k}>
            {draft.mode === 'quiz' && <input type="radio" name={`correct-${i}`} required aria-label={`Question ${i + 1}, correct option ${k + 1}`} checked={q.correctIndex === k} onChange={() => updateQuestion(i, { correctIndex: k })} />}
            <label className="sr-only" htmlFor={`option-${i}-${k}`}>Question {i + 1}, option {k + 1}</label><input id={`option-${i}-${k}`} placeholder={`Option ${k + 1}`} required maxLength={300} value={option} onChange={(e) => updateQuestion(i, { options: q.options.map((o, n) => n === k ? e.target.value : o) })} />
            {!readOnly && q.options.length > 2 && <button type="button" className="icon-button delete-action remove-option" aria-label={`Remove question ${i + 1} option ${k + 1}`} onClick={() => updateQuestion(i, removeOption(q, k))}><Icon name="trash" /></button>}
          </div>)}</div>
          {draft.mode === 'quiz' && <p className="muted small option-hint">Select the circle beside the correct answer.</p>}
          {!readOnly && q.options.length < 4 && <button type="button" className="text-button" onClick={() => updateQuestion(i, { options: [...q.options, ''] })}><Icon name="plus" />Add option</button>}
        </fieldset>)}</div>
        {!readOnly && <div className="editor-actions"><button type="button" className="outline-primary" disabled={draft.questions.length >= 40} onClick={() => {
          onChange({ ...draft, answerDuration: timing, questions: [...draft.questions, blankQuestion(timing.seconds)] });
          requestAnimationFrame(() => questionsRef.current?.querySelector<HTMLTextAreaElement>('fieldset:last-child textarea')?.focus());
        }}><Icon name="plus" />Add Question</button><button type="submit" className="primary" disabled={draft.visibility === 'public' && (!anonymousEnabled || !draft.publicAcknowledged)}><Icon name="save" />{busy ? 'Saving...' : 'Save & Open Lobby'}</button></div>}
      </fieldset>
      <aside className="card settings-panel" aria-labelledby="settings-heading"><h2 id="settings-heading"><Icon name="settings" />Settings</h2>
        {onRevokePublic && <button type="button" className="subtle full-width" disabled={busy} onClick={onRevokePublic}>Revoke public access (make internal)</button>}
        <fieldset disabled={readOnly || busy}><legend className="sr-only">Session settings</legend>
          <fieldset className="audience-settings"><legend>Who can respond?</legend>
            <label className="check"><input type="radio" name="audience" value="internal" checked={draft.visibility === 'internal'} onChange={() => onChange({ ...draft, visibility: 'internal', publicAcknowledged: false })} /><span>Only people in my organization<span className="small muted audience-description">Requires sign-in with organization account</span></span></label>
            <label className="check"><input type="radio" name="audience" value="public" checked={draft.visibility === 'public'} disabled={!anonymousEnabled} onChange={() => onChange({ ...draft, visibility: 'public', publicAcknowledged: false })} /><span>Anyone with link<span className="small muted audience-description">Anonymous response, doesn't require sign-in</span></span></label>
          </fieldset>
          {!anonymousEnabled && <p className="muted small">Public attendance is disabled by the publisher.</p>}
          {draft.visibility === 'public' && <div className="warning"><p>{PUBLIC_WARNING}</p><label className="check"><input type="checkbox" checked={draft.publicAcknowledged} onChange={(e) => onChange({ ...draft, publicAcknowledged: e.target.checked })} required />I understand and choose public access.</label></div>}
          <fieldset className="duration-settings"><legend><Icon name="clock" />Answer duration</legend>
            <label className="check"><input type="radio" name="answer-duration" value="same" checked={timing.mode === 'same'} onChange={() => setDuration('same')} />Same for all</label>
            <label className="check"><input type="radio" name="answer-duration" value="custom" checked={timing.mode === 'custom'} onChange={() => setDuration('custom')} />Customize per question</label>
            {timing.mode === 'same' ? <label className="global-duration" htmlFor="shared-duration">Duration in seconds<input id="shared-duration" type="number" min={5} max={120} required value={timing.seconds} onChange={(e) => setDuration('same', Number(e.target.value))} /></label>
              : <p className="small muted">Set the answer time at the top of each question.</p>}
          </fieldset>
          <label>Allow Late Joins?<select value={draft.lateJoin ? 'allow' : 'deny'} onChange={(e) => onChange({ ...draft, lateJoin: e.target.value === 'allow' })}><option value="deny">Don&apos;t Allow Late Join</option><option value="allow">Allow Join After Game Start</option></select></label>
          <label>Show Correct Answers?<select disabled={draft.mode === 'survey'} value={draft.showAnswer} onChange={(e) => onChange({ ...draft, showAnswer: e.target.value as Draft['showAnswer'] })}><option value="wait_all">Wait for All Users</option><option value="after_response">Show After User Response</option><option value="never">Never Show</option></select></label>
          {draft.mode === 'survey' && <p className="muted small">Disabled for surveys: responses have no correct answer or score.</p>}
        </fieldset>
      </aside>
    </form>
    {removing !== undefined && !readOnly && <Modal title={`Delete Question ${removing + 1}?`} onClose={() => setRemoving(undefined)}><p className="muted">This action cannot be undone.</p><div className="actions equal-actions"><button onClick={() => setRemoving(undefined)}>Cancel</button><button className="delete-action" onClick={() => { onChange({ ...draft, answerDuration: timing, questions: draft.questions.filter((_, i) => i !== removing) }); setRemoving(undefined); }}>Delete</button></div></Modal>}
  </div>;
}
