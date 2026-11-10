export interface CountdownSnapshot { startedAt: number; duration: number; serverNow: number }
interface FrameClock { now(): number; request(callback: () => void): number; cancel(id: number): void }
export function remainingTime(snapshot: CountdownSnapshot): number {
  return Math.max(0, Math.min(snapshot.duration * 1000, snapshot.startedAt + snapshot.duration * 1000 - snapshot.serverNow));
}
export function animateCountdown(snapshot: CountdownSnapshot, paint: (remaining: number, ratio: number) => void, clock: FrameClock = {
  now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
}) {
  let anchoredAt = clock.now(), remaining = remainingTime(snapshot), stopped = false, frame: number | undefined;
  const current = () => Math.max(0, remaining - Math.max(0, clock.now() - anchoredAt));
  function tick() {
    if (stopped) return;
    frame = undefined;
    const left = current();
    paint(left, snapshot.duration > 0 ? left / (snapshot.duration * 1000) : 0);
    if (left > 0) frame = clock.request(tick);
  }
  tick();
  return {
    sync(serverNow: number) {
      remaining = Math.min(current(), remainingTime({ ...snapshot, serverNow }));
      anchoredAt = clock.now();
    },
    stop() {
      stopped = true;
      if (frame !== undefined) clock.cancel(frame);
    },
  };
}
