import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plainSvg from "../../public/favicon.svg?raw";
import { createMoveAlert } from "./move-alert";

const ROOM_TITLE = "Your move · Room ABCDE · Flip 7";
const ALERT_TITLE = "⚡ Your move!";

const setup = (initiallyAlerting: boolean) =>
  createRoot((dispose) => {
    const [alerting, setAlerting] = createSignal(initiallyAlerting);
    const [hidden, setHidden] = createSignal(false);
    const title = createMoveAlert(alerting, () => ROOM_TITLE, hidden);
    flush();

    return {
      dispose: () => {
        dispose();
        flush();
      },
      setAlerting: (next: boolean) => {
        setAlerting(next);
        flush();
      },
      setHidden: (next: boolean) => {
        setHidden(next);
        flush();
      },
      title,
    };
  });

const tick = () => {
  vi.advanceTimersByTime(1000);
  flush();
};

const iconHref = () =>
  document.head
    .querySelector('link[type="image/svg+xml"]')
    ?.getAttribute("href") ?? "";

const icon = () => {
  const href = iconHref();

  if (!href.startsWith("data:")) {
    return href;
  }

  return decodeURIComponent(href).includes("<circle") ? "dot" : "plain";
};

describe(createMoveAlert, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = `
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the tab alone when no move is owed", () => {
    const alert = setup(false);

    alert.setHidden(true);
    tick();

    expect(alert.title()).toBe(ROOM_TITLE);
    expect(icon()).toBe("/favicon.svg");
    alert.dispose();
  });

  it("shows a steady dot while the tab is visible", () => {
    const alert = setup(true);

    tick();

    expect(alert.title()).toBe(ROOM_TITLE);
    expect(icon()).toBe("dot");
    expect(
      document.head.querySelector('link[sizes="32x32"]')?.getAttribute("href")
    ).toBe("/favicon.ico");
    alert.dispose();
  });

  it("draws the dot on top of the site icon", () => {
    const alert = setup(true);

    expect(decodeURIComponent(iconHref())).toContain(
      plainSvg.trimEnd().replace("</svg>", "<circle")
    );
    alert.dispose();
  });

  it("blinks the title and dot together while the tab is hidden", () => {
    const alert = setup(true);

    alert.setHidden(true);
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);

    tick();
    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, "plain"]);

    tick();
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);
    alert.dispose();
  });

  it("stops blinking when the player comes back to the tab", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setHidden(false);

    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, "dot"]);
    alert.dispose();
  });

  it("puts the site icon back when the alert ends and starts lit next time", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setAlerting(false);
    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, "/favicon.svg"]);

    alert.setAlerting(true);
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);
    alert.dispose();
  });

  it("stops the timer and puts the site icon back when disposed", () => {
    const alert = setup(true);

    alert.setHidden(true);
    alert.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(icon()).toBe("/favicon.svg");
  });

  it("does nothing to a page without an SVG icon", () => {
    document.head.innerHTML = "";

    expect(() => {
      setup(true).dispose();
    }).not.toThrow();
  });
});
