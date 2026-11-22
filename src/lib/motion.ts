export const MOTION_PREFERENCE_QUERY =
  "(prefers-reduced-motion: no-preference)";

/** True when the tab is showing and the player hasn't asked for less motion. */
export const motionAllowed = () =>
  document.visibilityState === "visible" &&
  globalThis.matchMedia?.(MOTION_PREFERENCE_QUERY).matches;
