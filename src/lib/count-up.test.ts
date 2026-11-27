import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCountUp } from "./count-up";

const withMotion = (run: () => void) => {
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });

  try {
    run();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
};

const mount = (...args: Parameters<typeof createCountUp>) =>
  createRoot((dispose) => ({
    dispose,
    ...createCountUp(...args),
  }));

describe(createCountUp, () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("updates synchronously in the same flush when motion is off", () => {
    const [target, setTarget] = createSignal(10);
    const { dispose, finished, shown } = mount(target, { initial: () => 0 });

    try {
      expect(shown()).toBe(10);
      expect(finished()).toBeTruthy();

      setTarget(42);
      flush();

      expect(shown()).toBe(42);
      expect(finished()).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it("counts from initial to target over durationMs when motion is on", () => {
    withMotion(() => {
      const [target] = createSignal(100);

      const { dispose, shown } = mount(target, {
        durationMs: 200,
        initial: () => 0,
      });

      try {
        flush();
        expect(shown()).toBe(0);

        vi.advanceTimersByTime(100);
        flush();
        expect(shown()).toBeGreaterThan(0);
        expect(shown()).toBeLessThan(100);

        vi.advanceTimersByTime(100);
        flush();
        expect(shown()).toBe(100);
      } finally {
        dispose();
      }
    });
  });

  it("continues from the current displayed value when retargeted mid-animation", () => {
    withMotion(() => {
      const [target, setTarget] = createSignal(0);
      const { dispose, shown } = mount(target, { durationMs: 200 });

      try {
        flush();
        expect(shown()).toBe(0);

        setTarget(100);
        flush();

        vi.advanceTimersByTime(50);
        flush();

        const mid = shown();

        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(100);

        setTarget(200);
        flush();

        expect(shown()).toBe(mid);

        vi.advanceTimersByTime(200);
        flush();
        expect(shown()).toBe(200);
      } finally {
        dispose();
      }
    });
  });

  it("cancels its pending animation frame when disposed", () => {
    withMotion(() => {
      const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
      const [target] = createSignal(50);
      const { dispose } = mount(target, { durationMs: 200, initial: () => 0 });

      flush();
      dispose();

      expect(cancel).toHaveBeenCalledOnce();
    });
  });
});
