import { Icon } from './Icon';

export function DurationInput({ id, label, value, onChange }: {
  id?: string; label: string; value: number; onChange(value: number): void;
}) {
  return <label className="duration" htmlFor={id}><Icon name="clock" />
    <span className="sr-only">{label}</span>
    <input id={id} type="number" min={5} max={120} required value={value} onChange={event => onChange(Number(event.target.value))} />
    <span aria-hidden="true">s</span>
  </label>;
}
