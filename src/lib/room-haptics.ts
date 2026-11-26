import { createLocalStorage, createPreference } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/solid/preferences";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";

import type { HapticOutcome } from "./room-haptic-cues";

/** Outcomes at the local seat, plus alerts and feedback the room emits itself. */
export type RoomHapticCue = HapticOutcome | "error" | "tap" | "turn";

const PATTERNS: Record<RoomHapticCue, number | number[]> = {
  bust: 75,
  celebrate: [20, 40, 30, 45, 55],
  error: [30, 40, 30],
  flipThree: [16, 35, 16, 35, 16],
  freeze: 38,
  saved: [12, 30, 28],
  tap: 12,
  turn: [24, 55, 24],
};

/**
 * Wraps haptic playback so the Move alert's vibration never cuts off an
 * outcome that vibrated in the same task, such as a Second Chance save on the
 * frame that also hands you the Move.
 */
export const turnYieldsToOutcome = (play: (cue: RoomHapticCue) => void) => {
  let outcomePlayed = false;

  return (cue: RoomHapticCue) => {
    if (cue === "turn" && outcomePlayed) {
      return;
    }

    if (cue !== "turn" && !outcomePlayed) {
      outcomePlayed = true;
      queueMicrotask(() => {
        outcomePlayed = false;
      });
    }

    play(cue);
  };
};

// WARNING: Desktop Chromium exposes a no-op `navigator.vibrate`, so also require a touch screen.
const TOUCH_QUERY = "(any-pointer: coarse)";

export const createRoomHaptics = (canPlay: () => boolean) => {
  const [supported, setSupported] = createSignal(false);

  const preference = createPreference({
    attribute: "data-haptics-enabled",
    defaultValue: "true",
    storage: createLocalStorage("flip7:haptics-enabled"),
    values: ["true", "false"],
  });

  const state = usePreference(preference);
  const enabled = createMemo(() => state().value === "true");

  const play = turnYieldsToOutcome((cue: RoomHapticCue) => {
    if (
      supported() &&
      enabled() &&
      document.visibilityState === "visible" &&
      navigator.userActivation?.hasBeenActive &&
      canPlay()
    ) {
      navigator.vibrate(PATTERNS[cue]);
    }
  });

  // WARNING: Script `click()` calls report an empty pointer type, so keep the touch check.
  const tap = (event: MouseEvent) => {
    if (
      "pointerType" in event &&
      (event.pointerType === "touch" || event.pointerType === "pen") &&
      event.target instanceof Element &&
      event.target.closest(
        "[data-game-tap]:not(:disabled):not([aria-disabled=true])"
      )
    ) {
      play("tap");
    }
  };

  onSettled(() => {
    if (
      "vibrate" in navigator &&
      globalThis.matchMedia?.(TOUCH_QUERY).matches
    ) {
      setSupported(true);
      document.addEventListener("click", tap, true);
    }

    return () => {
      document.removeEventListener("click", tap, true);
    };
  });

  createEffect(enabled, (allowsVibration) => {
    if (!allowsVibration && supported()) {
      navigator.vibrate(0);
    }
  });

  return {
    enabled,
    play,
    setEnabled: (value: boolean) => {
      preference.set(value ? "true" : "false");
    },
    supported,
  };
};
