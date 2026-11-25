import { describe, expect, it } from "vitest";

import type { Card } from "./cards";
import {
  addBot,
  addPlayer,
  chat,
  choose,
  configure,
  createGame,
  hit,
  isChat,
  kick,
  nextRound,
  playFor,
  playForAbsent,
  startGame,
  stay,
} from "./engine";
import type { GameState, LogEntry } from "./engine";
import { eventPlayers, settlesRound } from "./game-events";
import type { GameEvent, GameEventType } from "./game-events";
import { DEFAULT_SETTINGS } from "./settings";

const random = () => 0.5;

let nextId = 1000;

const cardId = () => {
  nextId += 1;

  return nextId;
};

const num = (value: number) =>
  ({ id: cardId(), kind: "number", value }) satisfies Card;

const freeze = () => ({ id: cardId(), kind: "freeze" }) satisfies Card;
const flipThree = () => ({ id: cardId(), kind: "flipThree" }) satisfies Card;

const secondChance = () =>
  ({ id: cardId(), kind: "secondChance" }) satisfies Card;

const NAMES = { a: "Ada", b: "Bo", c: "Cy" };

type PlayerId = keyof typeof NAMES;

const playerById = (state: GameState, id: PlayerId) => {
  const found = state.players.find((player) => player.id === id);

  if (found === undefined) {
    throw new Error(`No player ${id}`);
  }

  return found;
};

const rig = (state: GameState, draws: Card[]) => {
  state.deck = draws.toReversed();
};

const deal = (playerIds: PlayerId[], opening: Card[]) => {
  const state = createGame();

  for (const id of playerIds) {
    addPlayer(state, id, NAMES[id], 1);
  }

  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = playerIds.length - 2;
  state.discard = [];
  state.log = [];
  rig(state, opening);
  nextRound(state, "a", random);

  return state;
};

const scenarios = {
  lockRoom: () => {
    const state = createGame();
    addPlayer(state, "a", NAMES.a, 1);
    configure(state, "a", { locked: true });
    configure(state, "a", { locked: false });

    return state.log;
  },
  assign: () => {
    const state = deal(["a", "b", "c"], [num(5), num(3), num(8)]);
    rig(state, [flipThree(), freeze(), flipThree(), num(2)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    choose(state, "b", "b", random);
    choose(state, "b", "c", random);

    return state.log;
  },
  botAdded: () => {
    const state = createGame();
    addPlayer(state, "a", NAMES.a, 1);
    addBot(state, "a", "bot", random);

    return state.log;
  },
  bust: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [num(5)]);
    hit(state, "a", random);

    return state.log;
  },
  flipSeven: () => {
    const state = deal(["a", "b"], [num(1), num(12)]);
    playerById(state, "a").hand.push(num(2), num(3), num(4), num(5), num(6));
    rig(state, [num(7)]);
    hit(state, "a", random);

    return state.log;
  },
  flipThreeOnOther: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(1), num(2), num(4)]);
    hit(state, "a", random);
    choose(state, "a", "b", random);

    return state.log;
  },
  flipThreeOnSelf: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(1), num(2), num(4)]);
    hit(state, "a", random);
    choose(state, "a", "a", random);

    return state.log;
  },
  freezeOther: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [freeze()]);
    hit(state, "a", random);
    choose(state, "a", "b", random);

    return state.log;
  },
  freezeSelf: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [freeze()]);
    hit(state, "a", random);
    choose(state, "a", "a", random);

    return state.log;
  },
  giveSecondChance: () => {
    const state = deal(["a", "b", "c"], [secondChance(), num(3), num(4)]);
    rig(state, [secondChance()]);
    hit(state, "a", random);
    choose(state, "a", "c", random);

    return state.log;
  },
  joinLobby: () => {
    const state = createGame();
    addPlayer(state, "a", NAMES.a, 1);

    return state.log;
  },
  joinMidRound: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    addPlayer(state, "c", NAMES.c, 1);

    return state.log;
  },
  offlineStayByGame: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    playerById(state, "a").connected = false;
    playForAbsent(state, random);

    return state.log;
  },
  offlineStayByHost: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    playerById(state, "b").connected = false;
    playFor(state, "a", "b", { type: "stay" }, random);

    return state.log;
  },
  outOfCards: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, []);
    state.discard = [];
    hit(state, "a", random);

    return state.log;
  },
  reshuffle: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, []);
    state.discard = [num(9)];
    hit(state, "a", random);

    return state.log;
  },
  roundOver: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    stay(state, "b", random);

    return state.log;
  },
  secondChanceSave: () => {
    const state = deal(["a", "b"], [num(5), num(3)]);
    rig(state, [secondChance(), num(5)]);
    hit(state, "a", random);
    stay(state, "b", random);
    hit(state, "a", random);

    return state.log;
  },
  stayOnePoint: () => {
    const state = deal(["a", "b"], [num(1), num(3)]);
    stay(state, "a", random);

    return state.log;
  },
  stayPoints: () => {
    const state = deal(["a", "b"], [num(10), num(3)]);
    stay(state, "a", random);

    return state.log;
  },
  tied: () => {
    const state = deal(["a", "b"], [num(10), num(10)]);
    playerById(state, "a").score = DEFAULT_SETTINGS.targetScore;
    playerById(state, "b").score = DEFAULT_SETTINGS.targetScore;
    stay(state, "a", random);
    stay(state, "b", random);

    return state.log;
  },
  winner: () => {
    const state = deal(["a", "b"], [num(10), num(3)]);
    playerById(state, "a").score = DEFAULT_SETTINGS.targetScore - 5;
    stay(state, "a", random);
    stay(state, "b", random);

    return state.log;
  },
} satisfies Record<string, () => LogEntry[]>;

const eventsOf = (log: LogEntry[]) =>
  log.flatMap((entry) => (isChat(entry) ? [] : [entry.event]));

const eventsIn = (scenario: keyof typeof scenarios, type: GameEventType) =>
  eventsOf(scenarios[scenario]()).filter((event) => event.type === type);

const ada = { id: "a", name: "Ada" };
const bo = { id: "b", name: "Bo" };
const cy = { id: "c", name: "Cy" };

describe("the events the engine records", () => {
  it.each([
    ["stayPoints", { by: { kind: "player" }, player: ada, points: 10 }],
    ["stayOnePoint", { by: { kind: "player" }, player: ada, points: 1 }],
    ["offlineStayByGame", { by: { kind: "game" }, player: ada, points: 5 }],
    [
      "offlineStayByHost",
      { by: { host: ada, kind: "host" }, player: bo, points: 3 },
    ],
  ] as const)("records %s as a Stay", (scenario, stayed) => {
    expect(eventsIn(scenario, "stayed").at(-1)).toStrictEqual({
      ...stayed,
      type: "stayed",
    });
  });

  it.each([
    ["freezeSelf", { by: ada, points: 5, target: ada, type: "frozen" }],
    ["freezeOther", { by: ada, points: 3, target: bo, type: "frozen" }],
    ["flipThreeOnSelf", { by: ada, target: ada, type: "flipThreeStarted" }],
    ["flipThreeOnOther", { by: ada, target: bo, type: "flipThreeStarted" }],
    ["giveSecondChance", { by: ada, target: cy, type: "secondChanceGiven" }],
    ["secondChanceSave", { card: 5, player: ada, type: "secondChanceUsed" }],
    ["bust", { card: 5, player: ada, type: "busted" }],
    ["flipSeven", { player: ada, type: "flipSeven" }],
  ] as const)(
    "records %s with who played it and on whom",
    (scenario, event) => {
      expect(eventsIn(scenario, event.type).at(-1)).toStrictEqual(event);
    }
  );

  it("records a Second Chance kept before one is used", () => {
    expect(eventsIn("secondChanceSave", "secondChanceKept")).toStrictEqual([
      { player: ada, type: "secondChanceKept" },
    ]);
  });

  it("records each card a Flip Three's target assigns, in order", () => {
    expect(eventsIn("assign", "actionAssigned")).toStrictEqual([
      { by: bo, card: "freeze", target: bo, type: "actionAssigned" },
      { by: bo, card: "flipThree", target: cy, type: "actionAssigned" },
    ]);
  });

  it("records what everyone scored when a round settles", () => {
    expect(eventsIn("roundOver", "roundOver")).toStrictEqual([
      {
        scores: [
          { ...ada, points: 5 },
          { ...bo, points: 3 },
        ],
        tiedAt: null,
        type: "roundOver",
      },
    ]);
  });

  it("records the tied score when a round would have won the game", () => {
    expect(eventsIn("tied", "roundOver")).toMatchObject([
      { tiedAt: DEFAULT_SETTINGS.targetScore + 10 },
    ]);
  });

  it("records the winner and their total", () => {
    expect(eventsIn("winner", "gameWon")).toStrictEqual([
      {
        player: ada,
        points: DEFAULT_SETTINGS.targetScore + 5,
        scores: [
          { ...ada, points: 10 },
          { ...bo, points: 3 },
        ],
        type: "gameWon",
      },
    ]);
  });

  it("records who deals each round", () => {
    expect(eventsIn("roundOver", "roundStarted")).toStrictEqual([
      { dealer: bo, type: "roundStarted" },
    ]);
  });

  it("records joins, bots and whether a newcomer waits", () => {
    expect([
      ...eventsIn("joinLobby", "joined"),
      ...eventsIn("joinMidRound", "joined").slice(-1),
    ]).toStrictEqual([
      { player: ada, type: "joined", waitsFor: null },
      { player: cy, type: "joined", waitsFor: "round" },
    ]);
    expect(eventsIn("botAdded", "botAdded")).toMatchObject([
      { player: { id: "bot" }, type: "botAdded" },
    ]);
  });

  it("records the deck running out and being rebuilt", () => {
    expect(eventsIn("reshuffle", "deckReshuffled")).toHaveLength(1);
    expect(eventsIn("outOfCards", "outOfCards")).toHaveLength(1);
  });

  it("records the room being locked and unlocked", () => {
    expect(eventsIn("lockRoom", "lockSet")).toStrictEqual([
      { locked: true, type: "lockSet" },
      { locked: false, type: "lockSet" },
    ]);
  });

  it("keeps a player's name from when the event happened", () => {
    const state = deal(["a", "b", "c"], [num(5), num(3), num(4)]);
    stay(state, "a", random);
    kick(state, "a", "b", random);
    playerById(state, "a").name = "Renamed";

    expect(eventsOf(state.log).slice(-2)).toStrictEqual([
      { by: { kind: "player" }, player: ada, points: 5, type: "stayed" },
      { how: "kicked", player: bo, type: "evicted" },
    ]);
  });

  it("keeps chat apart from game events", () => {
    const state = createGame();
    addPlayer(state, "a", NAMES.a, 1);
    chat(state, "a", "hi");

    expect(state.log.at(-1)).toMatchObject({
      from: { avatar: 1, ...ada },
      text: "hi",
    });
    expect(state.log.at(-1)).not.toHaveProperty("event");
  });
});

describe(eventPlayers, () => {
  it.each([
    [
      {
        by: { host: ada, kind: "host" },
        player: bo,
        points: 3,
        type: "stayed",
      },
      [ada, bo],
    ],
    [{ by: { kind: "game" }, player: bo, points: 3, type: "stayed" }, [bo]],
    [{ by: ada, points: 0, target: bo, type: "frozen" }, [ada, bo]],
    [{ by: ada, points: 0, target: ada, type: "frozen" }, [ada]],
    [{ by: null, target: bo, type: "flipThreeStarted" }, [bo]],
    [{ by: bo, card: "freeze", target: null, type: "actionAssigned" }, [bo]],
    [{ dealer: null, type: "roundStarted" }, []],
    [{ scores: [{ ...ada, points: 1 }], tiedAt: null, type: "roundOver" }, []],
  ] satisfies [GameEvent, unknown[]][])(
    "names the players in %j",
    (event, players) => {
      expect(eventPlayers(event)).toStrictEqual(players);
    }
  );
});

describe(settlesRound, () => {
  it("is true only for the events that end a round", () => {
    const settling = Object.values(scenarios)
      .flatMap((run) => eventsOf(run()))
      .filter((event) => settlesRound(event))
      .map((event) => event.type);

    expect(new Set(settling)).toStrictEqual(new Set(["roundOver", "gameWon"]));
  });
});
