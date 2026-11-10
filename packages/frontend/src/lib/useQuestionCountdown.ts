import { useLayoutEffect, useRef, useState } from 'react';
import type { GameView } from '@rayfin-app/shared';
import { animateCountdown, remainingTime } from './countdown';

export function useQuestionCountdown(game: GameView) {
  const duration = game.question?.duration ?? 0;
  const startedAt = game.questionStartedAt ?? 0;
  const serverNow = game.serverNow ?? Date.now();
  const key = `${game.id}:${game.phase}:${game.questionIndex}:${startedAt}:${duration}`;
  const initial = Math.ceil(remainingTime({ startedAt, duration, serverNow }) / 1000);
  const [label, setLabel] = useState({ key, seconds: initial });
  const last = useRef(label);
  const fill = useRef<HTMLDivElement>(null);
  const animation = useRef<ReturnType<typeof animateCountdown>>(undefined);
  useLayoutEffect(() => {
    if (game.phase !== 'question') return;
    const active = animateCountdown({ startedAt, duration, serverNow }, (remaining, ratio) => {
      if (fill.current) fill.current.style.transform = `scaleX(${ratio})`;
      const seconds = Math.ceil(remaining / 1000);
      if (last.current.key !== key || last.current.seconds !== seconds) {
        last.current = { key, seconds }; setLabel(last.current);
      }
    });
    animation.current = active;
    return () => { active.stop(); animation.current = undefined; };
  }, [key]);
  useLayoutEffect(() => { animation.current?.sync(serverNow); }, [serverNow, key]);
  return { seconds: label.key === key ? label.seconds : initial, fill };
}
