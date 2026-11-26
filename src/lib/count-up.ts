import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import { motionAllowed } from "./motion";

const COUNT_MS = 600;

const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

interface Count {
  from: number;
  to: number;
  start: number;
}

const canAnimate = () => typeof document !== "undefined" && motionAllowed();

/**
 * A number that counts toward `target` whenever it changes, instead of jumping.
 * The shown value is derived from the current count and a clock that only
 * animation frames advance, so it changes in the same flush as `target`.
 */
export const createCountUp = (
  target: () => number,
  options: { durationMs?: number; initial?: () => number } = {}
) => {
  const duration = options.durationMs ?? COUNT_MS;
  const destination = createMemo(target);
  const [now, setNow] = createSignal(0);

  const valueAt = (count: Count, time: number) => {
    const progress = Math.min(1, Math.max(0, (time - count.start) / duration));

    return Math.round(count.from + (count.to - count.from) * easeOut(progress));
  };

  const count = createMemo<Count>((previous) => {
    const to = destination();
    const start = performance.now();

    if (previous === undefined) {
      const from =
        options.initial && canAnimate() ? untrack(options.initial) : to;

      return { from, start, to };
    }

    return {
      from: canAnimate() ? valueAt(previous, untrack(now)) : to,
      start,
      to,
    };
  });

  createEffect(count, (current) => {
    let frame = 0;

    if (current.from !== current.to) {
      const tick = (time: number) => {
        setNow(time);

        if (time - current.start < duration) {
          frame = requestAnimationFrame(tick);
        }
      };

      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  });

  return createMemo(() => valueAt(count(), now()));
};
