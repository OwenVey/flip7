import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { createWakeLock } from "./wake-lock";

const settle = async () => {
  for (let step = 0; step < 3; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- lets the lock request and release settle in order.
    await Promise.resolve();
  }
};

const installWakeLock = () => {
  const log: string[] = [];

  const request = async () => {
    log.push("request");
    await Promise.resolve();

    const lock = {
      release: async () => {
        lock.released = true;
        log.push("release");
        await Promise.resolve();
      },
      released: false,
    };

    return lock;
  };

  Object.assign(navigator, { wakeLock: { request } });

  return log;
};

const setVisibility = (state: DocumentVisibilityState) => {
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom can't hide its page, and the lock follows visibility.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

const render = (initial: boolean) =>
  createRoot((dispose) => {
    const [wanted, setWanted] = createSignal(initial);
    createWakeLock(wanted);
    flush();

    return {
      dispose: () => {
        dispose();
        flush();
      },
      setWanted: (next: boolean) => {
        setWanted(next);
        flush();
      },
    };
  });

describe(createWakeLock, () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- removes the visibility override above.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("holds the screen on while wanted and lets go after", async () => {
    const log = installWakeLock();
    const lock = render(false);

    await settle();
    expect(log).toStrictEqual([]);

    lock.setWanted(true);
    await settle();
    expect(log).toStrictEqual(["request"]);

    lock.setWanted(false);
    await settle();
    expect(log).toStrictEqual(["request", "release"]);
    lock.dispose();
  });

  it("asks again when the page comes back, since hiding drops the lock", async () => {
    const log = installWakeLock();
    const lock = render(true);
    await settle();

    setVisibility("hidden");
    await settle();
    expect(log).toStrictEqual(["request"]);

    setVisibility("visible");
    await settle();
    expect(log).toStrictEqual(["request"]);

    lock.dispose();
    await settle();
    expect(log).toStrictEqual(["request", "release"]);
  });

  it("does nothing where the browser has no wake lock", () => {
    expect(() => {
      render(true).dispose();
    }).not.toThrow();
  });
});
