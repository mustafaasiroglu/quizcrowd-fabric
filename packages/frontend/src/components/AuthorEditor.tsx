import { useRef, useState } from 'react';
import type { Draft, Question, SurveyQuestionType } from '@rayfin-app/shared';
import { getAnswerDuration, getSurveyQuestionType, MAX_OPTIONS, MAX_TITLE_LENGTH, PUBLIC_WARNING, setAnswerDuration, setSurveyQuestionType } from '@rayfin-app/shared';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { DurationInput } from './DurationInput';
import { QuestionTypePicker } from './QuestionTypePicker';
import { QuestionDurationPicker } from './QuestionDurationPicker';

export const blankQuestion = (duration = 20): Question => ({ text: '', options: ['', '', '', ''], correctIndex: null, duration });
export const blankDraft = (mode: Draft['mode'] = 'quiz'): Draft => ({
  title: '', mode, visibility: 'internal', publicAcknowledged: false,
  lateJoin: false, showAnswer: 'wait_all', questions: [blankQuestion()], answerDuration: { mode: 'same', seconds: 20 },
});
export function sameDraftContent(left: Draft, right: Draft): boolean {
  const content = (draft: Draft) => {
    const timing = getAnswerDuration(draft);
    return JSON.stringify({
      title: draft.title.trim(), mode: draft.mode, visibility: draft.visibility,
      publicAcknowledged: draft.publicAcknowledged, lateJoin: draft.lateJoin, showAnswer: draft.showAnswer,
      answerDuration: { mode: timing.mode, seconds: timing.seconds },
      questions: draft.questions.map(question => ({
        text: question.text.trim(), options: question.options.map(option => option.trim()),
        correctIndex: question.correctIndex, duration: question.duration,
        ...(draft.mode === 'survey' ? { survey: { other: !!question.survey?.other, allowMultiple: !!question.survey?.allowMultiple } } : {}),
      })),
    });
  };
  return content(left) === content(right);
}
export function removeOption(question: Question, index: number): Question {
  const correct = question.correctIndex;
  const options = question.options.filter((_, i) => i !== index);
  return { ...question, options,
    ...(question.survey && !options.length ? { survey: { ...question.survey, allowMultiple: false } } : {}),
    correctIndex: correct === null || correct === index ? null : correct > index ? correct - 1 : correct };
}
export function AuthorEditor({ draft, onChange, editing, dirty = false, anonymousEnabled, busy, readOnly = false, onSave, onBack, onHost, onJoin, joinUnavailableReason, onRevokePublic }: {
  draft: Draft; onChange(draft: Draft): void; editing: boolean; anonymousEnabled: boolean;
  busy: boolean; readOnly?: boolean; dirty?: boolean; onSave(): void; onBack(): void; onHost?(): void; onJoin?(): void; joinUnavailableReason?: string; onRevokePublic?(): void;
}) {
  const [removing, setRemoving] = useState<number>();
  const questionsRef = useRef<HTMLDivElement>(null);
  const optionMemory = useRef(new WeakMap<Question, string[]>());
  const timing = getAnswerDuration(draft);
  const needsSave = !readOnly && (!editing || dirty);
  function setDuration(mode: 'same' | 'custom', seconds = timing.seconds) {
    const next = setAnswerDuration(draft, { mode, seconds });
    next.questions.forEach((question, index) => {
      const previous = draft.questions[index];
      if (previous) {
        const options = optionMemory.current.get(previous);
        if (options) optionMemory.current.set(question, options);
      }
    });
    onChange(next);
  }
  function updateQuestion(index: number, patch: Partial<Question>, previousOptions?: string[]) {
    onChange({ ...draft, answerDuration: timing, questions: draft.questions.map((q, i) => {
      if (i !== index) return q;
      const next = { ...q, ...patch }, remembered = previousOptions ?? patch.options ?? optionMemory.current.get(q);
      if (remembered) optionMemory.current.set(next, remembered);
      return next;
    }) });
  }
  function changeSurveyType(index: number, type: SurveyQuestionType) {
    const question = draft.questions[index]!;
    const options = question.options.length ? question.options : optionMemory.current.get(question) ?? [];
    updateQuestion(index, setSurveyQuestionType(question, type, options), options);
  }
  function move(index: number, direction: -1 | 1) {
    const questions = [...draft.questions], next = index + direction;
    if (next < 0 || next >= questions.length) return;
    [questions[index], questions[next]] = [questions[next]!, questions[index]!];
    onChange({ ...draft, answerDuration: timing, questions });
  }
  return <div className="author page-container">
    <div className="section-heading page-heading"><button className="icon-button" aria-label="Go back" onClick={onBack}><Icon name="back" /></button><h1>{readOnly ? 'View' : editing ? 'Edit' : 'New'} Live {draft.mode === 'quiz' ? 'Quiz' : 'Survey'}</h1>
      {(needsSave || onHost || (readOnly && onJoin)) && <div className="author-session-actions">
        {readOnly && onJoin && <button type="button" className="subtle" disabled={busy || !!joinUnavailableReason} aria-describedby={joinUnavailableReason ? 'attendee-join-reason' : undefined} onClick={onJoin}><Icon name="join" />Attend</button>}
        {needsSave ? <button type="submit" form="session-author-form" className="primary" disabled={busy || (draft.visibility === 'public' && (!anonymousEnabled || !draft.publicAcknowledged))}><Icon name="save" />{busy ? 'Saving...' : editing ? 'Save & Open' : 'Create & Open Lobby'}</button>
          : onHost && <button type="button" className="primary" disabled={busy} onClick={onHost}><Icon name="play" />Open Lobby</button>}
      </div>}
    </div>
    {readOnly && onJoin && joinUnavailableReason && <p id="attendee-join-reason" className="muted small attendee-join-reason">{joinUnavailableReason}</p>}
    {readOnly && <p className="readonly-notice" role="status">Read-only: this session has started or has responses.</p>}
    <form id="session-author-form" className="author-layout" onSubmit={(event) => { event.preventDefault(); if (!readOnly && !busy) { if (needsSave) onSave(); else onHost?.(); } }}>
      <fieldset className="author-content" disabled={readOnly || busy}>
        <legend className="sr-only">Session content</legend>
        <section className="card title-card"><label htmlFor="quiz-title">Title</label><input id="quiz-title" placeholder={draft.mode === 'quiz' ? 'Untitled live quiz' : 'Untitled live survey'} required maxLength={MAX_TITLE_LENGTH} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} /></section>
        <div ref={questionsRef}>{draft.questions.map((q, i) => <fieldset className="card question-editor" key={i}>
          <legend className="sr-only">Question {i + 1}</legend>
          <div className="section-heading question-heading"><h2>Question {i + 1}</h2>
            {!readOnly && draft.questions.length > 1 && <div className="reorder">
              <button type="button" className="icon-button" disabled={i === 0} aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)}><Icon name="up" /></button>
              <button type="button" className="icon-button" disabled={i === draft.questions.length - 1} aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)}><Icon name="down" /></button>
            </div>}
            <div className="question-actions">
              {timing.mode === 'custom' && <QuestionDurationPicker number={i + 1} value={q.duration} disabled={readOnly || busy} onChange={duration => updateQuestion(i, { duration })} />}
              {draft.mode === 'survey' && <QuestionTypePicker number={i + 1} value={getSurveyQuestionType(q)} disabled={readOnly || busy} onChange={type => changeSurveyType(i, type)} />}
              {!readOnly && draft.questions.length > 1 && <button type="button" className="icon-button delete-action" aria-label={`Remove question ${i + 1}`} onClick={() => setRemoving(i)}><Icon name="trash" /></button>}
            </div>
          </div>
          <label className="sr-only" htmlFor={`question-${i}`}>Question {i + 1} text</label><textarea id={`question-${i}`} placeholder="Enter your question" required maxLength={1000} rows={2} value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })} />
          <div className="option-editor-grid">{q.options.map((option, k) => <div className={`option-editor ${draft.mode === 'quiz' && q.correctIndex === k ? 'is-correct' : ''}`} key={k}>
            {draft.mode === 'quiz' && <input type="radio" name={`correct-${i}`} required aria-label={`Question ${i + 1}, correct option ${k + 1}`} checked={q.correctIndex === k} onChange={() => updateQuestion(i, { correctIndex: k })} />}
            <label className="sr-only" htmlFor={`option-${i}-${k}`}>Question {i + 1}, option {k + 1}</label><input id={`option-${i}-${k}`} placeholder={`Option ${k + 1}`} required maxLength={300} value={option} onChange={(e) => updateQuestion(i, { options: q.options.map((o, n) => n === k ? e.target.value : o) })} />
            {!readOnly && (q.options.length > 2 || (draft.mode === 'survey' && q.survey?.other)) && <button type="button" className="icon-button delete-action remove-option" aria-label={`Remove question ${i + 1} option ${k + 1}`} onClick={() => updateQuestion(i, removeOption(q, k))}><Icon name="trash" /></button>}
          </div>)}
            {draft.mode === 'survey' && q.survey?.other && q.options.length > 0 && <div className="option-editor other-option"><span>Other <span className="small muted">(written response)</span></span>{!readOnly && <button type="button" className="icon-button delete-action remove-option" aria-label={`Remove question ${i + 1} Other`} disabled={q.options.length < 2} onClick={() => updateQuestion(i, { survey: { other: false, allowMultiple: !!q.survey?.allowMultiple } })}><Icon name="trash" /></button>}</div>}
          </div>
          {!readOnly && draft.mode === 'survey' && getSurveyQuestionType(q) === 'text' && <p className="muted small">Respondents can write a free-text answer.</p>}
          {!readOnly && (draft.mode === 'quiz' || getSurveyQuestionType(q) !== 'text') && <div className="question-option-footer">
          {draft.mode === 'quiz' && <p className="muted small option-hint">Select the circle beside the correct answer.</p>}
          {!readOnly && <div className="option-actions">
            <button type="button" className="text-button" disabled={q.options.length >= MAX_OPTIONS} onClick={() => updateQuestion(i, { options: [...q.options, ''] })}><Icon name="plus" />{q.options.length >= MAX_OPTIONS ? '10 options maximum' : 'Add option'}</button>
            {draft.mode === 'survey' && !q.survey?.other && <button type="button" className="text-button add-other" aria-label={`Add Other to question ${i + 1}`} onClick={() => updateQuestion(i, { survey: { other: true, allowMultiple: getSurveyQuestionType(q) === 'multiple' } })}><Icon name="plus" />Add Other</button>}
          </div>}
          </div>}
        </fieldset>)}</div>
        {!readOnly && <div className="editor-actions"><button type="button" className="outline-primary" disabled={draft.questions.length >= 40} onClick={() => {
          onChange({ ...draft, answerDuration: timing, questions: [...draft.questions, blankQuestion(timing.seconds)] });
          requestAnimationFrame(() => questionsRef.current?.querySelector<HTMLTextAreaElement>('fieldset:last-child textarea')?.focus());
        }}><Icon name="plus" />Add Question</button></div>}
      </fieldset>
      <div className="author-settings"><aside className="card settings-panel" aria-labelledby="settings-heading"><h2 id="settings-heading"><Icon name="settings" />Settings</h2>
        {onRevokePublic && <button type="button" className="subtle full-width" disabled={busy} onClick={onRevokePublic}>Revoke public access (make internal)</button>}
        <fieldset disabled={readOnly || busy}><legend className="sr-only">Session settings</legend>
          <div className="settings-group"><fieldset className="audience-settings"><legend>Who can respond?</legend>
            <label className="check"><input type="radio" name="audience" value="internal" checked={draft.visibility === 'internal'} onChange={() => onChange({ ...draft, visibility: 'internal', publicAcknowledged: false })} /><span>Only people in my organization<span className="small muted audience-description">Requires sign-in with organization account</span></span></label>
            <label className="check"><input type="radio" name="audience" value="public" checked={draft.visibility === 'public'} disabled={!anonymousEnabled} onChange={() => onChange({ ...draft, visibility: 'public', publicAcknowledged: false })} /><span>{anonymousEnabled ? 'Anyone with link' : 'Anyone with link (disabled by admin)'}<span className="small muted audience-description">Anonymous response, no sign-in required.</span></span></label>
          </fieldset>
          {draft.visibility === 'public' && <div className="warning"><p>{PUBLIC_WARNING}</p><label className="check"><input type="checkbox" checked={draft.publicAcknowledged} onChange={(e) => onChange({ ...draft, publicAcknowledged: e.target.checked })} required />I understand and choose public access.</label></div>}</div>
          <div className="settings-group"><fieldset className="duration-settings"><legend>Answer duration</legend>
            <div className="shared-duration-choice"><label className="check"><input type="radio" name="answer-duration" value="same" checked={timing.mode === 'same'} onChange={() => setDuration('same')} />Same for all questions</label>
              {timing.mode === 'same' && <DurationInput id="shared-duration" label="Duration in seconds for all questions" value={timing.seconds} onChange={seconds => setDuration('same', seconds)} />}
            </div>
            <label className="check custom-duration-choice"><input type="radio" name="answer-duration" value="custom" aria-describedby={!readOnly && timing.mode === 'custom' ? 'custom-duration-help' : undefined} checked={timing.mode === 'custom'} onChange={() => setDuration('custom')} /><span>Customize each question</span></label>
            {!readOnly && timing.mode === 'custom' && <p id="custom-duration-help" className="small muted option-help">Set seperately on each question.</p>}
          </fieldset></div>
          <div className="settings-group"><fieldset className="late-join-settings"><legend>Allow late joins?</legend>
            <label className="check"><input type="radio" name="late-join" value="deny" checked={!draft.lateJoin} onChange={() => onChange({ ...draft, lateJoin: false })} />Don&apos;t allow late join</label>
            <label className="check"><input type="radio" name="late-join" value="allow" checked={draft.lateJoin} onChange={() => onChange({ ...draft, lateJoin: true })} />Allow join after game start</label>
          </fieldset></div>
          {draft.mode === 'quiz' && <div className="settings-group"><fieldset className="answer-reveal-settings"><legend>Show correct answers?</legend>
            <label className="check"><input type="radio" name="answer-reveal" value="wait_all" checked={draft.showAnswer === 'wait_all'} onChange={() => onChange({ ...draft, showAnswer: 'wait_all' })} />Wait for all users</label>
            <label className="check"><input type="radio" name="answer-reveal" value="after_response" checked={draft.showAnswer === 'after_response'} onChange={() => onChange({ ...draft, showAnswer: 'after_response' })} />Show after user response</label>
            <label className="check"><input type="radio" name="answer-reveal" value="never" checked={draft.showAnswer === 'never'} onChange={() => onChange({ ...draft, showAnswer: 'never' })} />Never show</label>
          </fieldset>
          </div>}
        </fieldset>
      </aside></div>
    </form>
    {removing !== undefined && !readOnly && <Modal title={`Delete Question ${removing + 1}?`} onClose={() => setRemoving(undefined)}><p className="muted">This action cannot be undone.</p><div className="actions equal-actions"><button onClick={() => setRemoving(undefined)}>Cancel</button><button className="delete-action" onClick={() => { onChange({ ...draft, answerDuration: timing, questions: draft.questions.filter((_, i) => i !== removing) }); setRemoving(undefined); }}>Delete</button></div></Modal>}
  </div>;
}
