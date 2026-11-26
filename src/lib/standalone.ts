const STANDALONE_QUERY = "(display-mode: standalone)";

/** True when Flip 7 is running as an installed app rather than in a browser tab. */
export const isStandalone = () =>
  globalThis.matchMedia?.(STANDALONE_QUERY).matches ||
  ("standalone" in navigator && navigator.standalone === true);
