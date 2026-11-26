import type { FontlessOptions } from "fontless";

/**
 * Fontless reads the faces from the @fontsource packages and writes metric
 * fallbacks for each weight the styles set, so text keeps its width when the
 * web font swaps in. Big Shoulders Display only renders card/score numerals,
 * so it is subsetted to those glyphs at build time.
 */
export const fontlessOptions = {
  provider: "npm",
  throwOnError: true,
  defaults: { preload: true },
  experimental: { disableLocalFallbacks: true },
  families: [
    {
      name: "Inter Variable",
      provider: "npm",
      fallbackInstances: [{ weight: 600 }, { weight: 700 }, { weight: 800 }],
    },
    {
      name: "Big Shoulders Display Variable",
      provider: "npm",
      glyphs: "0123456789+×",
      fallbackInstances: [{ weight: 600 }, { weight: 900 }],
    },
    {
      name: "Bungee",
      provider: "npm",
    },
  ],
} satisfies FontlessOptions;
