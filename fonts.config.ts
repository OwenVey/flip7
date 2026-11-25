import type { FontlessOptions } from "fontless";

/**
 * Fontless reads the faces from the @fontsource packages and writes metric
 * fallbacks for each weight the styles set, so text keeps its width when the
 * web font swaps in.
 */
export const fontlessOptions = {
  provider: "npm",
  defaults: { preload: true },
  families: [
    {
      name: "Inter Variable",
      provider: "npm",
      fallbackInstances: [{ weight: 600 }, { weight: 700 }, { weight: 800 }],
    },
    {
      name: "Big Shoulders Display Variable",
      provider: "npm",
      fallbackInstances: [{ weight: 900 }],
    },
  ],
} satisfies FontlessOptions;
