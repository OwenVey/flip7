/** Matches when the app runs from the home screen or as an installed desktop app. */
export const STANDALONE_QUERY = "(display-mode: standalone)";

/** True when Flip 7 is running as an installed app rather than in a browser tab. */
export const isStandalone = () =>
  globalThis.matchMedia?.(STANDALONE_QUERY).matches ||
  ("standalone" in navigator && navigator.standalone === true);
