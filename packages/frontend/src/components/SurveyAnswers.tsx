import { useId, useState } from 'react';
import type { PublicQuestion, SurveyResponse } from '@rayfin-app/shared';
import { MAX_SURVEY_TEXT_LENGTH } from '@rayfin-app/shared';

export const hasLongOptions = (options: string[]): boolean => options.some(option => option.length > 100 || option.includes('\n'));

export function SurveyAnswers({ question, disabled, onSubmit }: {
  question: PublicQuestion; disabled: boolean; onSubmit(response: SurveyResponse): void;
}) {
  const id = useId();
  const onlyOther = !!question.survey?.other && !question.options.length;
  const multiple = !!question.survey?.allowMultiple;
  const [options, setOptions] = useState<number[]>([]);
  const [other, setOther] = useState(onlyOther);
  const [text, setText] = useState('');
  const valid = (options.length > 0 || other) && (!other || !!text.trim());
  function choose(index: number) {
    if (multiple) setOptions(current => current.includes(index) ? current.filter(i => i !== index) : [...current, index]);
    else { setOptions([index]); setOther(false); setText(''); }
  }
  return <form className="survey-response" onSubmit={event => {
    event.preventDefault();
    if (valid && !disabled) onSubmit({ options: [...options].sort((a, b) => a - b), ...(other ? { other: text.trim() } : {}) });
  }}>
    <fieldset disabled={disabled}>
      <legend className={onlyOther ? 'sr-only' : 'muted small'}>{onlyOther ? 'Your response' : multiple ? 'Choose all that apply' : 'Choose one response'}</legend>
      {!onlyOther && <div className={`answers survey-choices${hasLongOptions(question.options) ? ' long-options' : ''}`}>{question.options.map((option, index) => <label className={`answer answer-${index} survey-choice`} key={index}>
        <input type={multiple ? 'checkbox' : 'radio'} name={`${id}-choice`} checked={options.includes(index)} onChange={() => choose(index)} /><span>{option}</span>
      </label>)}
        {question.survey?.other && <label className="answer survey-choice other-choice"><input type={multiple ? 'checkbox' : 'radio'} name={`${id}-choice`} checked={other} onChange={() => {
          setOther(!other); setText(''); if (!multiple) setOptions([]);
        }} /><span>Other</span></label>}
      </div>}
      {other && <div className="survey-written-response"><label htmlFor={`${id}-text`} className={onlyOther ? 'sr-only' : ''}>{onlyOther ? 'Your response' : 'Your Other response'}</label><textarea id={`${id}-text`} rows={3} value={text} onChange={event => setText(event.target.value)} maxLength={MAX_SURVEY_TEXT_LENGTH} required placeholder="Write your response..." /></div>}
      <button type="submit" className="primary full-width" disabled={disabled || !valid}>Submit response</button>
    </fieldset>
  </form>;
}
