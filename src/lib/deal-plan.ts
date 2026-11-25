import { isActionCard } from "../game/cards";
import type { Card } from "../game/cards";
import type { DealEvent, DrawEvent, HeldCard, Player } from "../game/engine";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";

/** Beyond this many cards in one update, show the result without dealing it out. */
export const MAX_DEALT_CARDS = 20;

export type DealSpot =
  | { kind: "hand"; playerId: string }
  | { kind: "bust"; playerId: string }
  | { kind: "held"; playerId: string }
  | { kind: "choice" }
  | { kind: "discard"; playerId: string }
  | { kind: "played"; playerId: string };

/** The card shows at the player's seat, then leaves the table: discarded, or played on them. */
export const leavesTable = (spot: DealSpot) =>
  spot.kind === "discard" || spot.kind === "played";

export interface DealStep {
  card: Card;
  /** Where the card starts: the deck, the action card prompt, or a held pile. */
  from: "deck" | "choice" | "held";
  /** A discarded card shows at the player's seat first, then leaves. */
  to: DealSpot;
  /** Set when the card is one of the flips of a Flip Three. */
  flip: DrawEvent["flip"];
  /** The Second Chance that cancels this card, discarded along with it. */
  partnerId: number | null;
  hit?: true;
}

interface Table {
  hands: Map<string, Card[]>;
  held: HeldCard[];
}

const locate = (room: RoomView, cardId: number) => {
  if (room.choice?.card.id === cardId) {
    return { kind: "choice" } satisfies DealSpot;
  }

  for (const player of room.players) {
    if (player.hand.some((card) => card.id === cardId)) {
      return { kind: "hand", playerId: player.id } satisfies DealSpot;
    }
  }

  const held = room.held.find((entry) => entry.card.id === cardId);

  return held ? ({ kind: "held", playerId: held.ownerId } as const) : null;
};

const newDealEvents = (previous: RoomView, current: RoomView) => {
  const since = previous.dealSeq;
  const events = current.dealHistory.filter((event) => event.seq > since);

  return events.length === current.dealSeq - since &&
    events.every((event, index) => event.seq === since + index + 1)
    ? events
    : null;
};

const handOf = (table: Table, playerId: string) => {
  const hand = table.hands.get(playerId) ?? [];
  table.hands.set(playerId, hand);

  return hand;
};

const takeSecondChance = (table: Table, playerId: string) => {
  const hand = handOf(table, playerId);
  const index = hand.findIndex((card) => card.kind === "secondChance");

  if (index === -1) {
    return null;
  }

  const [chance] = hand.splice(index, 1);

  return chance?.id ?? null;
};

const record = (table: Table, steps: DealStep[], step: DealStep) => {
  steps.push(step);

  if (step.from === "held") {
    table.held = table.held.filter((entry) => entry.card.id !== step.card.id);
  }

  if (step.to.kind === "hand") {
    handOf(table, step.to.playerId).push(step.card);
  }

  if (step.to.kind === "held" && isActionCard(step.card)) {
    table.held.push({ card: step.card, ownerId: step.to.playerId });
  }
};

const startsFlipThree = (upcoming: DrawEvent[], playerId: string) => {
  const flip = upcoming.find((draw) => draw.flip !== null);

  return flip?.flip?.index === 1 && flip.playerId === playerId;
};

const leavingSpot = (card: Card, playerId: string, upcoming: DrawEvent[]) =>
  card.kind === "flipThree" && startsFlipThree(upcoming, playerId)
    ? ({ kind: "played", playerId } satisfies DealSpot)
    : ({ kind: "discard", playerId } satisfies DealSpot);

const playedActionSpot = (
  current: RoomView,
  draw: DrawEvent,
  later: DrawEvent[]
) => {
  const spot = locate(current, draw.card.id);

  if (spot) {
    return spot;
  }

  const usedLater = later.some(
    (event) => event.outcome === "saved" && event.playerId === draw.playerId
  );

  return draw.card.kind === "secondChance" && usedLater
    ? ({ kind: "hand", playerId: draw.playerId } satisfies DealSpot)
    : leavingSpot(draw.card, draw.playerId, later);
};

const drawStep = (
  table: Table,
  current: RoomView,
  draw: DrawEvent,
  later: DrawEvent[]
) => {
  const step: DealStep = {
    card: draw.card,
    flip: draw.flip,
    ...(draw.hit && { hit: true }),
    from: "deck",
    partnerId: null,
    to: { kind: "hand", playerId: draw.playerId },
  };

  if (draw.outcome === "bust") {
    step.to = { kind: "bust", playerId: draw.playerId };
  } else if (draw.outcome === "held") {
    step.to = { kind: "held", playerId: draw.playerId };
  } else if (draw.outcome === "saved") {
    step.to = { kind: "discard", playerId: draw.playerId };
    step.partnerId = takeSecondChance(table, draw.playerId);
  } else if (draw.outcome === "action") {
    step.to = playedActionSpot(current, draw, later);
  }

  return step;
};

const releaseHeld = (
  table: Table,
  steps: DealStep[],
  current: RoomView,
  upcoming: DealEvent[]
) => {
  if (table.held.length === 0) {
    return;
  }

  const [next] = upcoming;

  const nextByCard = new Map(
    upcoming.toReversed().map(({ card, type }) => [card.id, type])
  );

  for (const entry of table.held) {
    if (nextByCard.get(entry.card.id) === "heldAction") {
      continue;
    }

    const spot = locate(current, entry.card.id);
    const stays = spot?.kind === "held" && spot.playerId === entry.ownerId;

    const stillFlipping =
      next?.type === "draw" &&
      next.flip !== null &&
      next.playerId === entry.ownerId;

    if (!stays && !stillFlipping) {
      record(table, steps, {
        card: entry.card,
        flip: null,
        from: "held",
        partnerId: null,
        to: spot ?? { kind: "discard", playerId: entry.ownerId },
      });
    }
  }
};

const heldActionStep = (
  event: Extract<DealEvent, { type: "heldAction" }>,
  choiceId: number | undefined
) => {
  let kind: "discard" | "hand" | "played" = "discard";

  if (event.outcome === "played") {
    kind = event.card.kind === "freeze" ? "hand" : "played";
  }

  return {
    card: event.card,
    flip: null,
    from: event.card.id === choiceId ? "choice" : "held",
    partnerId: null,
    to: { kind, playerId: event.targetId },
  } satisfies DealStep;
};

const resolvedChoice = (
  table: Table,
  steps: DealStep[],
  previous: RoomView,
  current: RoomView,
  draws: DrawEvent[]
) => {
  const card = previous.choice?.card;

  if (!card || current.choice?.card.id === card.id) {
    return;
  }

  const target = draws.find((draw) => draw.flip !== null)?.playerId;

  const spot =
    locate(current, card.id) ??
    (card.kind === "flipThree" && target !== undefined
      ? leavingSpot(card, target, draws)
      : null);

  if (spot && spot.kind !== "choice") {
    record(table, steps, {
      card,
      flip: null,
      from: "choice",
      partnerId: null,
      to: spot,
    });
  }
};

/**
 * Lists the cards that move between two room states, in the order they were
 * drawn: from the deck, out of the action card prompt, or off a held pile.
 * Returns no steps when the update can't be replayed card by card.
 */
export const planDeal = (previous: RoomView, current: RoomView) => {
  const events = newDealEvents(previous, current);

  if (current.phase === "lobby" || events === null) {
    return [];
  }

  const newRound = roundStarted(previous, current);

  const table: Table = {
    hands: new Map(
      newRound
        ? []
        : previous.players.map((player) => [player.id, [...player.hand]])
    ),
    held: newRound ? [] : [...previous.held],
  };

  const steps: DealStep[] = [];
  const draws = events.filter((event) => event.type === "draw");
  let choiceId = newRound ? undefined : previous.choice?.card.id;

  const nextForChoice = events.find((event) => event.card.id === choiceId);

  if (!newRound && nextForChoice?.type !== "heldAction") {
    resolvedChoice(table, steps, previous, current, draws);
    choiceId = undefined;
  }

  let drawsSeen = 0;

  for (const [index, event] of events.entries()) {
    releaseHeld(table, steps, current, events.slice(index));

    if (event.type === "heldAction") {
      const step = heldActionStep(event, choiceId);
      record(table, steps, step);

      if (step.from === "choice") {
        choiceId = undefined;
      }
    } else {
      drawsSeen += 1;
      record(
        table,
        steps,
        drawStep(table, current, event, draws.slice(drawsSeen))
      );
    }
  }

  releaseHeld(table, steps, current, []);

  return steps.length > MAX_DEALT_CARDS ? [] : steps;
};

interface Seat {
  player: Player;
  hand: Card[];
  bustCard: Card | null;
}

const without = (cards: Card[], ...ids: (number | null)[]) => {
  const leaving = new Set(ids);

  return cards.filter((card) => !leaving.has(card.id));
};

const arrive = (
  seats: Map<string, Seat>,
  frame: { choice: RoomView["choice"]; held: HeldCard[] },
  step: DealStep,
  current: RoomView
) => {
  if (step.from === "choice") {
    frame.choice = null;
  }

  const { to } = step;

  if (step.from === "held" && (!leavesTable(to) || to.kind === "played")) {
    frame.held = frame.held.filter((entry) => entry.card.id !== step.card.id);
  }

  if (to.kind === "choice") {
    frame.choice = current.choice;

    return;
  }

  const seat = seats.get(to.playerId);

  if (to.kind === "held" && isActionCard(step.card)) {
    frame.held = [...frame.held, { card: step.card, ownerId: to.playerId }];
  } else if (seat && to.kind === "bust") {
    seat.bustCard = step.card;
  } else if (
    seat &&
    to.kind !== "played" &&
    (to.kind === "hand" || step.from !== "held")
  ) {
    seat.hand = [...seat.hand, step.card];
  }
};

const complete = (
  seats: Map<string, Seat>,
  frame: { held: HeldCard[] },
  step: DealStep
) => {
  if (!leavesTable(step.to)) {
    return;
  }

  const seat = seats.get(step.to.playerId);

  if (seat) {
    seat.hand = without(seat.hand, step.card.id, step.partnerId);
  }

  frame.held = frame.held.filter((entry) => entry.card.id !== step.card.id);
};

const settleStep = (seats: Map<string, Seat>, step: DealStep) => {
  if (step.to.kind === "bust") {
    const seat = seats.get(step.to.playerId);

    if (seat) {
      seat.player = { ...seat.player, status: "busted" };
    }
  } else if (step.to.kind === "hand" && step.card.kind === "freeze") {
    const seat = seats.get(step.to.playerId);

    if (seat) {
      seat.player = { ...seat.player, status: "frozen" };
    }
  }
};

export const stepPlayerId = (step: DealStep) =>
  step.to.kind === "choice" ? null : step.to.playerId;

/**
 * The room to show while the first `shown` steps are on the table (the last
 * of them still in flight). Everything except the moving cards stays as it was
 * until the deal ends, so a bust or a freeze shows only once its card lands.
 */
export const dealFrame = (
  previous: RoomView,
  current: RoomView,
  steps: DealStep[],
  shown: number,
  options?: { landed?: boolean }
) => {
  const newRound = roundStarted(previous, current);
  const before = new Map(previous.players.map((seat) => [seat.id, seat]));
  const remaining = steps.slice(shown);
  const waiting = new Set(remaining.map(stepPlayerId));

  const seats = new Map(
    current.players.map((player) => {
      const earlier = newRound ? undefined : before.get(player.id);

      const base = earlier
        ? { ...earlier, connected: player.connected }
        : {
            ...player,
            status: waiting.has(player.id) ? "active" : player.status,
          };

      const seat: Seat = {
        bustCard: earlier?.bustCard ?? null,
        hand: earlier ? [...earlier.hand] : [],
        player: base,
      };

      return [player.id, seat];
    })
  );

  const frame = {
    choice: newRound ? null : previous.choice,
    held: newRound ? [] : [...previous.held],
  };

  for (const [index, step] of steps.slice(0, shown).entries()) {
    arrive(seats, frame, step, current);

    if (index < shown - 1) {
      complete(seats, frame, step);
      settleStep(seats, step);
    } else if (options?.landed === true) {
      settleStep(seats, step);
    }
  }

  const view: RoomView = {
    ...(newRound ? current : previous),
    choice: frame.choice,
    deckCount:
      current.deckCount +
      remaining.filter((step) => step.from === "deck").length,
    held: frame.held,
    players: [...seats.values()].map(({ player, hand, bustCard }) => ({
      ...player,
      bustCard,
      hand,
    })),
    turnId: newRound ? null : previous.turnId,
  };

  return view;
};
