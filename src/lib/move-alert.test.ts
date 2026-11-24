import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMoveAlertBlink, MOVE_ALERT_BLINK_MS } from "./move-alert";

const setup = (initiallyAlerting: boolean) =>
  createRoot((dispose) => {
    const [alerting, setAlerting] = createSignal(initiallyAlerting);
    const [hidden, setHidden] = createSignal(false);
    const blink = createMoveAlertBlink(alerting, hidden);
    flush();

    return {
      blink,
      dispose,
      setHidden: (next: boolean) => {
        setHidden(next);
        flush();
      },
      setAlerting: (next: boolean) => {
        setAlerting(next);
        flush();
      },
    };
  });

const tick = () => {
  vi.advanceTimersByTime(MOVE_ALERT_BLINK_MS);
  flush();
};

describe(createMoveAlertBlink, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays steady while the tab is visible", () => {
    const alert = setup(true);

    tick();

    expect(alert.blink()).toBe("steady");
    alert.dispose();
  });

  it("blinks while the tab is hidden and the game is waiting on the player", () => {
    const alert = setup(true);

    alert.setHidden(true);
    expect(alert.blink()).toBe("lit");

    tick();
    expect(alert.blink()).toBe("dark");

    tick();
    expect(alert.blink()).toBe("lit");
    alert.dispose();
  });

  it("doesn't blink in a hidden tab when no move is owed", () => {
    const alert = setup(false);

    alert.setHidden(true);
    tick();

    expect(alert.blink()).toBe("steady");
    alert.dispose();
  });

  it("stops blinking when the player comes back to the tab", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setHidden(false);

    expect(alert.blink()).toBe("steady");
    alert.dispose();
  });

  it("stops blinking when the move alert ends and starts lit next time", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setAlerting(false);
    expect(alert.blink()).toBe("steady");

    alert.setAlerting(true);
    expect(alert.blink()).toBe("lit");
    alert.dispose();
  });

  it("stops the timer when disposed", () => {
    const alert = setup(true);

    alert.setHidden(true);
    alert.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });
});
