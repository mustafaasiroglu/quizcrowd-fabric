import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export function AccountMenu({ busy, onSignOut }: { busy: boolean; onSignOut(): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const signOut = useRef<HTMLButtonElement>(null);
  const id = useId();
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    signOut.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="account-control" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true); signOut.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="account-avatar" aria-label="Account menu" title="Account menu"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Icon name="user" /></button>
    {open && <div id={id} role="menu" aria-label="Work account" className="account-menu">
      <button ref={signOut} type="button" role="menuitem" disabled={busy} onClick={() => { close(true); onSignOut(); }}><Icon name="logout" />Sign out</button>
    </div>}
  </div>;
}
