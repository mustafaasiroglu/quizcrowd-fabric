import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

export function useQuestionPopover(disabled: boolean, focus: (popup: HTMLDivElement) => void) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(focus);
  initialFocus.current = focus;
  const id = useId();
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || disabled) { if (open) setOpen(false); return; }
    const place = () => {
      if (!popup.current || !trigger.current) return;
      const bounds = trigger.current.getBoundingClientRect(), height = popup.current.offsetHeight;
      popup.current.dataset.side = bounds.bottom + height + 12 > innerHeight && bounds.top > height + 12 ? 'above' : 'below';
    };
    place();
    if (popup.current) initialFocus.current(popup.current);
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
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === 'Tab' && open) close(true);
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  return { root, trigger, popup, id, open, setOpen, close, onBlur, onKeyDown };
}
