import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRoomHaptics } from "./room-haptics";

// oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom has no vibration motor or API.
const vibrate = vi.fn<(pattern: number | number[]) => boolean>();

const device = (touch: boolean) => {
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: vibrate,
  });
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: true },
  });
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom has no media queries.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: touch && query === "(any-pointer: coarse)",
    }),
  });
};

const hide = () => {
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom tabs are always visible.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
};

const setup = () =>
  createRoot((dispose) => {
    const [canPlay, setCanPlay] = createSignal(true);
    const haptics = createRoomHaptics(canPlay);
    flush();

    return { ...haptics, dispose, setCanPlay };
  });

const button = (attributes = "") => {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<button ${attributes}><span>Hit</span></button>`
  );

  const element = document.body.lastElementChild;

  if (!(element instanceof HTMLButtonElement)) {
    throw new TypeError("Expected the button just added.");
  }

  return element;
};

const touch = (target: Element, pointerType = "touch") => {
  target.dispatchEvent(
    new PointerEvent("click", { bubbles: true, pointerType })
  );
};

describe(createRoomHaptics, () => {
  beforeEach(() => {
    vibrate.mockClear();
    localStorage.removeItem("flip7:haptics-enabled");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(navigator, "vibrate");
    Reflect.deleteProperty(navigator, "userActivation");
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- Restores jsdom's missing media queries.
    Reflect.deleteProperty(window, "matchMedia");
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- Restores jsdom's own visibility.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("stays unsupported on a desktop browser that exposes a no-op vibrate", () => {
    device(false);
    const haptics = setup();

    haptics.play("turn");
    touch(button("data-game-tap"));

    expect(haptics.supported()).toBeFalsy();
    expect(vibrate).not.toHaveBeenCalled();
    haptics.dispose();
  });

  it("plays a cue's pattern on a touch device", () => {
    device(true);
    const haptics = setup();

    haptics.play("turn");

    expect(haptics.supported()).toBeTruthy();
    expect(vibrate).toHaveBeenCalledExactlyOnceWith([24, 55, 24]);
    haptics.dispose();
  });

  it("stays quiet when the room can't play cues or the tab is hidden", () => {
    device(true);
    const haptics = setup();

    haptics.setCanPlay(false);
    flush();
    haptics.play("bust");
    haptics.setCanPlay(true);
    flush();
    hide();
    haptics.play("bust");

    expect(vibrate).not.toHaveBeenCalled();
    haptics.dispose();
  });

  it("taps only for touches on enabled game controls", () => {
    device(true);
    const haptics = setup();
    const hit = button("data-game-tap");

    touch(hit.querySelector("span") ?? hit);
    touch(hit, "mouse");
    touch(button());
    touch(button('aria-disabled="true" data-game-tap'));
    hit.click();

    expect(vibrate).toHaveBeenCalledExactlyOnceWith(12);
    haptics.dispose();
    touch(hit);
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("stops a running pattern and stays quiet once turned off", () => {
    device(true);
    const haptics = setup();

    haptics.setEnabled(false);
    flush();
    haptics.play("celebrate");

    expect(vibrate).toHaveBeenCalledExactlyOnceWith(0);
    expect(localStorage.getItem("flip7:haptics-enabled")).toBe("false");
    haptics.dispose();
  });
});
