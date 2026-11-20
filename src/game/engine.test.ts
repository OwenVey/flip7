import { describe, expect, it } from "vitest";

import {
  ADDITIVE_MODIFIER_KIND,
  buildDeck,
  calculateRoundScore,
} from "./cards";
import type { Card } from "./cards";
import {
  addPlayer,
  blockingPlayerId,
  choose,
  createGame,
  GameError,
  hit,
  nextRound,
  playForAbsent,
  removePlayer,
  startGame,
  stay,
  TARGET_SCORE,
} from "./engine";
import type { GameState } from "./engine";
import { parseServerMessage, toRoomView } from "./protocol";

const random = () => 0.5;

let nextId = 1000;

const id = () => {
  nextId += 1;

  return nextId;
};

const num = (value: number) =>
  ({ id: id(), kind: "number", value }) satisfies Card;

const additiveModifier = (value: number) =>
  ({ id: id(), kind: ADDITIVE_MODIFIER_KIND, value }) satisfies Card;

const multiplierCard = () => ({ id: id(), kind: "double" }) satisfies Card;
const freeze = () => ({ id: id(), kind: "freeze" }) satisfies Card;
const flipThree = () => ({ id: id(), kind: "flipThree" }) satisfies Card;
const secondChance = () => ({ id: id(), kind: "secondChance" }) satisfies Card;

const player = (state: GameState, playerId: string) => {
  const found = state.players.find((candidate) => candidate.id === playerId);

  if (found === undefined) {
    throw new Error(`No player ${playerId}`);
  }

  return found;
};

const setup = (names: string[], draws: Card[]) => {
  const state = createGame();

  for (const name of names) {
    addPlayer(state, name, name);
  }

  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = names.length - 2;
  state.deck = [...draws].toReversed();
  state.discard = [];
  nextRound(state, "a", random);

  return state;
};

const rig = (state: GameState, draws: Card[]) => {
  state.deck = [...draws].toReversed();
};

describe("deck and scoring", () => {
  it("has 94 cards: 79 Number cards, 6 Score Modifier cards and 9 Action cards", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(94);
    expect(deck.filter((card) => card.kind === "number")).toHaveLength(79);
    expect(
      deck.filter((card) => card.kind === "number" && card.value === 12)
    ).toHaveLength(12);
    expect(new Set(deck.map((card) => card.id)).size).toBe(94);
  });

  it("applies the multiplier before adding modifier points and the Flip 7 bonus", () => {
    const hand = [1, 2, 3, 4, 5, 6, 7].map(num);
    expect(
      calculateRoundScore([...hand, multiplierCard(), additiveModifier(4)])
        .total
    ).toBe(28 * 2 + 4 + 15);
    expect(calculateRoundScore([num(5), additiveModifier(10)]).total).toBe(15);
  });
});

describe("a round", () => {
  it("deals one card each, starting left of the dealer", () => {
    const state = setup(["a", "b", "c"], [num(1), num(2), num(3)]);

    expect(
      state.players.map((p) =>
        p.hand.map((c) => c.kind === "number" && c.value)
      )
    ).toStrictEqual([[1], [2], [3]]);
    expect(state.turnId).toBe("a");
  });

  it("busts on a duplicate number and scores zero", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [num(5)]);
    hit(state, "a", random);
    expect(player(state, "a").status).toBe("busted");
    expect(state.turnId).toBe("b");
    stay(state, "b", random);
    expect(state.phase).toBe("roundOver");
    expect(player(state, "a").score).toBe(0);
    expect(player(state, "b").score).toBe(3);
  });

  it("spends a Second Chance to survive a duplicate", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [secondChance(), num(5)]);
    hit(state, "a", random);
    stay(state, "b", random);
    expect(state.turnId).toBe("a");
    hit(state, "a", random);
    const a = player(state, "a");
    expect(a.status).toBe("active");
    expect(a.hand.map((card) => card.kind)).toStrictEqual(["number"]);
  });

  it("rejects moves out of turn", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    expect(() => {
      hit(state, "b", random);
    }).toThrow(GameError);
  });

  it("asks who to freeze, and the frozen player banks their points", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [freeze()]);
    hit(state, "a", random);
    expect(state.choice?.chooserId).toBe("a");
    expect(state.choice?.options).toStrictEqual(["a", "b", "c"]);
    expect(() => {
      hit(state, "b", random);
    }).toThrow(GameError);
    choose(state, "a", "c", random);
    expect(player(state, "c").status).toBe("frozen");
    expect(state.turnId).toBe("b");
  });

  it("holds actions drawn during Flip Three until all three are flipped", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(1), freeze(), num(2)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(
      player(state, "b").hand.filter((c) => c.kind === "number")
    ).toHaveLength(3);
    expect(state.choice?.chooserId).toBe("b");
    expect(state.choice?.card.kind).toBe("freeze");
    choose(state, "b", "a", random);
    expect(player(state, "a").status).toBe("frozen");
  });

  it("ends a Flip Three early when the target busts", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(3), num(9)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(player(state, "b").status).toBe("busted");
    expect(state.deck).toHaveLength(1);
  });

  it("ends the round immediately when a player earns the Flip 7 bonus", () => {
    const state = setup(["a", "b"], [num(1), num(12)]);
    player(state, "b").hand.push(additiveModifier(4));
    player(state, "a").hand.push(num(2), num(3), num(4), num(5), num(6));
    rig(state, [num(7)]);
    hit(state, "a", random);
    expect(state.phase).toBe("roundOver");
    expect(player(state, "a").score).toBe(28 + 15);
    expect(player(state, "b").score).toBe(12 + 4);

    const message = { room: toRoomView("ABCDE", state), type: "state" };
    const raw = JSON.stringify(message);
    expect(raw).toContain('"kind":"bonus"');
    expect(parseServerMessage(raw)).toMatchObject({
      room: {
        players: [
          { lastRound: { streak: true }, status: "streak" },
          { lastRound: { bonus: 4 } },
        ],
      },
      type: "state",
    });
  });

  it("gives a spare Second Chance to another player", () => {
    const state = setup(["a", "b", "c"], [secondChance(), num(3), num(4)]);

    rig(state, [secondChance()]);
    hit(state, "a", random);
    expect(state.choice?.options).toStrictEqual(["b", "c"]);
    choose(state, "a", "c", random);
    expect(
      player(state, "c").hand.some((c) => c.kind === "secondChance")
    ).toBeTruthy();
  });
});

describe("rules from the FAQ", () => {
  it("applies the multiplier only to Number card points", () => {
    const hand = [0, 1, 2, 3, 4, 5, 6].map(num);
    expect(
      calculateRoundScore([...hand, multiplierCard(), additiveModifier(10)])
        .total
    ).toBe(21 * 2 + 10 + 15);
    expect(
      calculateRoundScore([multiplierCard(), additiveModifier(6)]).total
    ).toBe(6);
  });

  it("passes the turn after a Second Chance saves a bust", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    player(state, "a").hand.push(secondChance());
    rig(state, [num(5)]);
    hit(state, "a", random);
    expect(player(state, "a").status).toBe("active");
    expect(state.turnId).toBe("b");
  });

  it("doesn't let a Second Chance stop a Freeze", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    player(state, "b").hand.push(secondChance());
    rig(state, [freeze()]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(player(state, "b").status).toBe("frozen");
  });

  it("makes the last active player play an action on themselves", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    rig(state, [freeze()]);
    hit(state, "b", random);
    expect(state.choice).toBeNull();
    expect(player(state, "b").status).toBe("frozen");
  });

  it("won't let a player with no cards stay", () => {
    const state = setup(["a", "b", "c"], [freeze(), num(3), num(4)]);

    choose(state, "a", "b", random);
    expect(player(state, "a").hand).toHaveLength(0);
    expect(state.turnId).toBe("a");
    expect(() => {
      stay(state, "a", random);
    }).toThrow(GameError);
  });

  it("hits for an offline player who has no cards", () => {
    const state = setup(["a", "b", "c"], [freeze(), num(3), num(4)]);

    choose(state, "a", "b", random);
    rig(state, [num(9)]);
    player(state, "a").connected = false;
    expect(playForAbsent(state, random)).toBeTruthy();
    expect(player(state, "a").hand).toHaveLength(1);
    expect(player(state, "a").status).toBe("active");
  });

  it("lets a Flip Three target pass an extra action to another player", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [flipThree(), num(1), flipThree(), num(2)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(state.choice?.chooserId).toBe("b");
    expect(state.choice?.options).toStrictEqual(["a", "b", "c"]);
  });

  it("still plays deferred actions after freezing yourself with one", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [flipThree(), freeze(), flipThree(), num(2)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    choose(state, "b", "b", random);
    expect(player(state, "b").status).toBe("frozen");
    expect(state.choice?.chooserId).toBe("b");
    expect(state.choice?.card.kind).toBe("flipThree");
    expect(state.choice?.options).toStrictEqual(["a", "c"]);
  });

  it("drops deferred actions when the Flip Three target busts", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [flipThree(), freeze(), num(3)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(player(state, "b").status).toBe("busted");
    expect(state.choice).toBeNull();
    expect(state.discard.some((card) => card.kind === "freeze")).toBeTruthy();
  });

  it("sets aside unresolved Action cards when a Flip 7 ends the round", () => {
    const state = setup(["a", "b"], [num(1), num(12)]);
    player(state, "b").hand.push(num(2), num(3), num(4), num(5), num(6));
    rig(state, [flipThree(), freeze(), num(7)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    expect(state.phase).toBe("roundOver");
    expect(state.discard.some((card) => card.kind === "freeze")).toBeTruthy();
  });
});

describe("winning and leaving", () => {
  it("ends the game when one player reaches the target alone", () => {
    const state = setup(["a", "b"], [num(10), num(3)]);
    player(state, "a").score = TARGET_SCORE - 5;
    stay(state, "a", random);
    stay(state, "b", random);
    expect(state.phase).toBe("gameOver");
    expect(state.winnerIds).toStrictEqual(["a"]);
  });

  it("keeps playing when the leaders are tied", () => {
    const state = setup(["a", "b"], [num(10), num(10)]);
    player(state, "a").score = TARGET_SCORE;
    player(state, "b").score = TARGET_SCORE;
    stay(state, "a", random);
    stay(state, "b", random);
    expect(state.phase).toBe("roundOver");
  });

  it("passes the turn and the host on when a player is removed", () => {
    const state = setup(["a", "b", "c"], [num(1), num(2), num(3)]);

    removePlayer(state, "a", random);
    expect(state.hostId).toBe("b");
    expect(state.turnId).toBe("b");
  });

  it("rejects a name someone in the room already has", () => {
    const state = createGame();
    addPlayer(state, "a", "Ana");
    expect(() => {
      addPlayer(state, "b", "ana");
    }).toThrow(GameError);
  });

  it("returns to the lobby when too few players remain", () => {
    const state = setup(["a", "b"], [num(1), num(2)]);
    removePlayer(state, "b", random);
    expect(state.phase).toBe("lobby");
    expect(state.players).toHaveLength(1);
  });

  it("drops a pending choice that belongs to a removed player", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [freeze()]);
    hit(state, "a", random);
    removePlayer(state, "a", random);
    expect(state.choice).toBeNull();
    expect(state.turnId).toBe("b");
  });
});

describe("an offline player", () => {
  it("stays when the game is waiting on their turn", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    expect(blockingPlayerId(state)).toBe("a");
    expect(playForAbsent(state, random)).toBeFalsy();

    player(state, "a").connected = false;
    expect(playForAbsent(state, random)).toBeTruthy();
    expect(state.turnId).toBe("b");
    expect(state.log.at(-1)?.text).toBe(
      "a is offline, so they stayed and banked 5 points."
    );
  });

  it("gives their action card to someone else", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [freeze()]);
    hit(state, "a", random);
    expect(blockingPlayerId(state)).toBe("a");

    player(state, "a").connected = false;
    expect(playForAbsent(state, random)).toBeTruthy();
    expect(state.choice).toBeNull();
    expect(player(state, "a").status).toBe("active");
    expect(
      state.players.filter((candidate) => candidate.status === "frozen")
    ).toHaveLength(1);
  });

  it("isn't waited on outside a round", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    stay(state, "b", random);
    expect(state.phase).toBe("roundOver");
    expect(blockingPlayerId(state)).toBeNull();
  });
});
