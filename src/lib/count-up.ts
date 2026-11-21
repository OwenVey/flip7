import { createEffect, createSignal, untrack } from "solid-js";

import { motionAllowed } from "./motion";

const COUNT_MS = 600;

const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

/** A number that counts toward `target` whenever it changes, instead of jumping. */
export const createCountUp = (target: () => number) => {
  const [shown, setShown] = createSignal(untrack(target));

  createEffect(target, (to) => {
    const from = untrack(shown);
    let frame = 0;

    if (from !== to && motionAllowed()) {
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / COUNT_MS);
        setShown(Math.round(from + (to - from) * easeOut(progress)));

        if (progress < 1) {
          frame = requestAnimationFrame(tick);
        }
      };

      frame = requestAnimationFrame(tick);
    } else if (from !== to) {
      queueMicrotask(() => {
        setShown(to);
      });
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  });

  return shown;
};
