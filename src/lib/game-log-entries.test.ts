import { describe, expect, it } from "vitest";

import type { Card } from "../game/cards";
import {
  addPlayer,
  backToLobby,
  chat,
  createGame,
  isChat,
  nextRound,
  startGame,
  stay,
} from "../game/engine";
import type { ChatEntry, EventEntry, GameState } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { DEFAULT_SETTINGS } from "../game/settings";
import type { EventCopy, EventDetail, NamePart } from "./game-log-entries";
import {
  countChatsAfter,
  detailText,
  eventCopy,
  groupLog,
  HOUR_MS,
  involves,
  MINUTE_MS,
  partsText,
  SECOND_MS,
  shownTimes,
  timeFormats,
  timeLabel,
} from "./game-log-entries";

const random = () => 0.5;

let nextId = 1000;

const cardId = () => {
  nextId += 1;

  return nextId;
};

const num = (value: number) =>
  ({ id: cardId(), kind: "number", value }) satisfies Card;

const NAMES = { a: "Ada", b: "Bo" };

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

const ada = { id: "a", name: "Ada" };
const bo = { id: "b", name: "Bo" };
const cy = { id: "c", name: "Cy" };

let logId = 0;

const readParts = (parts: readonly NamePart[]) =>
  parts
    .map((part) => ("text" in part ? part.text : `[${part.player.name}]`))
    .join("");

const shownDetail = (detail: EventDetail) =>
  detail.kind === "text" ? readParts(detail.parts) : detailText(detail);

const read = (copy: EventCopy) => ({
  announcement: copy.announcement,
  details: copy.details.map(shownDetail),
  icon: copy.icon,
  outcome: readParts(copy.outcome),
});

const copyOf = (event: GameEvent, round = 1) =>
  read(eventCopy({ at: 0, event, game: 1, id: 1, round }, true));

const happening = (outcome: string, icon?: string, details: string[] = []) => ({
  announcement: false,
  details,
  icon,
  outcome,
});

const announcement = (outcome: string, icon?: string) => ({
  announcement: true,
  details: [],
  icon,
  outcome,
});

describe(eventCopy, () => {
  it.each([
    [
      "a Stay",
      { by: { kind: "player" }, player: ada, points: 10, type: "stayed" },
      happening("[Ada] stayed", "coins", ["+10 pts"]),
    ],
    [
      "a one-point Stay",
      { by: { kind: "player" }, player: ada, points: 1, type: "stayed" },
      happening("[Ada] stayed", "coins", ["+1 pt"]),
    ],
    [
      "the host staying for an offline player",
      {
        by: { host: ada, kind: "host" },
        player: bo,
        points: 3,
        type: "stayed",
      },
      happening("[Ada] stayed for [Bo]", "coins", [
        "+3 pts",
        "[Bo] is offline",
      ]),
    ],
    [
      "the game staying for an offline player",
      { by: { kind: "game" }, player: ada, points: 5, type: "stayed" },
      happening("The game stayed for [Ada]", "coins", [
        "+5 pts",
        "[Ada] is offline",
      ]),
    ],
    [
      "a bust",
      { card: 5, player: ada, type: "busted" },
      happening("[Ada] busted", "circle-x", ["duplicate 5"]),
    ],
    [
      "a Flip 7",
      { player: ada, type: "flipSeven" },
      happening("[Ada] flipped 7!", "flame"),
    ],
    [
      "a Freeze on yourself",
      { by: ada, points: 5, target: ada, type: "frozen" },
      happening("[Ada] froze themselves", "snowflake", ["+5 pts"]),
    ],
    [
      "a Freeze on someone else",
      { by: ada, points: 3, target: bo, type: "frozen" },
      happening("[Bo] was frozen", "snowflake", ["+3 pts", "by [Ada]"]),
    ],
    [
      "a Freeze from a player who left",
      { by: null, points: 3, target: bo, type: "frozen" },
      happening("[Bo] was frozen", "snowflake", ["+3 pts", "by Someone"]),
    ],
    [
      "a Flip Three on yourself",
      { by: ada, target: ada, type: "flipThreeStarted" },
      happening("[Ada] must flip three cards.", "playing-cards-fan"),
    ],
    [
      "a Flip Three on someone else",
      { by: ada, target: bo, type: "flipThreeStarted" },
      happening("[Bo] must flip three", "playing-cards-fan", ["from [Ada]"]),
    ],
    [
      "a Second Chance kept",
      { player: ada, type: "secondChanceKept" },
      happening("[Ada] got a Second Chance", "heart"),
    ],
    [
      "a Second Chance used",
      { card: 5, player: ada, type: "secondChanceUsed" },
      happening("[Ada] used Second Chance", "heart", ["duplicate 5"]),
    ],
    [
      "a Second Chance given",
      { by: ada, target: cy, type: "secondChanceGiven" },
      happening("[Cy] got Second Chance", "heart", ["from [Ada]"]),
    ],
    [
      "an extra Second Chance",
      { player: ada, type: "secondChanceDiscarded" },
      happening("[Ada] discarded an extra Second Chance."),
    ],
    [
      "a held card assigned to yourself",
      { by: bo, card: "freeze", target: bo, type: "actionAssigned" },
      happening("[Bo] assigned Freeze", "arrow-right", ["to themselves"]),
    ],
    [
      "a held card assigned to someone else",
      { by: bo, card: "flipThree", target: cy, type: "actionAssigned" },
      happening("[Bo] assigned Flip Three", "arrow-right", ["to [Cy]"]),
    ],
    [
      "held cards discarded",
      { cards: ["freeze", "flipThree"], type: "heldActionsDiscarded" },
      happening(
        "Freeze and Flip Three set aside during the Flip Three were discarded."
      ),
    ],
    [
      "a held card discarded",
      { cards: ["freeze"], type: "heldActionsDiscarded" },
      happening("Freeze set aside during the Flip Three was discarded."),
    ],
    [
      "a card for a player who left",
      { card: "freeze", target: null, type: "actionDiscarded" },
      happening(
        "Freeze for a player who left was discarded, since they're out of the round."
      ),
    ],
    [
      "a card for a player out of the round",
      { card: "flipThree", target: bo, type: "actionDiscarded" },
      happening(
        "Flip Three for [Bo] was discarded, since they're out of the round."
      ),
    ],
    [
      "the game hitting for an offline player",
      {
        by: { kind: "game" },
        move: "hit",
        player: ada,
        type: "movedForOffline",
      },
      happening("[Ada] is offline and has no cards, so the game hit for them."),
    ],
    [
      "the game playing an offline player's card",
      {
        by: { kind: "game" },
        move: "choose",
        player: ada,
        type: "movedForOffline",
      },
      happening("[Ada] is offline, so the game played their card."),
    ],
    [
      "the host hitting for an offline player",
      {
        by: { host: ada, kind: "host" },
        move: "hit",
        player: bo,
        type: "movedForOffline",
      },
      happening("[Ada] hit for [Bo], who is offline."),
    ],
    [
      "the host choosing for an offline player",
      {
        by: { host: ada, kind: "host" },
        move: "choose",
        player: bo,
        type: "movedForOffline",
      },
      happening("[Ada] chose for [Bo], who is offline."),
    ],
    [
      "a join",
      { player: ada, type: "joined", waitsFor: null },
      happening("[Ada] joined.", "user-plus"),
    ],
    [
      "a join mid-game",
      { player: cy, type: "joined", waitsFor: "round" },
      happening("[Cy] joined and will play in the next round.", "user-plus"),
    ],
    [
      "a bot",
      { player: { id: "bot", name: "Ember" }, type: "botAdded" },
      happening("The host added [Ember], a bot.", "user-plus"),
    ],
    [
      "a kick",
      { how: "kicked", player: bo, type: "evicted" },
      happening("[Bo] was removed by the host."),
    ],
    [
      "a leave",
      { how: "left", player: bo, type: "evicted" },
      happening("[Bo] left."),
    ],
    [
      "leaving to watch",
      { how: "leftToWatch", player: bo, type: "evicted" },
      happening("[Bo] left to watch."),
    ],
    [
      "a new host",
      { player: bo, type: "hostChanged" },
      happening("[Bo] is now the host."),
    ],
    [
      "a winning score",
      { targetScore: 300, type: "targetScoreSet" },
      happening("The host set the winning score to 300."),
    ],
    [
      "fast bots",
      { botSpeed: "fast", type: "botSpeedSet" },
      happening("The host sped up the bots."),
    ],
    [
      "normal bots",
      { botSpeed: "normal", type: "botSpeedSet" },
      happening("The host set the bots back to normal speed."),
    ],
    [
      "a lock",
      { locked: true, type: "lockSet" },
      happening("Room locked.", "lock"),
    ],
    [
      "an unlock",
      { locked: false, type: "lockSet" },
      happening("Room unlocked.", "lock-open"),
    ],
    [
      "a game without enough players",
      { type: "gameAbandoned" },
      happening("Not enough players left, so the game ended."),
    ],
    [
      "a reshuffle",
      { type: "deckReshuffled" },
      announcement("Deck rebuilt from the discard pile.", "shuffle"),
    ],
    [
      "an empty deck",
      { type: "outOfCards" },
      announcement("Deck empty · round ended."),
    ],
    [
      "a round's end",
      { scores: [], tiedAt: null, type: "roundOver" },
      announcement("Round 1 is over."),
    ],
    [
      "a tie at the winning score",
      { scores: [], tiedAt: 210, type: "roundOver" },
      announcement("Round 1 is over. Tied at 210, so play continues."),
    ],
    [
      "a win",
      { player: ada, points: 210, scores: [], type: "gameWon" },
      happening("[Ada] wins with 210 points!", "trophy"),
    ],
  ] satisfies [string, GameEvent, ReturnType<typeof happening>][])(
    "words %s",
    (_, happened, expected) => {
      expect(copyOf(happened)).toStrictEqual(expected);
    }
  );

  it("drops the round from a round's first event under its heading", () => {
    const entry = {
      at: 0,
      event: { dealer: bo, type: "roundStarted" },
      game: 1,
      id: 1,
      round: 2,
    } satisfies EventEntry;

    expect(read(eventCopy(entry, true))).toStrictEqual(
      announcement("[Bo] deals.", "playing-cards")
    );
    expect(read(eventCopy(entry, false))).toStrictEqual(
      announcement("Round 2 begins. [Bo] deals.")
    );
    expect(
      read(
        eventCopy(
          { ...entry, event: { dealer: null, type: "roundStarted" } },
          true
        )
      )
    ).toStrictEqual(announcement("Someone deals.", "playing-cards"));
  });

  it("names each player as the player, even when a name is ordinary words", () => {
    const short = { id: "x", name: "a" };

    expect(
      copyOf({ by: short, points: 3, target: bo, type: "frozen" })
    ).toStrictEqual(
      happening("[Bo] was frozen", "snowflake", ["+3 pts", "by [a]"])
    );
  });

  it("keeps the name a player had when the event happened", () => {
    const copy = eventCopy(
      logEntry({
        by: { kind: "player" },
        player: { id: "a", name: "Old name" },
        points: 2,
        type: "stayed",
      }),
      true
    );

    expect(copy.outcome).toStrictEqual([
      { player: { id: "a", name: "Old name" } },
      { text: " stayed" },
    ]);
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
      groups.map(({ entries }) => {
        const [first] = entries;

        return first === undefined || isChat(first)
          ? undefined
          : partsText(eventCopy(first, true).outcome);
      })
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

const logEntry = (event: GameEvent, at = 0) => {
  logId += 1;

  return { at, event, game: 1, id: logId, round: 1 } satisfies EventEntry;
};

const said = (name: string, text: string, at = 0) => {
  logId += 1;

  return {
    at,
    from: { avatar: null, id: name, name },
    game: 1,
    id: logId,
    round: 1,
    text,
  } satisfies ChatEntry;
};

describe(involves, () => {
  it("finds every player an event names, by ID", () => {
    const frozen = logEntry({ by: ada, points: 3, target: bo, type: "frozen" });

    expect(involves(frozen, bo.id)).toBeTruthy();
    expect(involves(frozen, ada.id)).toBeTruthy();
    expect(involves(frozen, cy.id)).toBeFalsy();
  });

  it("tells apart players whose names overlap", () => {
    const alex = { id: "x", name: "Alex" };
    const alexander = { id: "y", name: "Alexander" };

    const stayed = logEntry({
      by: { kind: "player" },
      player: alexander,
      points: 4,
      type: "stayed",
    });

    expect(involves(stayed, alexander.id)).toBeTruthy();
    expect(involves(stayed, alex.id)).toBeFalsy();
  });

  it("counts a chat as its sender's", () => {
    expect(involves(said("Ada", "hi Bo"), "Ada")).toBeTruthy();
    expect(involves(said("Ada", "hi Bo"), "Bo")).toBeFalsy();
  });
});

describe(shownTimes, () => {
  it("shows a time once per minute of game events and once per chat run", () => {
    const first = logEntry({ type: "deckReshuffled" }, 0);
    const sameMinute = logEntry({ type: "deckReshuffled" }, 30 * SECOND_MS);
    const minuteOn = logEntry({ type: "deckReshuffled" }, MINUTE_MS);
    const hi = said("Ada", "hi", MINUTE_MS + SECOND_MS);
    const again = said("Ada", "again", MINUTE_MS + 2 * SECOND_MS);

    const afterChat = logEntry(
      { type: "deckReshuffled" },
      MINUTE_MS + 3 * SECOND_MS
    );

    const entries = [first, sameMinute, minuteOn, hi, again, afterChat];
    const shown = shownTimes(entries);

    expect(
      entries.flatMap((entry) => (shown.has(entry.id) ? [entry.id] : []))
    ).toStrictEqual([first.id, minuteOn.id, hi.id, afterChat.id]);
  });
});
