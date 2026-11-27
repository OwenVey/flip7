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

const listeners = new Set<(time: number) => void>();
let sharedFrame = 0;

const scheduleFrame = () => {
  if (sharedFrame !== 0 || listeners.size === 0) {
    return;
  }

  sharedFrame = requestAnimationFrame((time) => {
    sharedFrame = 0;

    for (const listener of listeners) {
      listener(time);
    }

    scheduleFrame();
  });
};

const subscribeFrame = (listener: (time: number) => void) => {
  listeners.add(listener);
  scheduleFrame();

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && sharedFrame !== 0) {
      cancelAnimationFrame(sharedFrame);
      sharedFrame = 0;
    }
  };
};

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

  const isFinished = (count: Count, time: number) =>
    count.from === count.to || duration <= 0 || time - count.start >= duration;

  const valueAt = (count: Count, time: number) => {
    if (isFinished(count, time)) {
      return count.to;
    }

    const progress = Math.max(0, (time - count.start) / duration);

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
    const initialTime = untrack(now);
    let stop: (() => void) | null = null;

    if (!isFinished(current, initialTime)) {
      let lastShown = valueAt(current, initialTime);

      stop = subscribeFrame((time) => {
        const nextShown = valueAt(current, time);
        const done = isFinished(current, time);

        if (nextShown !== lastShown || done) {
          lastShown = nextShown;
          setNow(time);
        }

        if (done) {
          stop?.();
        }
      });
    }

    return () => {
      stop?.();
    };
  });

  return {
    finished: createMemo(() => isFinished(count(), now())),
    shown: createMemo(() => valueAt(count(), now())),
  };
};
