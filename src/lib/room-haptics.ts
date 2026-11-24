import { makePersisted } from "@solid-primitives/storage";
import { createSignal, onSettled } from "solid-js";

import { preferenceStorage } from "./preference-storage";
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

// WARNING: Desktop Chromium exposes a no-op `navigator.vibrate`, so also require a touch screen.
const TOUCH_QUERY = "(any-pointer: coarse)";

export const createRoomHaptics = (canPlay: () => boolean) => {
  const [supported, setSupported] = createSignal(false);

  const [enabled, setEnabled] = makePersisted(
    createSignal(true, { ownedWrite: true }),
    {
      deserialize: (value) => value !== "false",
      name: "flip7:haptics-enabled",
      storage: preferenceStorage,
    }
  );

  const play = (cue: RoomHapticCue) => {
    if (
      supported() &&
      enabled() &&
      document.visibilityState === "visible" &&
      navigator.userActivation?.hasBeenActive &&
      canPlay()
    ) {
      navigator.vibrate(PATTERNS[cue]);
    }
  };

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

  return {
    enabled,
    play,
    setEnabled: (value: boolean) => {
      setEnabled(value);

      if (!value && supported()) {
        navigator.vibrate(0);
      }
    },
    supported,
  };
};
