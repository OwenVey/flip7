import { createEffect, createMemo } from "solid-js";

const holdScreenOn = () => {
  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async () => {
    if (
      released ||
      document.visibilityState !== "visible" ||
      (sentinel !== null && !sentinel.released)
    ) {
      return;
    }

    try {
      const lock = await navigator.wakeLock.request("screen");

      if (released) {
        await lock.release();
      } else {
        sentinel = lock;
      }
    } catch {
      // WARNING: request() rejects on low battery or in a hidden page; the next visibility change retries.
    }
  };

  const reacquire = () => {
    void acquire();
  };

  document.addEventListener("visibilitychange", reacquire);
  reacquire();

  return () => {
    released = true;
    document.removeEventListener("visibilitychange", reacquire);
    void sentinel?.release();
  };
};

/**
 * Keeps the screen on while `wanted` is true. The browser drops the lock
 * whenever the page hides, so it is asked for again each time the page comes
 * back. Browsers without the Screen Wake Lock API do nothing.
 */
export const createWakeLock = (wanted: () => boolean) => {
  const active = createMemo(wanted);

  createEffect(active, (on) =>
    on && "wakeLock" in navigator ? holdScreenOn() : undefined
  );
};
