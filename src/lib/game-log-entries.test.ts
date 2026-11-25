import { describe, expect, it } from "vitest";

import type { Card } from "../game/cards";
import {
  addBot,
  addPlayer,
  backToLobby,
  chat,
  choose,
  configure,
  createGame,
  hit,
  nextRound,
  playFor,
  playForAbsent,
  startGame,
  stay,
} from "../game/engine";
import type { GameCue, GameState, LogEntry } from "../game/engine";
import { DEFAULT_SETTINGS } from "../game/settings";
import type { EventDetail } from "./game-log-entries";
import {
  countChatsAfter,
  eventCopy,
  eventDetails,
  groupLog,
  HOUR_MS,
  involves,
  nameParts,
  shownTimes,
  summarizeRound,
  MINUTE_MS,
  roundAnnouncement,
  SECOND_MS,
  systemCopy,
  timeFormats,
  timeLabel,
  winnerAnnouncement,
} from "./game-log-entries";

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

const cuedEntry =
  (cue: GameCue, nth = -1) =>
  (log: LogEntry[]) =>
    log.filter((entry) => entry.cue === cue).at(nth);

const fromEnd =
  (offset = 1) =>
  (log: LogEntry[]) =>
    log.at(-offset);

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

type Scenario = keyof typeof scenarios;

const messageFrom = (
  scenario: Scenario,
  pick: (log: LogEntry[]) => LogEntry | undefined
) => {
  const entry = pick(scenarios[scenario]());

  if (entry === undefined) {
    throw new Error(`${scenario} logged no matching entry`);
  }

  return entry;
};

const pts = (points: number) => ({ kind: "points", points }) as const;

const dupe = (number: number) =>
  ({ kind: "card", label: "duplicate", number }) as const;

const words = (text: string) => ({ kind: "text", text }) as const;

const event = (
  outcome: string,
  players: string[],
  details: EventDetail[] | undefined,
  icon?: string
) => ({
  announcement: false,
  details: details ?? [],
  icon,
  outcome,
  players,
});

const announcement = (outcome: string, icon?: string) => ({
  announcement: true,
  details: [],
  icon,
  outcome,
  players: [],
});

const unchangedMessages = [
  ["flipThreeOnSelf", cuedEntry("special", 0), "playing-cards-fan"],
  ["joinLobby", cuedEntry("join"), "user-plus"],
  ["joinMidRound", cuedEntry("join"), "user-plus"],
  ["botAdded", cuedEntry("join"), "user-plus"],
  ["offlineStayByGame", cuedEntry("bank"), "coins"],
  ["offlineStayByHost", cuedEntry("bank"), "coins"],
  ["winner", fromEnd(), "trophy"],
] as const;

describe("the engine's messages in the Chat & Log", () => {
  it.each([
    [
      "stayPoints",
      cuedEntry("bank"),
      event("Ada stayed", ["Ada"], [pts(10)], "coins"),
    ],
    [
      "stayOnePoint",
      cuedEntry("bank"),
      event("Ada stayed", ["Ada"], [pts(1)], "coins"),
    ],
    [
      "bust",
      cuedEntry("bust"),
      event("Ada busted", ["Ada"], [dupe(5)], "circle-x"),
    ],
    [
      "flipSeven",
      cuedEntry("flipSeven"),
      event("Ada flipped 7!", ["Ada"], undefined, "flame"),
    ],
    [
      "freezeSelf",
      cuedEntry("freeze"),
      event("Ada froze themselves", ["Ada"], [pts(5)], "snowflake"),
    ],
    [
      "freezeOther",
      cuedEntry("freeze"),
      event(
        "Bo was frozen",
        ["Ada", "Bo"],
        [pts(3), words("by Ada")],
        "snowflake"
      ),
    ],
    [
      "secondChanceSave",
      cuedEntry("special"),
      event("Ada used Second Chance", ["Ada"], [dupe(5)], "heart"),
    ],
    [
      "secondChanceSave",
      cuedEntry("special", 0),
      event("Ada got a Second Chance", ["Ada"], undefined, "heart"),
    ],
    [
      "flipThreeOnOther",
      cuedEntry("special", 0),
      event(
        "Bo must flip three",
        ["Ada", "Bo"],
        [words("from Ada")],
        "playing-cards-fan"
      ),
    ],
    [
      "assign",
      cuedEntry("special", 1),
      event(
        "Bo assigned Freeze",
        ["Bo"],
        [words("to themselves")],
        "arrow-right"
      ),
    ],
    [
      "assign",
      cuedEntry("special", 2),
      event(
        "Bo assigned Flip Three",
        ["Bo", "Cy"],
        [words("to Cy")],
        "arrow-right"
      ),
    ],
    [
      "giveSecondChance",
      cuedEntry("special"),
      event(
        "Cy got Second Chance",
        ["Ada", "Cy"],
        [words("from Ada")],
        "heart"
      ),
    ],
    [
      "reshuffle",
      fromEnd(),
      announcement("Deck rebuilt from the discard pile.", "shuffle"),
    ],
    ["outOfCards", fromEnd(2), announcement("Deck empty · round ended.")],
  ] as const)("shortens %s", (scenario, pick, expected) => {
    expect(eventDetails(messageFrom(scenario, pick), true)).toStrictEqual(
      expected
    );
  });

  it.each(unchangedMessages)(
    "shows %s as the engine wrote it",
    (scenario, pick, icon) => {
      const entry = messageFrom(scenario, pick);

      expect(eventDetails(entry, true)).toMatchObject({
        details: [],
        icon,
        outcome: entry.text,
      });
    }
  );

  it("shows short lock and unlock events with matching icons", () => {
    expect(
      scenarios
        .lockRoom()
        .slice(-2)
        .map((entry) => eventDetails(entry, true))
    ).toStrictEqual([
      event("Room locked.", [], undefined, "lock"),
      event("Room unlocked.", [], undefined, "lock-open"),
    ]);
  });

  it.each([
    ["roundOver", fromEnd(), "Round 1 is over."],
    ["tied", fromEnd(), "Round 1 is over. Tied at 210, so play continues."],
  ] as const)("announces %s as the engine wrote it", (scenario, pick, text) => {
    const entry = messageFrom(scenario, pick);

    expect(entry.text).toBe(text);
    expect(eventDetails(entry, true)).toStrictEqual(announcement(text));
  });

  it("drops the round from a round's first message under its heading", () => {
    const [begins] = scenarios.roundOver();

    if (begins === undefined) {
      throw new Error("The round logged nothing");
    }

    expect(eventDetails(begins, true)).toStrictEqual(
      announcement("Bo deals.", "playing-cards")
    );
    expect(eventDetails(begins, false)).toStrictEqual(
      announcement(begins.text)
    );
  });
});

describe("the Chat & Log's patterns", () => {
  const engineLog = Object.values(scenarios).flatMap((run) => run());

  const rules = Object.entries(eventCopy).flatMap(([cue, cueRules]) =>
    cueRules.map(([pattern]) => ({ cue, pattern }))
  );

  it.each(rules)(
    "$cue: $pattern matches something the engine says",
    ({ cue, pattern }) => {
      expect(
        engineLog.some((entry) => entry.cue === cue && pattern.test(entry.text))
      ).toBeTruthy();
    }
  );

  it.each([...systemCopy.keys()])("%s is something the engine says", (text) => {
    expect(engineLog.map((entry) => entry.text)).toContain(text);
  });

  it.each([
    ["round", roundAnnouncement],
    ["winner", winnerAnnouncement],
  ])("the %s announcement matches something the engine says", (_, pattern) => {
    expect(engineLog.some((entry) => pattern.test(entry.text))).toBeTruthy();
  });

  it("accounts for every cued message in the scenarios", () => {
    const unchanged = new Set(
      unchangedMessages.map(
        ([scenario, pick]) => messageFrom(scenario, pick).text
      )
    );

    const unmatched = engineLog.filter(
      (entry) =>
        entry.cue !== undefined &&
        !unchanged.has(entry.text) &&
        (entry.cue === "join" ||
          !eventCopy[entry.cue].some(([pattern]) => pattern.test(entry.text)))
    );

    expect(unmatched.map((entry) => entry.text)).toStrictEqual([]);
  });
});

const playTwoGames = () => {
  const state = createGame();
  addPlayer(state, "a", NAMES.a, 1);
  addPlayer(state, "b", NAMES.b, 2);
  chat(state, "a", "ready?");
  const lobby = [...state.log];

  const first = deal(["a", "b"], [num(5), num(3)]);
  stay(first, "a", random);
  stay(first, "b", random);
  rig(first, [num(6), num(4)]);
  nextRound(first, "a", random);
  playerById(first, "a").score = DEFAULT_SETTINGS.targetScore;
  stay(first, "b", random);
  stay(first, "a", random);
  const firstGame = [...first.log];

  backToLobby(first, "a");
  startGame(first, "a", random);

  return { firstGame, lobby, secondGame: first.log };
};

describe(groupLog, () => {
  it("files the lobby before the game", () => {
    const { lobby } = playTwoGames();

    expect(groupLog(lobby)).toStrictEqual([
      { entries: lobby, heading: "Before the game", id: lobby[0]?.id },
    ]);
  });

  it("moves from the lobby into the first round", () => {
    const { firstGame, lobby } = playTwoGames();

    expect(
      groupLog([...lobby, ...firstGame]).map(({ heading }) => heading)
    ).toStrictEqual(["Before the game", "Round 1", "Round 2"]);
  });

  it("starts a group each round", () => {
    const { firstGame } = playTwoGames();
    const groups = groupLog(firstGame);

    expect(groups.map(({ heading }) => heading)).toStrictEqual([
      "Round 1",
      "Round 2",
    ]);
    expect(groups.flatMap(({ entries }) => entries)).toStrictEqual(firstGame);
    expect(
      groups.map(({ entries, id }) => entries[0]?.id === id)
    ).toStrictEqual([true, true]);
    expect(
      groups.map(({ entries }) => eventDetails(entries[0], true).outcome)
    ).toStrictEqual(["Bo deals.", "Ada deals."]);
  });

  it("names the game from the second game on", () => {
    const { secondGame } = playTwoGames();

    expect(groupLog(secondGame).map(({ heading }) => heading)).toStrictEqual([
      "Game 2 · Round 1",
    ]);
  });

  it("starts a group when the game changes but the round number doesn't", () => {
    const { firstGame, secondGame } = playTwoGames();
    const roundOne = firstGame.filter((entry) => entry.round === 1);

    expect(
      groupLog([...roundOne, ...secondGame]).map(({ heading }) => heading)
    ).toStrictEqual(["Round 1", "Game 2 · Round 1"]);
  });
});

describe(countChatsAfter, () => {
  it("counts other players' messages after the last one seen", () => {
    const state = createGame();
    addPlayer(state, "a", NAMES.a, 1);
    addPlayer(state, "b", NAMES.b, 2);
    chat(state, "a", "hi");
    const seen = state.logSeq;
    chat(state, "b", "hey");
    chat(state, "a", "ready?");
    chat(state, "b", "yes");

    expect(countChatsAfter(state.log, "a", seen)).toBe(2);
    expect(countChatsAfter(state.log, "a", 0)).toBe(2);
    expect(countChatsAfter(state.log, null, 0)).toBe(4);
  });
});

describe(timeLabel, () => {
  const formats = timeFormats("en-US");
  const at = new Date(Date.UTC(2026, 0, 1, 12));
  const after = (ms: number) => at.getTime() + ms;

  it("says now for no time at all, or a clock running behind", () => {
    expect(timeLabel(at, after(0), formats)).toStrictEqual({
      long: "now",
      short: "now",
    });
    expect(timeLabel(at, after(-5 * SECOND_MS), formats)).toStrictEqual({
      long: "now",
      short: "now",
    });
  });

  it("counts seconds under a minute", () => {
    expect(timeLabel(at, after(45 * SECOND_MS + 900), formats)).toStrictEqual({
      long: "45 seconds ago",
      short: "45s",
    });
  });

  it("counts minutes under an hour", () => {
    expect(timeLabel(at, after(MINUTE_MS), formats)).toStrictEqual({
      long: "1 minute ago",
      short: "1m",
    });
    expect(timeLabel(at, after(HOUR_MS - 1), formats)).toStrictEqual({
      long: "59 minutes ago",
      short: "59m",
    });
  });

  it.each([HOUR_MS, HOUR_MS + MINUTE_MS])(
    "gives the clock time after %i ms",
    (elapsed) => {
      expect(timeLabel(at, after(elapsed), formats)).toStrictEqual({
        long: formats.exact.format(at),
        short: formats.clock.format(at),
      });
      expect(formats.clock.format(at)).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/u);
      expect(formats.exact.format(at)).toMatch(/^\d{1,2}:\d{2}:\d{2}\s[AP]M$/u);
    }
  );
});

let logId = 0;

const logEntry = (text: string, extra: Partial<LogEntry> = {}) => {
  logId += 1;

  return {
    at: 0,
    game: 1,
    id: logId,
    round: 1,
    text,
    ...extra,
  } satisfies LogEntry;
};

const said = (name: string, text: string, at = 0) =>
  logEntry(text, { at, from: { avatar: null, id: name, name } });

describe(nameParts, () => {
  it("splits out each name, longest first where names overlap", () => {
    expect(nameParts("Ash froze Ashley", ["Ash", "Ashley"])).toStrictEqual([
      { name: "Ash" },
      { text: " froze " },
      { name: "Ashley" },
    ]);
  });

  it("keeps text without names whole", () => {
    expect(nameParts("Room locked.", ["Ada"])).toStrictEqual([
      { text: "Room locked." },
    ]);
    expect(nameParts("from Ada", [])).toStrictEqual([{ text: "from Ada" }]);
  });
});

describe(involves, () => {
  it("finds a player named anywhere in an event, ignoring case", () => {
    const frozen = logEntry("Ada played Freeze on Bo, who banked 3 points.", {
      cue: "freeze",
    });

    expect(involves(frozen, "bo")).toBeTruthy();
    expect(involves(frozen, "Ada")).toBeTruthy();
    expect(involves(frozen, "Cy")).toBeFalsy();
  });

  it("counts a chat as its sender's", () => {
    expect(involves(said("Ada", "hi Bo"), "Ada")).toBeTruthy();
    expect(involves(said("Ada", "hi Bo"), "Bo")).toBeFalsy();
  });
});

describe(summarizeRound, () => {
  it("names the biggest bank, then Flip 7s and busts", () => {
    expect(
      summarizeRound([
        logEntry("Ada stayed and banked 12 points.", { cue: "bank" }),
        logEntry("Bo was dealt a duplicate 5 and busted.", { cue: "bust" }),
        said("Bo", "ugh"),
        logEntry("Cy earned the Flip 7 bonus!", { cue: "flipSeven" }),
        logEntry("Ada played Freeze on Cy, who banked 40 points.", {
          cue: "freeze",
        }),
        logEntry("Ada was dealt a duplicate 9 and busted.", { cue: "bust" }),
      ])
    ).toStrictEqual(["Cy +40", "Cy flipped 7", "2 busts"]);
  });

  it("says nothing for a round without scores", () => {
    expect(summarizeRound([logEntry("Round 1 is over.")])).toStrictEqual([]);
  });
});

describe(shownTimes, () => {
  it("shows a time once per minute of game events and once per chat run", () => {
    const entries = [
      logEntry("first", { at: 0 }),
      logEntry("same minute", { at: 30 * SECOND_MS }),
      logEntry("a minute on", { at: MINUTE_MS }),
      said("Ada", "hi", MINUTE_MS + SECOND_MS),
      said("Ada", "again", MINUTE_MS + 2 * SECOND_MS),
      logEntry("after a chat", { at: MINUTE_MS + 3 * SECOND_MS }),
    ];

    const shown = shownTimes(entries);

    expect(
      entries.flatMap((entry) => (shown.has(entry.id) ? [entry.text] : []))
    ).toStrictEqual(["first", "a minute on", "hi", "after a chat"]);
  });
});
