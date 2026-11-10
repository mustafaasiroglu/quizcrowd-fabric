import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { SurveyQuestionType } from '@rayfin-app/shared';
import { Icon } from './Icon';

const choices = [
  { value: 'single', label: 'Single Select' },
  { value: 'multiple', label: 'Multiple Select' },
  { value: 'text', label: 'Free Text' },
] as const;

export function QuestionTypePicker({ value, number, disabled, onChange }: {
  value: SurveyQuestionType; number: number; disabled: boolean; onChange(value: SurveyQuestionType): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef(0);
  const id = useId();
  const selected = choices.findIndex(choice => choice.value === value);
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || disabled) { if (open) setOpen(false); return; }
    const place = () => {
      if (!menu.current || !trigger.current) return;
      const bounds = trigger.current.getBoundingClientRect(), height = menu.current.offsetHeight;
      menu.current.dataset.side = bounds.bottom + height + 12 > innerHeight && bounds.top > height + 12 ? 'above' : 'below';
    };
    place();
    items.current[initialFocus.current]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, disabled]);
  return <div className="question-type-control" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (disabled) return;
    if (event.key === 'Tab' && open) close(true);
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
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
    <button ref={trigger} type="button" className="question-type" value={value} disabled={disabled}
      aria-label={`Question ${number} response type: ${choices[selected]!.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialFocus.current = selected; setOpen(!open); }}>
      <span>{choices[selected]!.label}</span><Icon name="adjust" />
    </button>
    {open && !disabled && <div ref={menu} className="question-type-menu" id={id} role="menu" aria-label={`Question ${number} response type`}>
      {choices.map((choice, index) => <button key={choice.value} ref={element => { items.current[index] = element; }} type="button"
        role="menuitemradio" aria-checked={value === choice.value} value={choice.value} tabIndex={-1}
        onClick={() => { onChange(choice.value); close(true); }}>{choice.label}</button>)}
    </div>}
  </div>;
}
