import { describe, expect, it } from 'vitest';
import { animateCountdown, remainingTime } from '../packages/frontend/src/lib/countdown';

function fixture() {
  let time = 1000, next = 0;
  const pending = new Map<number, () => void>(), cancelled: number[] = [];
  const paints: { remaining: number; ratio: number }[] = [];
  const clock = {
    now: () => time,
    request(callback: () => void) { const id = next++; pending.set(id, callback); return id; },
    cancel(id: number) { cancelled.push(id); pending.delete(id); },
  };
  const animation = animateCountdown({ startedAt: 0, duration: 10, serverNow: 2000 }, (remaining, ratio) => paints.push({ remaining, ratio }), clock);
  return { animation, paints, pending, cancelled,
    frame(at: number) { time = at; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); } };
}
describe('monotonic countdown display, not game authority', () => {
  it('paints exact intermediate subsecond fractions without rounding to the label', () => {
    const f = fixture();
    expect(f.paints.at(-1)).toEqual({ remaining: 8000, ratio: .8 });
    f.frame(1250); expect(f.paints.at(-1)).toEqual({ remaining: 7750, ratio: .775 });
    f.frame(1600); expect(f.paints.at(-1)).toEqual({ remaining: 7400, ratio: .74 });
    expect(f.pending.size).toBe(1);
    f.animation.stop();
  });
  it('resynchronizes server snapshots without resetting or extending the same question', () => {
    const f = fixture();
    f.frame(1600);
    f.animation.sync(2800);
    f.frame(1700); expect(f.paints.at(-1)).toEqual({ remaining: 7100, ratio: .71 });
    f.animation.sync(1000); // An older poll cannot make the progress bar grow.
    f.frame(1800); expect(f.paints.at(-1)).toEqual({ remaining: 7000, ratio: .7 });
    f.animation.stop();
  });
  it('resumes after frame drops/background time, clamps expiry and stops scheduling', () => {
    const f = fixture();
    f.frame(30000);
    expect(f.paints.at(-1)).toEqual({ remaining: 0, ratio: 0 });
    expect(f.pending.size).toBe(0);
    f.animation.sync(0); f.frame(31000);
    expect(f.paints).toHaveLength(2);
  });
  it('cancels frame id zero and ignores late callbacks after cleanup/question replacement', () => {
    const f = fixture(), late = f.pending.get(0)!;
    f.animation.stop();
    expect(f.cancelled).toEqual([0]); expect(f.pending.size).toBe(0);
    late();
    expect(f.paints).toHaveLength(1);
    const next = fixture();
    expect(next.paints[0]).toEqual({ remaining: 8000, ratio: .8 });
    next.animation.stop();
  });
  it.each([[0, 10000], [5000, 5000], [20000, 0]])('clamps a server timestamp %s to %s ms', (serverNow, expected) => {
    expect(remainingTime({ startedAt: 0, duration: 10, serverNow })).toBe(expected);
  });
});
