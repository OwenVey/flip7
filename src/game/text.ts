const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const NAME_TEXT_LIMIT = { graphemes: 20, units: 640 } as const;
export const CHAT_TEXT_LIMIT = { graphemes: 200, units: 6400 } as const;

/** Counts characters as people see them, matching `clipText`. */
export const textLength = (text: string) => {
  let count = 0;

  for (const _ of graphemes.segment(text)) {
    count += 1;
  }

  return count;
};

/**
 * Enforces the grapheme and UTF-16 payload limits without splitting a character.
 */
export const clipText = (
  text: string,
  limit: { graphemes: number; units: number }
) => {
  let clipped = "";
  let count = 0;

  for (const { segment } of graphemes.segment(text)) {
    if (
      count === limit.graphemes ||
      clipped.length + segment.length > limit.units
    ) {
      break;
    }

    clipped += segment;
    count += 1;
  }

  return clipped;
};
