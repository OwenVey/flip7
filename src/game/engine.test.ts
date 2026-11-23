import { describe, expect, it } from "vitest";

import {
  ADDITIVE_MODIFIER_KIND,
  buildDeck,
  calculateRoundScore,
} from "./cards";
import type { Card } from "./cards";
import {
  addPlayer,
  backToLobby,
  CHAT_MAX_LENGTH,
  chat,
  choose,
  createGame,
  GameError,
  hit,
  kick,
  leave,
  nextRound,
  playFor,
  playForAbsent,
  removePlayer,
  startGame,
  stay,
  TARGET_SCORE,
} from "./engine";
import type { GameState } from "./engine";
import { waitingOn } from "./moves";
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

const finishedRound = (names: string[]) => {
  const state = createGame();

  for (const name of names) {
    addPlayer(state, name, name, 1);
  }

  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = names.length - 2;
  state.discard = [];

  return state;
};

const setup = (names: string[], draws: Card[]) => {
  const state = finishedRound(names);
  state.deck = [...draws].toReversed();
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

  it("records each flip of a Flip Three and what became of it", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(1), freeze(), num(3)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);

    expect(
      state.draws?.slice(-4).map(({ flip, outcome, playerId }) => ({
        flip: flip?.index ?? null,
        outcome,
        playerId,
      }))
    ).toStrictEqual([
      { flip: null, outcome: "action", playerId: "a" },
      { flip: 1, outcome: "kept", playerId: "b" },
      { flip: 2, outcome: "held", playerId: "b" },
      { flip: 3, outcome: "bust", playerId: "b" },
    ]);
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

  it("has the target assign every set-aside card before any takes effect", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [flipThree(), freeze(), flipThree(), num(2)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    choose(state, "b", "b", random);
    expect(player(state, "b").status).toBe("active");
    expect(state.choice).toMatchObject({
      card: { kind: "flipThree" },
      chooserId: "b",
      options: ["a", "b", "c"],
    });
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

  it("ends the game at the winning score the host picked", () => {
    const state = setup(["a", "b"], [num(10), num(3)]);
    state.settings = { botSpeed: "normal", locked: false, targetScore: 100 };
    player(state, "a").score = 95;
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
    addPlayer(state, "a", "Ana", 1);
    expect(() => {
      addPlayer(state, "b", "ana", 1);
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

describe("evicting a player", () => {
  it("lets the host kick another player and says so", () => {
    const state = setup(["a", "b", "c"], [num(1), num(2), num(3)]);

    kick(state, "a", "b", random);

    expect(state.players.map((candidate) => candidate.id)).toStrictEqual([
      "a",
      "c",
    ]);
    expect(state.log.at(-1)?.text).toBe("b was removed by the host.");
  });

  it("only lets the host kick, and not themselves", () => {
    const state = setup(["a", "b"], [num(1), num(2)]);

    expect(() => {
      kick(state, "b", "a", random);
    }).toThrow("Only the host can remove players.");
    expect(() => {
      kick(state, "a", "a", random);
    }).toThrow("Use Leave to leave the room.");
    expect(state.players).toHaveLength(2);
  });

  it("rejects kicking someone who already left", () => {
    const state = setup(["a", "b"], [num(1), num(2)]);

    expect(() => {
      kick(state, "a", "z", random);
    }).toThrow("That player already left.");
  });

  it("lets a player leave and says so", () => {
    const state = setup(["a", "b", "c"], [num(1), num(2), num(3)]);

    leave(state, "a", random);

    expect(state.hostId).toBe("b");
    expect(state.log.at(-1)?.text).toBe("a left.");
  });
});

describe("an offline player", () => {
  it("stays when the game is waiting on their turn", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    expect(waitingOn(state)?.playerId ?? null).toBe("a");
    expect(playForAbsent(state, random)).toBeFalsy();

    player(state, "a").connected = false;
    expect(playForAbsent(state, random)).toBeTruthy();
    expect(state.turnId).toBe("b");
    expect(state.log.at(-1)?.text).toBe(
      "a is offline, so the game stayed for them and banked 5 points."
    );
  });

  it("gives their action card to someone else", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);

    rig(state, [freeze()]);
    hit(state, "a", random);
    expect(waitingOn(state)?.playerId ?? null).toBe("a");

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
    expect(waitingOn(state)?.playerId ?? null).toBeNull();
  });
});

describe("the host moving for an offline player", () => {
  it("stays for them", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    player(state, "b").connected = false;

    playFor(state, "a", "b", { type: "stay" }, random);

    expect(player(state, "b").status).toBe("stayed");
    expect(
      state.log.some(
        (entry) =>
          entry.text === "a stayed for b, who is offline, and banked 3 points."
      )
    ).toBeTruthy();
  });

  it("hits for them", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);
    stay(state, "a", random);
    player(state, "b").connected = false;
    rig(state, [num(7)]);

    playFor(state, "a", "b", { type: "hit" }, random);

    expect(player(state, "b").hand).toHaveLength(2);
    expect(state.turnId).toBe("c");
    expect(state.log.at(-1)?.text).toBe("a hit for b, who is offline.");
  });

  it("chooses who gets their action card", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);
    stay(state, "a", random);
    rig(state, [freeze()]);
    hit(state, "b", random);
    player(state, "b").connected = false;

    playFor(state, "a", "b", { targetId: "c", type: "choose" }, random);

    expect(state.choice).toBeNull();
    expect(player(state, "c").status).toBe("frozen");
  });

  it("is only for the host, and only while the game waits on that offline player", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);
    stay(state, "a", random);

    expect(() => {
      playFor(state, "a", "b", { type: "stay" }, random);
    }).toThrow("b is back online, so it's their move.");

    player(state, "b").connected = false;
    expect(() => {
      playFor(state, "c", "b", { type: "stay" }, random);
    }).toThrow("Only the host can do that.");

    player(state, "c").connected = false;
    expect(() => {
      playFor(state, "a", "c", { type: "hit" }, random);
    }).toThrow("The game isn't waiting on c.");
    expect(state.turnId).toBe("b");
  });
});

describe("the game log", () => {
  it("says how many points a Freeze banks, even none", () => {
    const state = setup(["a", "b", "c"], [freeze(), num(3), num(4)]);

    choose(state, "a", "b", random);

    expect(
      state.log.some(
        (entry) => entry.text === "a played Freeze on b, who banked 0 points."
      )
    ).toBeTruthy();
  });

  it("numbers each game and files lobby entries under round 0", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    expect(state.log.at(-1)?.game).toBe(1);

    state.phase = "gameOver";
    backToLobby(state, "a");
    addPlayer(state, "c", "c", 1);
    expect(state.log.at(-1)).toMatchObject({ game: 1, round: 0 });

    startGame(state, "a", random);
    expect(state.log.at(-1)).toMatchObject({ game: 2, round: 1 });
  });
});

describe("playing again", () => {
  it("starts a fresh game straight from game over", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    stay(state, "b", random);
    state.phase = "gameOver";
    state.winnerIds = ["a"];

    player(state, "a").score = 250;
    player(state, "b").score = 210;

    startGame(state, "a", random);

    expect(state.phase).toBe("playing");
    expect(state.round).toBe(1);
    expect(state.winnerIds).toStrictEqual([]);
    expect(state.players.map(({ score }) => score)).toStrictEqual([0, 0]);
    expect(state.log.at(-1)?.game).toBe(2);
  });
});

describe(chat, () => {
  it("adds a player's message to the log with their name and avatar", () => {
    const state = createGame();
    addPlayer(state, "a", "Ana", 9);

    chat(state, "a", "  good   luck\n everyone ");

    expect(state.log.at(-1)).toMatchObject({
      from: { avatar: 9, id: "a", name: "Ana" },
      round: 0,
      text: "good luck everyone",
    });
  });

  it("rejects empty messages and trims long ones", () => {
    const state = createGame();
    addPlayer(state, "a", "Ana", 1);

    expect(() => {
      chat(state, "a", "   ");
    }).toThrow(GameError);

    chat(state, "a", "x".repeat(CHAT_MAX_LENGTH + 50));
    expect(state.log.at(-1)?.text).toHaveLength(CHAT_MAX_LENGTH);
  });

  it("only accepts messages from players in the room", () => {
    const state = createGame();

    expect(() => {
      chat(state, "ghost", "hi");
    }).toThrow(GameError);
  });
});

const ids = (cards: readonly Card[]) => cards.map((card) => card.id);

const table = (state: GameState, discardMark: number) => ({
  deck: ids(state.deck),
  discarded: ids(state.discard.slice(discardMark)),
  phase: state.phase,
  players: Object.fromEntries(
    state.players.map((seat) => [
      seat.id,
      {
        hand: ids(seat.hand),
        score: seat.score,
        status: seat.status,
      },
    ])
  ),
  turnId: state.turnId,
});

describe("Flip Three", () => {
  it("busts on an uncanceled duplicate, discards the held Freeze and leaves the third card", () => {
    const bThree = num(3);
    const state = setup(["a", "b"], [num(5), bThree]);
    const trigger = flipThree();
    const held = freeze();
    const duplicate = num(3);
    const unflipped = num(9);
    rig(state, [trigger, held, duplicate, unflipped]);
    const mark = state.discard.length;

    hit(state, "a", random);
    choose(state, "a", "b", random);

    expect(player(state, "b").bustCard).toBe(duplicate);
    expect(table(state, mark)).toMatchObject({
      deck: [unflipped.id],
      discarded: [trigger.id, held.id],
      players: {
        b: { hand: [bThree.id], status: "busted" },
      },
      turnId: "a",
    });

    stay(state, "a", random);

    expect(table(state, mark)).toMatchObject({
      phase: "roundOver",
      players: { a: { score: 5 }, b: { score: 0 } },
    });
  });

  it("cancels a duplicate with a Second Chance drawn earlier in the run and counts the modifier as flip three", () => {
    const bThree = num(3);
    const state = setup(["a", "b"], [num(5), bThree]);
    const trigger = flipThree();
    const chance = secondChance();
    const duplicate = num(3);
    const modifier = additiveModifier(4);
    const untouched = num(9);
    rig(state, [trigger, chance, duplicate, modifier, untouched]);
    const mark = state.discard.length;

    hit(state, "a", random);
    choose(state, "a", "b", random);

    expect(table(state, mark)).toMatchObject({
      deck: [untouched.id],
      discarded: [chance.id, duplicate.id, trigger.id],
      players: {
        b: {
          hand: [bThree.id, modifier.id],
          status: "active",
        },
      },
      turnId: "b",
    });
  });

  it("ends the round on a seventh unique Number, awards the bonus and discards the nested Flip Three", () => {
    const state = setup(["a", "b"], [num(5), num(1)]);
    player(state, "b").hand.push(num(2), num(3), num(4), num(5), num(6));
    const trigger = flipThree();
    const nested = flipThree();
    const unflipped = num(9);
    rig(state, [trigger, nested, num(7), unflipped]);
    const mark = state.discard.length;

    hit(state, "a", random);
    choose(state, "a", "b", random);

    expect(player(state, "b").lastRound?.streak).toBeTruthy();
    expect(table(state, mark)).toMatchObject({
      deck: [unflipped.id],
      discarded: [trigger.id, nested.id],
      phase: "roundOver",
      players: { a: { score: 5 }, b: { score: 28 + 15, status: "streak" } },
      turnId: null,
    });
  });

  it("collects both assignments first, so a Flip Three assigned after a Freeze is discarded", () => {
    const cEight = num(8);
    const state = setup(["a", "b", "c"], [num(5), num(3), cEight]);
    const trigger = flipThree();
    const held = freeze();
    const nested = flipThree();
    const untouched = num(9);
    rig(state, [trigger, num(1), held, nested, untouched]);
    const mark = state.discard.length;

    hit(state, "a", random);
    choose(state, "a", "b", random);
    choose(state, "b", "c", random);

    expect(table(state, mark).players.c?.status).toBe("active");
    expect(state.choice).toMatchObject({ card: nested, chooserId: "b" });

    choose(state, "b", "c", random);

    expect(table(state, mark)).toMatchObject({
      deck: [untouched.id],
      discarded: [trigger.id, nested.id],
      players: {
        b: { status: "active" },
        c: { hand: [cEight.id, held.id], status: "frozen" },
      },
      turnId: "b",
    });
  });

  it("runs a chain across players and resumes left of the original drawer", () => {
    const cEight = num(8);
    const dNine = num(9);
    const state = setup(["a", "b", "c", "d"], [num(5), num(3), cEight, dNine]);
    stay(state, "a", random);
    const trigger = flipThree();
    const nested = flipThree();
    const [one, two, four, six, ten] = [1, 2, 4, 6, 10].map(num);
    const untouched = num(11);
    rig(state, [trigger, one, nested, two, four, six, ten, untouched]);
    const mark = state.discard.length;

    hit(state, "b", random);
    choose(state, "b", "c", random);
    choose(state, "c", "d", random);

    expect(table(state, mark)).toStrictEqual({
      deck: [untouched.id],
      discarded: [trigger.id, nested.id],
      phase: "playing",
      players: {
        a: {
          hand: [expect.any(Number)],
          score: 0,
          status: "stayed",
        },
        b: {
          hand: [expect.any(Number)],
          score: 0,
          status: "active",
        },
        c: {
          hand: [cEight.id, one?.id, two?.id],
          score: 0,
          status: "active",
        },
        d: {
          hand: [dNine.id, four?.id, six?.id, ten?.id],
          score: 0,
          status: "active",
        },
      },
      turnId: "c",
    });
  });
});

const pendingAssignment = () => {
  const state = setup(["a", "b", "c", "d"], [num(5), num(3), num(8), num(4)]);
  const heldFreeze = freeze();
  const heldFlipThree = flipThree();
  rig(state, [flipThree(), num(1), heldFreeze, heldFlipThree]);

  hit(state, "a", random);
  choose(state, "a", "b", random);
  choose(state, "b", "c", random);

  return { heldFlipThree, heldFreeze, state };
};

describe("held action cards through eviction", () => {
  it("discards both assigned and unassigned cards when the chooser leaves", () => {
    const { heldFlipThree, heldFreeze, state } = pendingAssignment();
    const before = toRoomView("ABCDE", state);
    const mark = state.discard.length;

    leave(state, "b", random);

    expect(before).toMatchObject({
      choice: { card: heldFlipThree, chooserId: "b" },
      held: [{ card: heldFreeze, ownerId: "c" }],
    });
    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: null,
      held: [],
      phase: "playing",
    });
    expect(state.discard.slice(mark)).toContainEqual(heldFreeze);
    expect(state.discard.slice(mark)).toContainEqual(heldFlipThree);
    expect(player(state, "c").status).toBe("active");
  });

  it("retains a target's held card until the assignment reaches its discard slot", () => {
    const { heldFlipThree, heldFreeze, state } = pendingAssignment();
    const spareDraws = [num(2), num(6), num(7)];
    rig(state, spareDraws);

    leave(state, "c", random);

    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: { card: heldFlipThree, chooserId: "b", options: ["a", "b", "d"] },
      held: [{ card: heldFreeze, ownerId: "c" }],
    });
    expect(state.discard).not.toContainEqual(heldFreeze);

    choose(state, "b", "a", random);

    expect(state.discard).toContainEqual(heldFreeze);
    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: null,
      held: [],
    });
    expect(state.log).toContainEqual(
      expect.objectContaining({
        text: "Freeze for a player who left was discarded, since they're out of the round.",
      })
    );
  });

  it("discards a queued card as soon as its target is kicked during resolution", () => {
    const state = setup(["a", "b", "c", "d"], [num(5), num(3), num(8), num(4)]);
    const queuedFreeze = freeze();
    const nextChoice = freeze();
    rig(state, [
      flipThree(),
      num(1),
      flipThree(),
      queuedFreeze,
      num(2),
      num(6),
      nextChoice,
    ]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    choose(state, "b", "d", random);
    choose(state, "b", "c", random);

    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: { card: nextChoice, chooserId: "d" },
      held: [{ card: queuedFreeze, ownerId: "c" }],
    });

    kick(state, "a", "c", random);

    expect(state.discard).toContainEqual(queuedFreeze);
    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: { card: nextChoice, chooserId: "d", options: ["a", "b", "d"] },
      held: [],
    });
  });
});

describe("held action cards in saved Rooms", () => {
  it("opens a choice for the owner of an old queued card without a target", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);
    const card = freeze();
    delete state.assignment;
    state.actionQueue = [{ card, ownerId: "b" }];

    expect(toRoomView("ABCDE", state).held).toStrictEqual([
      { card, ownerId: "b" },
    ]);

    stay(state, "a", random);

    expect(toRoomView("ABCDE", state)).toMatchObject({
      choice: { card, chooserId: "b", options: ["b", "c"] },
      held: [],
    });

    choose(state, "b", "c", random);

    const target = player(state, "c");
    expect(target.hand).toContainEqual(card);
    expect(target.status).toBe("frozen");
  });
});

describe("Flip Three during the opening deal", () => {
  it("resolves the chain, then offers Hit or Stay at a flipped player's slot", () => {
    const trigger = flipThree();
    const flips = [num(1), num(2), num(3)];
    const cCard = num(4);
    const dCard = num(5);
    const untouched = num(9);
    const state = finishedRound(["a", "b", "c", "d"]);
    rig(state, [trigger, ...flips, cCard, dCard, untouched]);
    nextRound(state, "a", random);

    choose(state, "a", "b", random);

    expect(state.discard.at(-1)).toBe(trigger);
    expect(table(state, 0)).toMatchObject({
      deck: [untouched.id, dCard.id, cCard.id],
      players: {
        a: { hand: [] },
        b: { hand: ids(flips), status: "active" },
        c: { hand: [] },
      },
      turnId: "b",
    });

    stay(state, "b", random);

    expect(table(state, 0)).toMatchObject({
      deck: [untouched.id],
      players: {
        b: { status: "stayed" },
        c: { hand: [cCard.id] },
        d: { hand: [dCard.id] },
      },
      turnId: "a",
    });
  });

  it("skips the slot of a player the chain already knocked out", () => {
    const state = finishedRound(["a", "b", "c"]);
    const trigger = flipThree();
    const one = num(1);
    const duplicate = num(1);
    const bCard = num(4);
    const untouched = num(9);
    rig(state, [trigger, one, duplicate, bCard, untouched]);
    nextRound(state, "a", random);

    choose(state, "a", "c", random);

    expect(state.discard.at(-1)).toBe(trigger);
    expect(table(state, 0)).toMatchObject({
      deck: [untouched.id],
      players: {
        b: { hand: [bCard.id] },
        c: { hand: [one.id], status: "busted" },
      },
      turnId: "a",
    });
  });
});
