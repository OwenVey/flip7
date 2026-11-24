export interface NumberCard {
  id: number;
  kind: "number";
  value: number;
}

export type ScoreModifierCard =
  | { id: number; kind: "modifier"; value: number }
  | { id: number; kind: "double" };

export type ActionCard =
  | { id: number; kind: "freeze" }
  | { id: number; kind: "flipThree" }
  | { id: number; kind: "secondChance" };

export type Card = NumberCard | ScoreModifierCard | ActionCard;

export type CardKind = Card["kind"];

type CardSpec = Card extends infer C
  ? C extends Card
    ? Omit<C, "id">
    : never
  : never;

export const HIGHEST_NUMBER = 12;
export const ADDITIVE_MODIFIER_VALUES = [2, 4, 6, 8, 10] as const;
export const COPIES_OF_EACH_ACTION = 3;
export const FLIP_SEVEN_COUNT = 7;
export const FLIP_SEVEN_BONUS = 15;

export const buildDeck = () => {
  const deck: Card[] = [{ id: 0, kind: "number", value: 0 }];

  const add = (card: CardSpec) => {
    deck.push({ ...card, id: deck.length });
  };

  for (let value = 1; value <= HIGHEST_NUMBER; value += 1) {
    for (let copy = 0; copy < value; copy += 1) {
      add({ kind: "number", value });
    }
  }

  for (const value of ADDITIVE_MODIFIER_VALUES) {
    add({ kind: "modifier", value });
  }

  add({ kind: "double" });

  for (let copy = 0; copy < COPIES_OF_EACH_ACTION; copy += 1) {
    add({ kind: "freeze" });
    add({ kind: "flipThree" });
    add({ kind: "secondChance" });
  }

  return deck;
};

export type Random = () => number;

export const shuffle = <T>(items: readonly T[], random: Random) => {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
};

export const isActionCard = (card: Card): card is ActionCard =>
  card.kind === "freeze" ||
  card.kind === "flipThree" ||
  card.kind === "secondChance";

export const isScoreModifierCard = (card: Card): card is ScoreModifierCard =>
  card.kind === "modifier" || card.kind === "double";

export const countUniqueNumberCards = (cards: readonly Card[]) =>
  new Set(cards.flatMap((card) => (card.kind === "number" ? [card.value] : [])))
    .size;

/** How a player's round score adds up. */
export interface RoundScore {
  /** The sum of their Number cards, before ×2. */
  numbers: number;
  doubled: boolean;
  /** The sum of their additive Score Modifier cards. */
  modifiers: number;
  /** Whether they earned the Flip 7 bonus. */
  flipSeven: boolean;
  total: number;
}

export const calculateRoundScore = (cards: readonly Card[]) => {
  let numberCardPoints = 0;
  let modifierPoints = 0;
  let hasMultiplier = false;

  for (const card of cards) {
    if (card.kind === "number") {
      numberCardPoints += card.value;
    } else if (card.kind === "modifier") {
      modifierPoints += card.value;
    } else if (card.kind === "double") {
      hasMultiplier = true;
    }
  }

  const earnedFlipSevenBonus =
    countUniqueNumberCards(cards) >= FLIP_SEVEN_COUNT;

  const total =
    numberCardPoints * (hasMultiplier ? 2 : 1) +
    modifierPoints +
    (earnedFlipSevenBonus ? FLIP_SEVEN_BONUS : 0);

  return {
    doubled: hasMultiplier,
    flipSeven: earnedFlipSevenBonus,
    modifiers: modifierPoints,
    numbers: numberCardPoints,
    total,
  } satisfies RoundScore;
};

const KIND_LABELS = {
  modifier: "Score Modifier card",
  double: "×2",
  flipThree: "Flip Three",
  freeze: "Freeze",
  number: "Number card",
  secondChance: "Second Chance",
} as const satisfies Record<CardKind, string>;

export const cardLabel = (card: Card) => {
  if (card.kind === "number") {
    return String(card.value);
  }

  if (card.kind === "modifier") {
    return `+${card.value}`;
  }

  return KIND_LABELS[card.kind];
};
