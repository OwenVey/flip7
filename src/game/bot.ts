import {
  buildDeck,
  calculateRoundScore,
  countUniqueNumberCards,
} from "./cards";
import type { Card } from "./cards";
import type { ActionCardChoice, Player, RoundStatus } from "./engine";
import { canStay } from "./moves";
import type { PlayMove } from "./moves";

/** Hit while the chance of busting on the next card is below this. */
export const BOT_RISK = 0.3;

/** The risk a bot accepts when it's far behind the leader late in a game. */
export const BOT_CATCH_UP_RISK = 0.4;

/** How far behind the leader a bot must be to play catch-up. */
export const BOT_CATCH_UP_GAP = 50;

/** The leader's score at which a game counts as late. */
export const BOT_LATE_GAME_SCORE = 150;

const CATCH_UP_STATUSES = new Set<RoundStatus>(["active", "stayed"]);

const NUMBER_COPIES = (() => {
  const copies = new Map<number, number>();

  for (const card of buildDeck()) {
    if (card.kind === "number") {
      copies.set(card.value, (copies.get(card.value) ?? 0) + 1);
    }
  }

  return copies;
})();

const DECK_SIZE = buildDeck().length;

type BotPlayer = Pick<Player, "bustCard" | "hand" | "id" | "score" | "status">;

/**
 * The public table a bot decides from: what every player can see in the room
 * view. It never reads the deck or the discard pile.
 */
export interface BotView {
  choice: ActionCardChoice | null;
  players: readonly BotPlayer[];
  targetScore: number;
}

const visibleCards = (view: BotView) =>
  view.players.flatMap((player) =>
    player.bustCard ? [...player.hand, player.bustCard] : player.hand
  );

const roundPoints = (player: BotPlayer) =>
  player.status === "busted" ? 0 : calculateRoundScore(player.hand).total;

/**
 * The chance that the next card duplicates a Number card in `hand`, counting
 * only the cards that aren't face up on the table.
 */
export const bustChance = (view: BotView, hand: readonly Card[]) => {
  const seen = new Map<number, number>();
  const visible = visibleCards(view);

  for (const card of visible) {
    if (card.kind === "number") {
      seen.set(card.value, (seen.get(card.value) ?? 0) + 1);
    }
  }

  const held = new Set(
    hand.flatMap((card) => (card.kind === "number" ? [card.value] : []))
  );

  let danger = 0;

  for (const value of held) {
    danger += Math.max(
      0,
      (NUMBER_COPIES.get(value) ?? 0) - (seen.get(value) ?? 0)
    );
  }

  const unseen = Math.max(1, DECK_SIZE - visible.length);

  return Math.min(1, danger / unseen);
};

const standing = (player: BotPlayer) => player.score + roundPoints(player);

const wouldWinByStaying = (view: BotView, bot: BotPlayer) => {
  const total = standing(bot);

  if (total < view.targetScore) {
    return false;
  }

  return view.players.every(
    (other) => other.id === bot.id || standing(other) < total
  );
};

const acceptedRisk = (view: BotView, bot: BotPlayer) => {
  const leader = Math.max(
    ...view.players.map((player) =>
      CATCH_UP_STATUSES.has(player.status) ? standing(player) : player.score
    )
  );

  const behind = leader - standing(bot) >= BOT_CATCH_UP_GAP;

  return behind && leader >= BOT_LATE_GAME_SCORE ? BOT_CATCH_UP_RISK : BOT_RISK;
};

const HIT = { type: "hit" } satisfies PlayMove;
const STAY = { type: "stay" } satisfies PlayMove;

const decideTurn = (view: BotView, bot: BotPlayer) => {
  if (!canStay(bot)) {
    return HIT;
  }

  if (wouldWinByStaying(view, bot)) {
    return STAY;
  }

  if (bot.hand.some((card) => card.kind === "secondChance")) {
    return HIT;
  }

  return bustChance(view, bot.hand) < acceptedRisk(view, bot) ? HIT : STAY;
};

const pickBest = (
  candidates: readonly BotPlayer[],
  score: (player: BotPlayer) => number
) => {
  let best: BotPlayer | undefined;

  for (const candidate of candidates) {
    if (best === undefined || score(candidate) > score(best)) {
      best = candidate;
    }
  }

  return best;
};

const choiceAppeal = (
  view: BotView,
  kind: ActionCardChoice["card"]["kind"]
) => {
  if (kind === "freeze") {
    return standing;
  }

  if (kind === "flipThree") {
    return (player: BotPlayer) =>
      bustChance(view, player.hand) * 1000 +
      countUniqueNumberCards(player.hand) +
      standing(player) / 1000;
  }

  return (player: BotPlayer) => -standing(player);
};

const decideChoice = (
  view: BotView,
  bot: BotPlayer,
  choice: ActionCardChoice
) => {
  const options = choice.options.flatMap((id) => {
    const player = view.players.find((candidate) => candidate.id === id);

    return player ? [player] : [];
  });

  const others = options.filter((player) => player.id !== bot.id);

  const target = pickBest(
    others.length > 0 ? others : options,
    choiceAppeal(view, choice.card.kind)
  );

  return target
    ? ({ targetId: target.id, type: "choose" } satisfies PlayMove)
    : null;
};

/**
 * The move a bot makes when the game is waiting on it: a choice when it owes
 * one, otherwise Hit or Stay.
 */
export const decideBotMove = (view: BotView, botId: string) => {
  const bot = view.players.find((player) => player.id === botId);

  if (!bot) {
    return null;
  }

  if (view.choice) {
    return view.choice.chooserId === botId
      ? decideChoice(view, bot, view.choice)
      : null;
  }

  return decideTurn(view, bot);
};
