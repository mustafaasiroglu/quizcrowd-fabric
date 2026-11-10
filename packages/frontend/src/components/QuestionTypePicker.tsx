import { useRef } from 'react';
import type { SurveyQuestionType } from '@rayfin-app/shared';
import { Icon } from './Icon';
import { useQuestionPopover } from '../lib/useQuestionPopover';

const choices = [
  { value: 'single', label: 'Single Select' },
  { value: 'multiple', label: 'Multiple Select' },
  { value: 'text', label: 'Free Text' },
] as const;

export function QuestionTypePicker({ value, number, disabled, onChange }: {
  value: SurveyQuestionType; number: number; disabled: boolean; onChange(value: SurveyQuestionType): void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef(0);
  const { root, trigger, popup: menu, id, open, setOpen, close, onBlur, onKeyDown } =
    useQuestionPopover(disabled, () => items.current[initialFocus.current]?.focus({ preventScroll: true }));
  const selected = choices.findIndex(choice => choice.value === value);
  return <div className="question-type-control question-popover-control" ref={root} onBlur={onBlur} onKeyDown={event => {
    onKeyDown(event);
    if (disabled) return;
    if (event.target === trigger.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? choices.length - 1 : selected; setOpen(true);
    } else if (open && event.target !== trigger.current) {
      const current = items.current.findIndex(item => item === document.activeElement);
      const next = event.key === 'ArrowDown' ? (current + 1) % choices.length
        : event.key === 'ArrowUp' ? (current + choices.length - 1) % choices.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : event.key.length === 1 && event.key !== ' ' ? choices.findIndex(choice => choice.label.toLowerCase().startsWith(event.key.toLowerCase())) : -1;
      if (next >= 0) { event.preventDefault(); items.current[next]?.focus(); }
    }
  }}>
    <button ref={trigger} type="button" className="question-type question-popover-trigger" value={value} disabled={disabled}
      aria-label={`Question ${number} response type: ${choices[selected]!.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialFocus.current = selected; setOpen(!open); }}>
      <Icon name="adjust" /><span>{choices[selected]!.label}</span>
    </button>
    {open && !disabled && <div ref={menu} className="question-type-menu question-popover" id={id} role="menu" aria-label={`Question ${number} response type`}>
      {choices.map((choice, index) => <button key={choice.value} ref={element => { items.current[index] = element; }} type="button"
        role="menuitemradio" aria-checked={value === choice.value} value={choice.value} tabIndex={-1}
        onClick={() => { onChange(choice.value); close(true); }}>{choice.label}</button>)}
    </div>}
  </div>;
}
