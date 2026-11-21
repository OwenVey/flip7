/** True when the tab is showing and the player hasn't asked for less motion. */
export const motionAllowed = () =>
  document.visibilityState === "visible" &&
  globalThis.matchMedia?.("(prefers-reduced-motion: no-preference)").matches;
