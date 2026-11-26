import { describe, expect, it } from "vitest";

import { calculateRoundScore, cardLabel } from "../game/cards";
import type { Card } from "../game/cards";
import { roundScoreRows } from "./round-score-breakdown";

const numbers = (...values: number[]) =>
  values.map(
    (value, index) => ({ id: index, kind: "number", value }) satisfies Card
  );

const DOUBLE: Card = { id: 100, kind: "double" };
const PLUS_TWO: Card = { id: 101, kind: "modifier", value: 2 };
const PLUS_SIX: Card = { id: 102, kind: "modifier", value: 6 };

const rows = (hand: Card[]) =>
  roundScoreRows(calculateRoundScore(hand), hand).map(
    ({ label, value }) => `${label} ${value}`
  );

const chips = (hand: Card[]) =>
  roundScoreRows(calculateRoundScore(hand), hand).map(
    ({ cards, flipSeven, label }) =>
      `${label}: ${[...cards.map(cardLabel), ...(flipSeven ? ["flame"] : [])].join(" ")}`
  );

describe(roundScoreRows, () => {
  it("shows only Number cards and the total for a plain hand", () => {
    expect(rows(numbers(12, 11))).toStrictEqual([
      "Number cards 23",
      "Total 23",
    ]);
  });

  it("doubles the Number subtotal before adding Score Modifiers", () => {
    expect(rows([...numbers(12, 11), DOUBLE, PLUS_SIX])).toStrictEqual([
      "Number cards 23",
      "×2 46",
      "Score Modifiers +6",
      "Total 52",
    ]);
  });

  it("keeps the ×2 row when there are no Number cards to double", () => {
    expect(rows([DOUBLE, PLUS_TWO, PLUS_SIX])).toStrictEqual([
      "Number cards 0",
      "×2 0",
      "Score Modifiers +8",
      "Total 8",
    ]);
  });

  it("adds the Flip 7 bonus last", () => {
    expect(rows([...numbers(0, 1, 2, 3, 4, 5, 6), PLUS_TWO])).toStrictEqual([
      "Number cards 21",
      "Score Modifiers +2",
      "Flip 7 bonus +15",
      "Total 38",
    ]);
  });

  it("lists the cards behind each part, and a flame for Flip 7", () => {
    expect(
      chips([...numbers(12, 11), DOUBLE, PLUS_TWO, PLUS_SIX])
    ).toStrictEqual([
      "Number cards: 12 11",
      "×2: ×2",
      "Score Modifiers: +2 +6",
      "Total: ",
    ]);
    expect(chips(numbers(0, 1, 2, 3, 4, 5, 6))).toStrictEqual([
      "Number cards: 0 1 2 3 4 5 6",
      "Flip 7 bonus: flame",
      "Total: ",
    ]);
  });
});
