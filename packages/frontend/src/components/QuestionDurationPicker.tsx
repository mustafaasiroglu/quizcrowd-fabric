import { flushSync } from 'react-dom';
import { useQuestionPopover } from '../lib/useQuestionPopover';
import { DurationInput } from './DurationInput';
import { Icon } from './Icon';

export function QuestionDurationPicker({ value, number, disabled, onChange }: {
  value: number; number: number; disabled: boolean; onChange(value: number): void;
}) {
  const popover = useQuestionPopover(disabled, popup => popup.querySelector('input')?.focus({ preventScroll: true }));
  const label = `Question ${number} duration in seconds`;
  // Keep the input mounted so a closed popup still participates in form validation.
  return <div className="question-duration-control question-popover-control" ref={popover.root}
    onBlur={popover.onBlur} onKeyDown={popover.onKeyDown}>
    <button ref={popover.trigger} type="button" className="question-duration question-popover-trigger" disabled={disabled}
      aria-label={`${label}: ${value}`} aria-haspopup="dialog" aria-expanded={popover.open} aria-controls={popover.id}
      onClick={() => popover.setOpen(!popover.open)}>
      <Icon name="clock" /><span>{value}s</span>
    </button>
    <div ref={popover.popup} id={popover.id} className="question-duration-popup question-popover" role="dialog" aria-label={label} hidden={!popover.open || disabled}>
      <DurationInput label={label} value={value} onChange={onChange}
        onInvalid={() => { if (!disabled) flushSync(() => popover.setOpen(true)); }} />
    </div>
  </div>;
}
