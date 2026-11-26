const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Counts characters as people see them, matching `clipText`. */
export const textLength = (text: string) => {
  let count = 0;

  for (const _ of graphemes.segment(text)) {
    count += 1;
  }

  return count;
};

/**
 * Cuts text to at most `max` characters as people see them, so an emoji
 * sequence or an accented letter is never split in half.
 */
export const clipText = (text: string, max: number) => {
  let clipped = "";
  let count = 0;

  for (const { segment } of graphemes.segment(text)) {
    if (count === max) {
      break;
    }

    clipped += segment;
    count += 1;
  }

  return clipped;
};
