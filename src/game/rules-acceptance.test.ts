import { describe, expect, it } from "vitest";

import {
  ADDITIVE_MODIFIER_KIND,
  buildDeck,
  calculateRoundScore,
  countUniqueNumberCards,
} from "./cards";
import type { Card } from "./cards";
import {
  addPlayer,
  choose,
  createGame,
  GameError,
  hit,
  nextRound,
  startGame,
  stay,
} from "./engine";
import type { GameState } from "./engine";
import { availableMoves, waitingOn } from "./moves";
import { toRoomView } from "./protocol";

const random = () => 0.5;

let lastId = 5000;

const newId = () => {
  lastId += 1;

  return lastId;
};

const num = (value: number) =>
  ({ id: newId(), kind: "number", value }) satisfies Card;

const plus = (value: number) =>
  ({ id: newId(), kind: ADDITIVE_MODIFIER_KIND, value }) satisfies Card;

const double = () => ({ id: newId(), kind: "double" }) satisfies Card;
const freeze = () => ({ id: newId(), kind: "freeze" }) satisfies Card;
const flipThree = () => ({ id: newId(), kind: "flipThree" }) satisfies Card;

const secondChance = () =>
  ({ id: newId(), kind: "secondChance" }) satisfies Card;

const ids = (cards: readonly Card[]) => cards.map(({ id }) => id);
const byNumber = (left: number, right: number) => left - right;
const sortedIds = (cards: readonly Card[]) => ids(cards).toSorted(byNumber);

const seat = (state: GameState, playerId: string) => {
  const found = state.players.find(({ id }) => id === playerId);

  if (found === undefined) {
    throw new Error(`No player ${playerId}`);
  }

  return found;
};

const rig = (state: GameState, draws: readonly Card[]) => {
  state.deck = [...draws].toReversed();
};

const betweenRounds = (names: string[]) => {
  const state = createGame();

  for (const name of names) {
    addPlayer(state, name, name, 1);
  }

  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = names.length - 2;

  for (const player of state.players) {
    player.hand = [];
    player.score = 0;
  }

  state.discard = [];

  return state;
};

const deal = (names: string[], draws: readonly Card[]) => {
  const state = betweenRounds(names);
  rig(state, draws);
  nextRound(state, "a", random);
  state.discard = [];

  return state;
};

const canStay = (state: GameState, playerId: string) =>
  availableMoves(state, playerId).turn?.canStay ?? null;

const scores = (state: GameState) =>
  Object.fromEntries(state.players.map(({ id, score }) => [id, score]));

const snapshot = (state: GameState) => ({
  choice: state.choice && {
    cardId: state.choice.card.id,
    chooserId: state.choice.chooserId,
    options: state.choice.options,
  },
  deck: ids(state.deck),
  discard: ids(state.discard),
  phase: state.phase,
  players: Object.fromEntries(
    state.players.map((player) => [
      player.id,
      {
        hand: ids(player.hand),
        score: player.score,
        status: player.status,
      },
    ])
  ),
  turnId: state.turnId,
});

describe("1. deck and card identity", () => {
  it("has 94 uniquely identified cards in the 3.1 composition", () => {
    const deck = buildDeck();
    const counts: Record<string, number> = {};

    for (const each of deck) {
      const key =
        each.kind === "number" || each.kind === ADDITIVE_MODIFIER_KIND
          ? `${each.kind}:${each.value}`
          : each.kind;

      counts[key] = (counts[key] ?? 0) + 1;
    }

    const numbers = Object.fromEntries(
      Array.from({ length: 13 }, (_, value) => [
        `number:${value}`,
        Math.max(value, 1),
      ])
    );

    expect(deck).toHaveLength(94);
    expect(new Set(ids(deck)).size).toBe(94);
    expect(counts).toStrictEqual({
      ...numbers,
      [`${ADDITIVE_MODIFIER_KIND}:10`]: 1,
      [`${ADDITIVE_MODIFIER_KIND}:2`]: 1,
      [`${ADDITIVE_MODIFIER_KIND}:4`]: 1,
      [`${ADDITIVE_MODIFIER_KIND}:6`]: 1,
      [`${ADDITIVE_MODIFIER_KIND}:8`]: 1,
      double: 1,
      flipThree: 3,
      freeze: 3,
      secondChance: 3,
    });
  });

  it("checks busts by Number value, so 2, +2 and ×2 never collide, and counts 0 as a distinct Number", () => {
    const state = deal(["a", "b", "c"], [num(2), num(4), num(5)]);
    rig(state, [plus(2)]);
    hit(state, "a", random);
    stay(state, "b", random);
    stay(state, "c", random);
    rig(state, [double()]);
    hit(state, "a", random);

    expect(seat(state, "a").status).toBe("active");
    expect(countUniqueNumberCards([num(0), num(1)])).toBe(2);
  });
});

describe("2. opening deal", () => {
  it("A's opening Freeze on B: B banks zero, gets no opener, and the deal moves on", () => {
    const opener = freeze();
    const cCard = num(8);
    const next = num(11);
    const state = deal(["a", "b", "c"], [opener, cCard, next]);

    expect(snapshot(state).choice).toStrictEqual({
      cardId: opener.id,
      chooserId: "a",
      options: ["a", "b", "c"],
    });

    choose(state, "a", "b", random);

    expect(snapshot(state)).toMatchObject({
      choice: null,
      deck: [next.id],
      players: {
        a: { hand: [], status: "active" },
        b: { hand: [opener.id], status: "frozen" },
        c: { hand: [cCard.id], status: "active" },
      },
      turnId: "a",
    });
    expect(calculateRoundScore(seat(state, "b").hand).total).toBe(0);
  });

  it("A's opening Flip Three on B: B gets Hit or Stay at B's slot instead of a compulsory card", () => {
    const opener = flipThree();
    const flips = [num(1), num(2), num(3)];
    const bHit = num(9);
    const cCard = num(4);
    const next = num(11);
    const state = deal(["a", "b", "c"], [opener, ...flips, bHit, cCard, next]);

    choose(state, "a", "b", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id, cCard.id, bHit.id],
      players: { b: { hand: ids(flips) }, c: { hand: [] } },
      turnId: "b",
    });
    expect(canStay(state, "b")).toBeTruthy();

    hit(state, "b", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      players: {
        b: { hand: [...ids(flips), bHit.id] },
        c: { hand: [cCard.id] },
      },
      turnId: "a",
    });
  });

  it("keeps the card-in-front guard at the opening slot when forced draws left the player empty", () => {
    const state = deal(
      ["a", "b", "c", "d"],
      [flipThree(), freeze(), freeze(), freeze()]
    );

    choose(state, "a", "b", random);
    choose(state, "b", "c", random);
    choose(state, "b", "d", random);
    choose(state, "b", "a", random);

    expect(snapshot(state)).toMatchObject({
      players: { b: { hand: [], status: "active" } },
      turnId: "b",
    });
    expect(canStay(state, "b")).toBeFalsy();
    expect(() => {
      stay(state, "b", random);
    }).toThrow(GameError);
  });

  it("A gives away the opening Freeze: A stays active, gets no replacement, and can't Stay", () => {
    const opener = freeze();
    const next = num(11);
    const state = deal(["a", "b", "c"], [opener, num(8), next]);

    choose(state, "a", "b", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      players: { a: { hand: [], status: "active" } },
      turnId: "a",
    });
    expect(canStay(state, "a")).toBeFalsy();
    expect(() => {
      stay(state, "a", random);
    }).toThrow(GameError);

    hit(state, "a", random);

    expect(ids(seat(state, "a").hand)).toStrictEqual([next.id]);
  });

  it("skips the opening slot of a player busted before it", () => {
    const one = num(1);
    const unflipped = num(6);
    const bCard = num(4);
    const state = betweenRounds(["a", "b", "c"]);
    rig(state, [flipThree(), one, num(1), unflipped, bCard]);
    nextRound(state, "a", random);

    choose(state, "a", "c", random);

    expect(snapshot(state)).toMatchObject({
      deck: [bCard.id],
      players: {
        b: { hand: [unflipped.id] },
        c: { hand: [one.id], status: "busted" },
      },
      turnId: "a",
    });
  });
});

describe("2. normal turns", () => {
  it.each([
    ["only a 0", () => num(0)],
    ["only ×2", double],
    ["only a Second Chance", secondChance],
  ])("allows Stay holding %s, scoring zero", (_label, make) => {
    const held = make();
    const state = deal(["a", "b", "c"], [held, num(4), num(5)]);

    expect(ids(seat(state, "a").hand)).toStrictEqual([held.id]);
    expect(canStay(state, "a")).toBeTruthy();

    stay(state, "a", random);
    stay(state, "b", random);
    stay(state, "c", random);

    expect(seat(state, "a").lastRound?.total).toBe(0);
    expect(seat(state, "a").score).toBe(0);
  });

  it("A holds 2, then draws +2 and ×2: no duplicate, one Number toward Flip 7, banks 6", () => {
    const state = deal(["a", "b", "c"], [num(2), num(4), num(5)]);
    rig(state, [plus(2), double()]);

    hit(state, "a", random);
    stay(state, "b", random);
    stay(state, "c", random);
    hit(state, "a", random);

    const a = seat(state, "a");

    expect(a.status).toBe("active");
    expect(countUniqueNumberCards(a.hand)).toBe(1);

    stay(state, "a", random);

    expect(state.log).toContainEqual(
      expect.objectContaining({ text: "a stayed and banked 6 points." })
    );
    expect(a.lastRound?.total).toBe(6);
  });

  it("passes the turn on after a successful Hit", () => {
    const state = deal(["a", "b", "c"], [num(2), num(4), num(5)]);
    rig(state, [num(7)]);

    hit(state, "a", random);

    expect(state.turnId).toBe("b");
  });
});

describe("3. revealed cards", () => {
  it("A holds 9 and Second Chance and hits a 9: both go to discard, no replacement, play advances", () => {
    const nine = num(9);
    const state = deal(["a", "b", "c"], [nine, num(4), num(5)]);
    const chance = secondChance();
    seat(state, "a").hand.push(chance);
    const duplicate = num(9);
    const next = num(11);
    rig(state, [duplicate, next]);

    hit(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      discard: [chance.id, duplicate.id],
      players: { a: { hand: [nine.id], status: "active" } },
      turnId: "b",
    });
  });

  it("busts on a duplicate without Second Chance and scores zero, modifiers included", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    seat(state, "a").hand.push(plus(10), double());
    rig(state, [num(9)]);

    hit(state, "a", random);
    stay(state, "b", random);
    stay(state, "c", random);

    expect(snapshot(state)).toMatchObject({
      phase: "roundOver",
      players: { a: { score: 0, status: "busted" }, b: { score: 4 } },
    });
  });

  it("lets the drawer Freeze themselves, and Second Chance doesn't stop it", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    seat(state, "a").hand.push(secondChance());
    rig(state, [freeze()]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(snapshot(state)).toMatchObject({
      players: { a: { status: "frozen" } },
      turnId: "b",
    });
  });

  it("makes the last active player target themselves", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    stay(state, "a", random);
    stay(state, "b", random);
    rig(state, [freeze()]);

    hit(state, "c", random);

    expect(snapshot(state)).toMatchObject({
      choice: null,
      phase: "roundOver",
      players: { c: { status: "frozen" } },
    });
  });

  it("offers an extra Second Chance only to active players without one", () => {
    const state = deal(
      ["a", "b", "c", "d", "e"],
      [num(9), num(4), num(5), num(6), num(7)]
    );

    seat(state, "b").hand.push(secondChance());
    seat(state, "c").hand.push(secondChance());
    stay(state, "a", random);
    const extra = secondChance();
    rig(state, [extra]);

    hit(state, "b", random);

    expect(snapshot(state).choice).toStrictEqual({
      cardId: extra.id,
      chooserId: "b",
      options: ["d", "e"],
    });
  });

  it("gives an extra Second Chance straight to the only player who can take it", () => {
    const cCard = num(5);
    const state = deal(["a", "b", "c"], [num(9), num(4), cCard]);
    seat(state, "a").hand.push(secondChance());
    seat(state, "b").hand.push(secondChance());
    const extra = secondChance();
    rig(state, [extra]);

    hit(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      choice: null,
      players: { c: { hand: [cCard.id, extra.id] } },
      turnId: "b",
    });
  });
});

describe("4. Flip Three", () => {
  it("A holds 9; forced [Second Chance, 9, 4]: saved, exactly three draws, A keeps 9 and 4", () => {
    const nine = num(9);
    const state = deal(["a", "b", "c"], [nine, num(4), num(5)]);
    const trigger = flipThree();
    const chance = secondChance();
    const duplicate = num(9);
    const four = num(4);
    const next = num(11);
    rig(state, [trigger, chance, duplicate, four, next]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      discard: [chance.id, duplicate.id, trigger.id],
      players: { a: { hand: [nine.id, four.id], status: "active" } },
      turnId: "b",
    });
  });

  it("A owns Second Chance and reveals another first: the gift resolves before draw two", () => {
    const [nine, cCard] = [num(9), num(5)];
    const state = deal(["a", "b", "c"], [nine, num(4), cCard]);
    const original = secondChance();
    seat(state, "a").hand.push(original);
    const extra = secondChance();
    const [two, three] = [num(2), num(3)];
    const next = num(11);
    rig(state, [flipThree(), extra, two, three, next]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(snapshot(state)).toMatchObject({
      choice: { cardId: extra.id, chooserId: "a", options: ["b", "c"] },
      deck: [next.id, three.id, two.id],
    });

    choose(state, "a", "c", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      players: {
        a: { hand: [nine.id, original.id, two.id, three.id] },
        c: { hand: [cCard.id, extra.id] },
      },
    });
  });

  it("discards the extra Second Chance when nobody qualifies and keeps drawing", () => {
    const nine = num(9);
    const state = deal(["a", "b", "c"], [nine, num(4), num(5)]);
    const original = secondChance();
    seat(state, "a").hand.push(original);
    seat(state, "b").hand.push(secondChance());
    seat(state, "c").hand.push(secondChance());
    const trigger = flipThree();
    const extra = secondChance();
    const [two, three] = [num(2), num(3)];
    rig(state, [trigger, extra, two, three]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(snapshot(state)).toMatchObject({
      choice: null,
      discard: [extra.id, trigger.id],
      players: { a: { hand: [nine.id, original.id, two.id, three.id] } },
      turnId: "b",
    });
  });

  it("A holds 9; forced [Freeze, 9, …]: busts on draw two, Freeze discarded unassigned, draw three stays", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    const trigger = flipThree();
    const held = freeze();
    const duplicate = num(9);
    const unflipped = num(6);
    rig(state, [trigger, held, duplicate, unflipped]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(seat(state, "a").bustCard).toBe(duplicate);
    expect(snapshot(state)).toMatchObject({
      choice: null,
      deck: [unflipped.id],
      discard: [trigger.id, held.id],
      players: { a: { status: "busted" } },
      turnId: "b",
    });
  });

  it("A has six Numbers; forced [Flip Three, seventh, …]: ends on draw two, nested card unassigned", () => {
    const state = deal(["a", "b", "c"], [num(1), num(10), num(11)]);
    seat(state, "a").hand.push(num(2), num(3), num(4), num(5), num(6));
    const trigger = flipThree();
    const nested = flipThree();
    const unflipped = num(8);
    rig(state, [trigger, nested, num(7), unflipped]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    expect(seat(state, "a").lastRound).toMatchObject({ streak: true });
    expect(snapshot(state)).toMatchObject({
      choice: null,
      deck: [unflipped.id],
      discard: [trigger.id, nested.id],
      phase: "roundOver",
      players: { a: { score: 28 + 15 }, b: { score: 10 }, c: { score: 11 } },
    });
  });

  it("A holds five Numbers; forced [+4, Second Chance, sixth]: three draws, six Numbers, no bonus", () => {
    const state = deal(["a", "b", "c"], [num(1), num(10), num(11)]);
    seat(state, "a").hand.push(num(2), num(3), num(4), num(5));
    const next = num(12);
    rig(state, [flipThree(), plus(4), secondChance(), num(6), next]);

    hit(state, "a", random);
    choose(state, "a", "a", random);

    const a = seat(state, "a");

    expect(countUniqueNumberCards(a.hand)).toBe(6);
    expect(calculateRoundScore(a.hand)).toMatchObject({
      streak: false,
      total: 21 + 4,
    });
    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      phase: "playing",
      players: { a: { status: "active" } },
      turnId: "b",
    });
  });

  it("A Hits → Flip Three on C → C assigns another to D: B moves next", () => {
    const state = deal(["a", "b", "c", "d"], [num(5), num(3), num(8), num(9)]);

    const nested = flipThree();
    rig(state, [flipThree(), num(1), nested, num(2), num(4), num(6), num(10)]);

    hit(state, "a", random);
    choose(state, "a", "c", random);

    expect(snapshot(state).choice).toMatchObject({
      cardId: nested.id,
      chooserId: "c",
    });

    choose(state, "c", "d", random);

    expect(seat(state, "d").hand).toHaveLength(4);
    expect(snapshot(state)).toMatchObject({ deck: [], turnId: "b" });
  });

  it("skips B when a chain effect froze B, without moving the anchor to C or D", () => {
    const state = deal(["a", "b", "c", "d"], [num(5), num(3), num(8), num(9)]);

    rig(state, [
      flipThree(),
      num(1),
      flipThree(),
      freeze(),
      num(4),
      num(6),
      num(10),
    ]);

    hit(state, "a", random);
    choose(state, "a", "c", random);
    choose(state, "c", "d", random);
    choose(state, "c", "b", random);

    expect(seat(state, "d").hand).toHaveLength(4);
    expect(state.turnAnchor).toBe(0);
    expect(snapshot(state)).toMatchObject({
      players: { b: { status: "frozen" } },
      turnId: "c",
    });
  });

  it("deferred [Freeze → B, Flip Three → B]: both assigned first, B freezes, the Flip Three draws nothing", () => {
    const state = deal(["a", "b", "c"], [num(5), num(3), num(8)]);
    const trigger = flipThree();
    const nested = flipThree();
    const next = num(11);
    rig(state, [trigger, num(1), freeze(), nested, next]);

    hit(state, "a", random);
    choose(state, "a", "c", random);
    choose(state, "c", "b", random);

    expect(snapshot(state)).toMatchObject({
      choice: {
        cardId: nested.id,
        chooserId: "c",
        options: ["a", "b", "c"],
      },
      players: { b: { status: "active" } },
    });

    choose(state, "c", "b", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      discard: [trigger.id, nested.id],
      players: { b: { status: "frozen" } },
      turnId: "c",
    });
  });

  it("deferred [Flip Three → B, Freeze → B]: B draws first, then Freeze banks the result", () => {
    const bThree = num(3);
    const state = deal(["a", "b", "c"], [num(5), bThree, num(8)]);
    const held = freeze();
    const flips = [num(2), num(4), num(6)];
    const next = num(11);
    rig(state, [flipThree(), num(1), flipThree(), held, ...flips, next]);

    hit(state, "a", random);
    choose(state, "a", "c", random);
    choose(state, "c", "b", random);
    choose(state, "c", "b", random);

    expect(snapshot(state)).toMatchObject({
      deck: [next.id],
      players: {
        b: { hand: [bThree.id, ...ids(flips), held.id], status: "frozen" },
      },
      turnId: "c",
    });
  });

  it("deferred [Flip Three → B, Flip Three → B]: B takes both runs without reassigning the second", () => {
    const state = deal(["a", "b", "c"], [num(5), num(3), num(8)]);
    const next = num(12);
    rig(state, [
      flipThree(),
      num(1),
      flipThree(),
      flipThree(),
      num(2),
      num(4),
      num(6),
      num(7),
      num(9),
      num(10),
      next,
    ]);

    hit(state, "a", random);
    choose(state, "a", "c", random);
    choose(state, "c", "b", random);
    choose(state, "c", "b", random);

    expect(seat(state, "b").hand).toHaveLength(7);
    expect(snapshot(state)).toMatchObject({ choice: null, deck: [next.id] });
  });

  it("queued [Flip Three → B, Freeze → C]; B assigns a new Flip Three to C: the earlier Freeze lands first", () => {
    const cCard = num(8);
    const state = deal(["a", "b", "c", "d"], [num(5), num(3), cCard, num(9)]);
    const trigger = flipThree();
    const queuedFlip = flipThree();
    const queuedFreeze = freeze();
    const late = flipThree();
    const next = num(12);
    rig(state, [
      trigger,
      num(1),
      queuedFlip,
      queuedFreeze,
      num(2),
      late,
      num(4),
      next,
    ]);

    hit(state, "a", random);
    choose(state, "a", "d", random);
    choose(state, "d", "b", random);
    choose(state, "d", "c", random);

    expect(snapshot(state).choice).toStrictEqual({
      cardId: late.id,
      chooserId: "b",
      options: ["a", "b", "c", "d"],
    });

    choose(state, "b", "c", random);

    expect(snapshot(state)).toMatchObject({
      choice: null,
      deck: [next.id],
      discard: [trigger.id, queuedFlip.id, late.id],
      players: { c: { hand: [cCard.id, queuedFreeze.id], status: "frozen" } },
      turnId: "b",
    });
  });

  it("a bust cancels effects aimed at the busted player but not unrelated ones", () => {
    const state = deal(["a", "b", "c", "d"], [num(5), num(3), num(8), num(9)]);
    const trigger = flipThree();
    const queuedFlip = flipThree();
    const queuedFreezeB = freeze();
    rig(state, [trigger, queuedFlip, queuedFreezeB, freeze(), num(3)]);

    hit(state, "a", random);
    choose(state, "a", "d", random);
    choose(state, "d", "b", random);
    choose(state, "d", "b", random);
    choose(state, "d", "c", random);

    expect(snapshot(state)).toMatchObject({
      discard: [trigger.id, queuedFlip.id, queuedFreezeB.id],
      players: { b: { status: "busted" }, c: { status: "frozen" } },
    });
  });
});

describe("5. scoring", () => {
  it("A completes a Flip 7 with 0–6, ×2 and +8 for 65; others bank theirs; busted earn zero", () => {
    const state = deal(["a", "b", "c", "d"], [num(0), num(10), num(5), num(7)]);

    seat(state, "a").hand.push(num(1), num(2), num(3), num(4), num(5), plus(8));
    rig(state, [double(), num(5), num(3), num(6)]);

    hit(state, "a", random);
    stay(state, "b", random);
    hit(state, "c", random);
    hit(state, "d", random);
    hit(state, "a", random);

    expect(seat(state, "d").lastRound?.streak).toBeFalsy();
    expect(snapshot(state)).toMatchObject({
      phase: "roundOver",
      turnId: null,
    });
    expect(scores(state)).toStrictEqual({ a: 65, b: 10, c: 0, d: 10 });
  });

  it("scores Score Modifier cards without Numbers: +2, +6 and ×2 make 8", () => {
    expect(calculateRoundScore([plus(2), plus(6), double()]).total).toBe(8);
    expect(calculateRoundScore([]).total).toBe(0);
    expect(calculateRoundScore([secondChance()]).total).toBe(0);
  });

  it("credits a banked score once, at settlement", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);

    stay(state, "a", random);

    expect(seat(state, "a").score).toBe(0);

    stay(state, "b", random);
    stay(state, "c", random);

    expect(scores(state)).toStrictEqual({ a: 9, b: 4, c: 5 });
  });

  it("doesn't end the round with one active player left", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    stay(state, "a", random);
    stay(state, "b", random);

    expect(snapshot(state)).toMatchObject({ phase: "playing", turnId: "c" });
  });
});

describe("5. card lifecycle", () => {
  it("keeps the draw pile between rounds, discards the table and rotates the dealer left", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    const [x, y, z, rest] = [num(1), num(2), num(3), num(6)];
    rig(state, [x, y, z, rest]);
    const table = state.players.flatMap((player) => player.hand);
    stay(state, "a", random);
    stay(state, "b", random);
    stay(state, "c", random);

    nextRound(state, "a", random);

    expect(state.dealerIndex).toBe(0);
    expect(snapshot(state)).toMatchObject({
      deck: [rest.id],
      discard: ids(table),
      players: {
        a: { hand: [z.id] },
        b: { hand: [x.id] },
        c: { hand: [y.id] },
      },
    });
  });

  it("reshuffles only the discard pile mid–Flip Three, keeping holders, held cards and the draw count", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    stay(state, "a", random);
    const aHand = ids(seat(state, "a").hand);
    const trigger = flipThree();
    const held = freeze();
    const old = [num(11), num(12), plus(6)];
    rig(state, [trigger, held]);
    state.discard = [...old];

    hit(state, "b", random);
    choose(state, "b", "c", random);

    const cNew = seat(state, "c").hand.slice(1);

    expect(cNew).toHaveLength(2);
    expect(sortedIds([...cNew, ...state.deck])).toStrictEqual(sortedIds(old));
    expect(snapshot(state)).toMatchObject({
      choice: { cardId: held.id, chooserId: "c", options: ["b", "c"] },
      discard: [trigger.id],
      players: { a: { hand: aHand } },
    });
    expect(state.log).toContainEqual(
      expect.objectContaining({
        text: "The discard pile was shuffled into a new deck.",
      })
    );
  });
});

describe("5. no cards left to draw", () => {
  it("ends the round on a Hit with both piles empty and scores everyone who hasn't busted", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    seat(state, "b").hand.push(plus(4));
    rig(state, []);
    state.discard = [];

    hit(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      phase: "roundOver",
      turnId: null,
    });
    expect(scores(state)).toStrictEqual({ a: 9, b: 8, c: 5 });
    expect(state.log).toContainEqual(
      expect.objectContaining({
        text: "No cards are left to draw, so the round ends.",
      })
    );
  });

  it("ends the round mid–Flip Three and discards its held cards", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    const trigger = flipThree();
    const held = freeze();
    rig(state, [trigger, num(1), held]);
    state.discard = [];

    hit(state, "a", random);
    choose(state, "a", "b", random);

    expect(sortedIds(state.discard)).toStrictEqual(sortedIds([trigger, held]));
    expect(snapshot(state)).toMatchObject({
      choice: null,
      phase: "roundOver",
      players: { b: { score: 5 } },
    });
  });

  it("ends the round during the opening deal and recycles the table next round", () => {
    const state = betweenRounds(["a", "b", "c"]);
    const opener = num(9);
    rig(state, [opener]);

    nextRound(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      phase: "roundOver",
      players: { a: { score: 9 }, b: { hand: [] } },
    });

    nextRound(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      phase: "roundOver",
      players: { b: { hand: [opener.id] } },
    });
  });
});

const settleWithStays = (state: GameState) => {
  for (const id of ["a", "b", "c"]) {
    stay(state, id, random);
  }
};

describe("5. winner", () => {
  it("[220, 230, 198]: B wins", () => {
    const state = deal(["a", "b", "c"], [num(0), num(0), num(0)]);
    seat(state, "a").score = 220;
    seat(state, "b").score = 230;
    seat(state, "c").score = 198;

    settleWithStays(state);

    expect(state.phase).toBe("gameOver");
    expect(state.winnerIds).toStrictEqual(["b"]);
  });

  it("[200, 200, 198]: everyone plays on, and C wins the tie-break round at [207, 209, 215]", () => {
    const state = deal(["a", "b", "c"], [num(0), num(0), num(0)]);
    seat(state, "a").score = 200;
    seat(state, "b").score = 200;
    seat(state, "c").score = 198;

    settleWithStays(state);

    expect(snapshot(state)).toMatchObject({ phase: "roundOver" });

    rig(state, [num(9), num(12), num(7), num(5)]);
    nextRound(state, "a", random);

    expect(snapshot(state)).toMatchObject({
      players: {
        a: { status: "active" },
        b: { status: "active" },
        c: { status: "active" },
      },
    });

    stay(state, "b", random);
    hit(state, "c", random);
    stay(state, "a", random);
    stay(state, "c", random);

    expect(scores(state)).toStrictEqual({ a: 207, b: 209, c: 215 });
    expect(state.winnerIds).toStrictEqual(["c"]);
  });

  it("doesn't end the game the moment someone banks past 200", () => {
    const state = deal(["a", "b", "c"], [num(12), num(1), num(2)]);
    seat(state, "a").score = 195;
    stay(state, "a", random);

    expect(state.phase).toBe("playing");
  });
});

const cardsAtTable = (state: GameState) => {
  const all: Card[] = [...state.deck, ...state.discard];

  for (const player of state.players) {
    all.push(...player.hand, ...(player.bustCard ? [player.bustCard] : []));
  }

  for (const run of state.flipRuns) {
    all.push(...run.deferred, run.card);
  }

  all.push(...state.actionQueue.map((queued) => queued.card));

  if (state.assignment) {
    all.push(
      ...state.assignment.cards,
      ...state.assignment.assigned.map((queued) => queued.card)
    );
  } else if (state.choice) {
    all.push(state.choice.card);
  }

  return sortedIds(all);
};

const MODULUS = 2_147_483_647;

const seeded = (seed: number) => {
  let value = seed;

  return () => {
    value = (value * 48_271) % MODULUS;

    return (value - 1) / (MODULUS - 1);
  };
};

const isSettled = (state: GameState) =>
  state.phase === "roundOver" || state.phase === "gameOver";

const playOneMove = (state: GameState, roll: () => number) => {
  const actor = waitingOn(state)?.playerId ?? "";
  const moves = availableMoves(state, actor);

  if (moves.choice) {
    const target =
      moves.choice.targets[Math.floor(roll() * moves.choice.targets.length)];

    choose(state, actor, target ?? "", roll);
  } else if (moves.turn?.canStay === true && roll() < 0.35) {
    stay(state, actor, roll);
  } else {
    hit(state, actor, roll);
  }
};

const checkSettlement = (
  state: GameState,
  before: Map<string, number>,
  problems: string[]
) => {
  for (const player of state.players) {
    const gained = player.score - (before.get(player.id) ?? 0);

    const expected =
      player.status === "busted" ? 0 : (player.lastRound?.total ?? 0);

    if (gained !== expected) {
      problems.push(`${player.id} gained ${gained}, expected ${expected}`);
    }
  }
};

const checkTable = (
  state: GameState,
  fullDeck: number[],
  problems: string[]
) => {
  if (cardsAtTable(state).join(",") !== fullDeck.join(",")) {
    problems.push(`round ${state.round}: cards went missing or doubled`);
  }

  if (state.phase !== "playing") {
    return;
  }

  if (waitingOn(state) === null) {
    problems.push(`round ${state.round}: nobody owes a move`);
  }

  if (state.choice !== null && state.turnId !== null) {
    problems.push(`round ${state.round}: a choice and a turn are both open`);
  }
};

const simulateGame = (seed: number, fullDeck: number[]) => {
  const roll = seeded(seed);
  const state = createGame();
  const problems: string[] = [];
  let rounds = 0;

  for (let index = 0; index < 2 + (seed % 15); index += 1) {
    addPlayer(state, `p${index}`, `p${index}`, 1);
  }

  startGame(state, "p0", roll);

  for (let step = 0; step < 4000 && state.phase !== "gameOver"; step += 1) {
    checkTable(state, fullDeck, problems);

    if (state.phase === "roundOver") {
      nextRound(state, "p0", roll);
    } else {
      const before = new Map(state.players.map(({ id, score }) => [id, score]));
      playOneMove(state, roll);

      if (isSettled(state)) {
        rounds += 1;
        checkSettlement(state, before, problems);
      }
    }
  }

  return { finished: state.phase === "gameOver", problems, rounds };
};

describe("engine invariants", () => {
  it("keeps one outstanding move, every card, and one settlement per round over many games", () => {
    const fullDeck = sortedIds(buildDeck());

    const results = Array.from({ length: 120 }, (_, index) =>
      simulateGame(index + 1, fullDeck)
    );

    expect(results.flatMap(({ problems }) => problems)).toStrictEqual([]);
    expect(results.every(({ finished }) => finished)).toBeTruthy();
    expect(
      results.reduce((total, { rounds }) => total + rounds, 0)
    ).toBeGreaterThan(500);
  });

  it("restores the exact decision and its targets from a saved room without redrawing", () => {
    const state = deal(["a", "b", "c"], [num(9), num(4), num(5)]);
    seat(state, "a").hand.push(secondChance());
    rig(state, [flipThree(), secondChance(), num(2), num(3)]);
    hit(state, "a", random);
    choose(state, "a", "a", random);

    const saved = structuredClone(state);

    expect(toRoomView("ABCDE", saved)).toStrictEqual(
      toRoomView("ABCDE", state)
    );
    expect(snapshot(saved)).toMatchObject({
      choice: { chooserId: "a", options: ["b", "c"] },
      deck: ids(state.deck),
    });

    choose(saved, "a", "b", random);
    choose(state, "a", "b", random);

    expect(snapshot(saved)).toStrictEqual(snapshot(state));
  });
});
