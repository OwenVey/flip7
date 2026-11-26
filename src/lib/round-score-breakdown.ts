import { FLIP_SEVEN_BONUS } from "../game/cards";
import type { Card, RoundScore } from "../game/cards";

interface RoundScoreRow {
  label: string;
  value: string;
  cards: Card[];
  flipSeven: boolean;
}

const row = (
  label: string,
  value: string,
  cards: Card[] = [],
  flipSeven = false
) => ({ cards, flipSeven, label, value }) satisfies RoundScoreRow;

/**
 * How a scored round adds up, one row per part the player holds, ending with
 * the total: Number cards, ×2 (the doubled Number subtotal), Score Modifiers
 * and the Flip 7 bonus. Each row lists the cards in `hand` behind it, to draw
 * as small chips. A ×2 shows even with no Numbers, since the card is in the
 * player's hand.
 */
export const roundScoreRows = (score: RoundScore, hand: readonly Card[]) => {
  const ofKind = (kind: Card["kind"]) =>
    hand.filter((card) => card.kind === kind);

  return [
    row("Number cards", `${score.numbers}`, ofKind("number")),
    ...(score.doubled
      ? [row("×2", `${score.numbers * 2}`, ofKind("double"))]
      : []),
    ...(score.modifiers > 0
      ? [row("Score Modifiers", `+${score.modifiers}`, ofKind("modifier"))]
      : []),
    ...(score.flipSeven
      ? [row("Flip 7 bonus", `+${FLIP_SEVEN_BONUS}`, [], true)]
      : []),
    row("Total", `${score.total}`),
  ];
};
