/* oxlint-disable eslint/no-await-in-loop -- Room updates reach playback one at a time, in order. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPlayer,
  choose,
  createGame,
  DEAL_HISTORY_LIMIT,
  hit,
  nextRound,
  stay,
  startGame,
} from "../game/engine";
import type { GameState } from "../game/engine";
import {
  listSeqsOf,
  NO_LISTS,
  parseServerMessage,
  receiveState,
  toRoomView,
  toStateMessage,
} from "../game/protocol";
import type { ListSeqs, RoomView, ServerMessage } from "../game/protocol";
import type { DealStep } from "./deal-plan";
import { createDealPlayback, initialDealPlayback } from "./deal-playback";
import type { DealMotion } from "./deal-playback";
import type { RoomCue } from "./room-cues";
import type { HapticOutcome } from "./room-haptic-cues";

const random = () => 0.5;
const freeze = { id: 1003, kind: "freeze" } as const;
const number = { id: 1004, kind: "number", value: 7 } as const;
const view = (game: GameState) => structuredClone(toRoomView("ABCDE", game));

const gameAtFirstTurn = () => {
  const game = createGame();
  addPlayer(game, "a", "Ada", 1);
  addPlayer(game, "b", "Ben", 1);
  startGame(game, "a", random);
  game.phase = "roundOver";
  game.round = 0;
  game.dealerIndex = 0;
  game.discard = [];
  game.deck = [
    { id: 1002, kind: "number", value: 3 },
    { id: 1001, kind: "number", value: 5 },
  ];
  nextRound(game, "a", random);

  return game;
};

const playback = (animate = true, playerId = "a") => {
  let shown = initialDealPlayback;
  let motionEnabled = animate;
  const cues: RoomCue[] = [];
  const haptics: (HapticOutcome | "turn")[] = [];
  const readinessAtTurnCue: boolean[] = [];
  const flights: { cardId: number; duration: number }[] = [];
  const steps: DealStep[] = [];

  const motion: DealMotion = {
    allowed: () => motionEnabled,
    captureFlight: (step, duration) => async (signal) => {
      flights.push({ cardId: step.card.id, duration });
      steps.push(step);
      const { promise, resolve } = Promise.withResolvers<undefined>();

      const done = () => {
        resolve(undefined);
      };

      const timer = setTimeout(done, duration);
      signal.addEventListener("abort", done, { once: true });
      await promise;
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
    },
    land: async () => {},
    reshuffle: () => {},
    sweep: async () => {},
  };

  const instance = createDealPlayback(
    motion,
    (frame) => {
      shown = frame;
    },
    (cue) => {
      cues.push(cue);

      if (cue === "turn") {
        readinessAtTurnCue.push(shown.myMove && !shown.actionsDisabled);
      }
    },
    (cue) => {
      haptics.push(cue);
    }
  );

  return {
    ...instance,
    cues,
    flights,
    haptics,
    readinessAtTurnCue,
    setMotion: (enabled: boolean) => {
      motionEnabled = enabled;
      instance.syncMotion(true);
    },
    show: (
      room: RoomView,
      canAct = true,
      syncId = 1,
      hapticsVisible = true
    ) => {
      instance.update({ canAct, hapticsVisible, playerId, room, syncId });
    },
    steps,
    get shown() {
      return shown;
    },
  };
};

describe(createDealPlayback, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays a Flip Three and its bust as separate cues at the affected seat", async () => {
    const game = gameAtFirstTurn();
    const flipThree = { id: 1005, kind: "flipThree" } as const;
    const duplicate = { ...number, id: 1006 };
    game.deck = [duplicate, number, flipThree];
    hit(game, "a", random);

    const ownTable = playback();
    const otherTable = playback(true, "b");
    const reducedTable = playback(false);

    ownTable.show(view(game));
    otherTable.show(view(game));
    reducedTable.show(view(game));
    choose(game, "a", "a", random);
    const afterFlip = view(game);
    ownTable.show(afterFlip);
    otherTable.show(afterFlip);
    reducedTable.show(afterFlip);

    expect(ownTable.haptics).toStrictEqual([]);
    expect(reducedTable.haptics).toStrictEqual(["bust"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(ownTable.haptics).toStrictEqual(["flipThree"]);
    await vi.runAllTimersAsync();
    expect(ownTable.haptics).toStrictEqual(["flipThree", "bust"]);
    expect(otherTable.haptics).toStrictEqual(["turn"]);
  });

  it("gives a Second Chance save priority over a move alert in the same frame", () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    choose(game, "a", "b", random);
    const [player] = game.players;

    if (player === undefined) {
      throw new Error("Expected Ada at the table");
    }

    player.hand = [number, { id: 1005, kind: "secondChance" }];

    const table = playback(false);
    table.show(view(game));
    game.deck = [{ ...number, id: 1006 }];
    hit(game, "a", random);
    table.show(view(game));

    expect(table.shown.myMove).toBeTruthy();
    expect(table.haptics).toStrictEqual(["saved"]);
  });

  it("cues Freeze once when the chosen target is the local player", async () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    const table = playback(true, "b");
    table.show(view(game));

    choose(game, "a", "b", random);
    table.show(view(game));
    expect(table.haptics).toStrictEqual([]);

    await vi.runAllTimersAsync();
    expect(table.haptics).toStrictEqual(["freeze"]);
  });

  it("celebrates once when the same Flip 7 also wins the game", () => {
    const game = gameAtFirstTurn();
    const [player] = game.players;

    if (player === undefined) {
      throw new Error("Expected Ada at the table");
    }

    player.score = game.settings.targetScore - 1;
    player.hand = Array.from({ length: 6 }, (_, value) => ({
      id: 1100 + value,
      kind: "number",
      value,
    }));

    const table = playback(false);
    const otherTable = playback(false, "b");
    table.show(view(game));
    otherTable.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    table.show(view(game));
    otherTable.show(view(game));

    expect(table.shown.room?.winnerIds).toStrictEqual(["a"]);
    expect(table.haptics).toStrictEqual(["celebrate"]);
    expect(otherTable.haptics).toStrictEqual([]);
  });

  it("keeps initial, reconnecting and hidden move alerts quiet", () => {
    const game = gameAtFirstTurn();
    const table = playback(false);
    table.show(view(game));
    expect({
      haptics: table.haptics,
      myMove: table.shown.myMove,
    }).toStrictEqual({ haptics: [], myMove: true });

    game.deck = [freeze];
    hit(game, "a", random);
    table.show(view(game), true, 2);
    expect(table.shown.myMove).toBeTruthy();
    expect(table.haptics).toStrictEqual([]);

    choose(game, "a", "b", random);
    table.show(view(game), true, 2, false);
    table.show(view(game), true, 2);
    expect({
      haptics: table.haptics,
      myMove: table.shown.myMove,
    }).toStrictEqual({ haptics: [], myMove: true });

    game.deck = [number];
    hit(game, "a", random);
    table.show(view(game), true, 2);
    expect(table.haptics).toStrictEqual(["turn"]);
  });

  it("reveals a landed choice before cueing its usable move", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    const choice = view(game);
    table.show(choice);

    expect({ frame: table.shown, cues: table.cues }).toMatchObject({
      frame: {
        actionsDisabled: true,
        step: { card: freeze },
        myMove: false,
        room: { choice: { card: freeze } },
      },
      cues: [],
    });

    await vi.advanceTimersToNextTimerAsync();

    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      myMove: false,
    });
    expect(table.cues).toStrictEqual(["reveal"]);

    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: true,
      room: choice,
    });
    expect([table.cues, table.readinessAtTurnCue]).toStrictEqual([
      ["reveal", "turn"],
      [true],
    ]);
  });

  it("counts an incoming card only after its flight finishes", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    table.show(view(game));

    const player = () => table.shown.room?.players.find(({ id }) => id === "a");

    expect(player()?.hand).toContainEqual(number);
    expect(table.shown.roundPoints.get("a")).toBe(5);

    await vi.advanceTimersToNextTimerAsync();

    expect(table.shown.dealing).toBeTruthy();
    expect(table.shown.roundPoints.get("a")).toBe(12);

    await vi.runAllTimersAsync();

    expect(table.shown.roundPoints.get("a")).toBe(12);
  });

  it("keeps a round-ending card out of the score until it lands", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    game.deck = [number];
    hit(game, "a", random);
    stay(game, "b", random);
    table.show(view(game));
    await vi.runAllTimersAsync();

    game.deck = [{ ...number, id: 1005 }];
    hit(game, "a", random);
    expect(game.phase).toBe("roundOver");
    table.show(view(game));

    expect(table.shown.room?.phase).toBe("playing");
    expect(table.shown.roundPoints.get("a")).toBe(12);

    await vi.runAllTimersAsync();

    expect(table.shown.room?.phase).toBe("roundOver");
    expect(table.shown.roundPoints.get("a")).toBe(0);
  });

  it("reveals a 16-player opening deal in 2240 ms", async () => {
    const game = gameAtFirstTurn();
    const playerCount = 16;

    for (let index = 2; index < playerCount; index += 1) {
      addPlayer(game, `player-${index}`, `Player ${index}`, 1);
    }

    game.phase = "roundOver";
    game.deck = Array.from({ length: playerCount }, (_, index) => ({
      id: 2000 + index,
      kind: "number",
      value: 7,
    }));
    const before = view(game);
    nextRound(game, "a", random);
    const after = view(game);
    const table = playback();
    table.show(before);
    table.show(after);

    await vi.advanceTimersByTimeAsync(2239);
    expect(table.shown.actionsDisabled).toBeTruthy();
    expect(table.flights).toHaveLength(playerCount);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.shown).toMatchObject({ actionsDisabled: false, room: after });
    expect(
      table.flights.every(({ duration }) => duration === 140)
    ).toBeTruthy();
  });

  it("ends the pause after a reveal when a newer Room update deals a card", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    const second = { id: 1005, kind: "number", value: 4 } as const;
    table.show(view(game));
    game.deck = [second, number];
    hit(game, "a", random);
    table.show(view(game));

    await vi.advanceTimersToNextTimerAsync();
    expect(table.cues).toStrictEqual(["reveal"]);

    hit(game, "b", random);
    table.show(view(game));
    await vi.advanceTimersByTimeAsync(1);

    expect(table.flights.map(({ cardId }) => cardId)).toStrictEqual([
      number.id,
      second.id,
    ]);
  });

  it("keeps the pause after a reveal when an update without cards queues", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = view(game);
    table.show(afterHit);

    await vi.advanceTimersToNextTimerAsync();
    expect(table.cues).toStrictEqual(["reveal"]);
    expect(table.shown.actionsDisabled).toBeTruthy();

    const latest = {
      ...afterHit,
      settings: { ...afterHit.settings, botSpeed: "fast" },
    } satisfies RoomView;

    table.show(latest);
    await vi.advanceTimersByTimeAsync(1);
    expect(table.shown.actionsDisabled).toBeTruthy();

    await vi.runAllTimersAsync();
    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: true,
      room: latest,
    });
    expect(table.cues).toStrictEqual(["reveal", "turn"]);
  });

  it("hurries a deal only while updates with cards wait behind it", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [number, freeze];
    hit(game, "a", random);
    table.show(view(game));
    choose(game, "a", "a", random);
    table.show(view(game));
    table.show({
      ...view(game),
      settings: { ...game.settings, locked: true },
    });
    hit(game, "b", random);

    const finalRoom = view(game);
    table.show(finalRoom);

    await vi.runAllTimersAsync();

    expect(table.flights).toStrictEqual([
      { cardId: freeze.id, duration: 280 },
      { cardId: freeze.id, duration: 140 },
      { cardId: number.id, duration: 280 },
    ]);
    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: false,
      room: finalRoom,
    });
    expect(table.cues).not.toContain("turn");
  });

  it("doesn't hurry a deal for an update without cards", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    table.show(view(game));
    choose(game, "a", "a", random);
    table.show(view(game));
    table.show({
      ...view(game),
      settings: { ...game.settings, botSpeed: "fast" },
    });

    await vi.runAllTimersAsync();

    expect(table.flights).toStrictEqual([
      { cardId: freeze.id, duration: 280 },
      { cardId: freeze.id, duration: 280 },
    ]);
  });

  it("catches up to a queued choice when motion is disabled mid-flight", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    table.show(view(game));
    game.deck = [freeze, number];
    hit(game, "a", random);
    table.show(view(game));
    hit(game, "b", random);
    const latest = view(game);
    table.show(latest);
    expect(table.shown.roundPoints.get("a")).toBe(5);

    table.setMotion(false);
    expect(table.shown).toStrictEqual({
      actionsDisabled: false,
      dealing: false,
      myMove: true,
      room: latest,
      roundPoints: new Map([
        ["a", 12],
        ["b", 3],
      ]),
      step: null,
    });
    expect([table.cues, table.readinessAtTurnCue]).toStrictEqual([
      ["turn"],
      [true],
    ]);

    const caughtUp = table.shown;
    await vi.runAllTimersAsync();
    expect(table.shown).toBe(caughtUp);
    expect({ flights: table.flights, cues: table.cues }).toStrictEqual({
      flights: [{ cardId: number.id, duration: 280 }],
      cues: ["turn"],
    });
  });

  it("resumes playback for a new update without reviving the canceled run", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    table.show(view(game));
    game.deck = [freeze, number];
    hit(game, "a", random);
    const afterHit = view(game);
    table.show(afterHit, false);
    table.setMotion(false);
    expect({ frame: table.shown, cues: table.cues }).toMatchObject({
      frame: { actionsDisabled: true, dealing: false, room: afterHit },
      cues: [],
    });

    table.show(afterHit);
    expect(table.cues).toStrictEqual(["turn"]);
    table.setMotion(true);
    hit(game, "b", random);
    const choice = view(game);
    table.show(choice);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      dealing: true,
      step: { card: freeze },
    });

    await vi.runAllTimersAsync();
    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      dealing: false,
      room: choice,
    });
    expect(table.cues).toStrictEqual(["turn", "reveal", "turn"]);
  });

  it("cues a fresh choice once across retries, rejoin and target changes", () => {
    const game = gameAtFirstTurn();
    const table = playback(false);
    const first = view(game);
    table.show(first, false);
    table.show(first);
    table.show(first, false);
    table.show({ ...first }, true);
    expect(table.cues).toStrictEqual(["turn"]);

    game.deck = [freeze];
    hit(game, "a", random);
    const choice = view(game);
    table.show(choice);
    const prompt = choice.choice;

    if (!prompt) {
      throw new Error("Expected a choice after drawing Freeze");
    }

    table.show({ ...choice, choice: { ...prompt, options: ["b"] } });

    expect(table.cues).toStrictEqual(["turn", "reveal", "turn"]);
    expect(table.flights).toStrictEqual([]);
  });

  it("finishes a deal during a disconnect and cues the new move when ready", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = view(game);
    table.show(afterHit);
    table.show(afterHit, false);
    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      dealing: false,
      myMove: false,
      room: afterHit,
    });
    expect(table.cues).toStrictEqual(["reveal"]);

    table.show({ ...afterHit });

    expect(table.cues).toStrictEqual(["reveal", "turn"]);
    expect(table.shown.myMove).toBeTruthy();
  });

  it("cues a fresh turn when the Room is waiting on the same player again", () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    choose(game, "a", "b", random);
    const table = playback(false);
    table.show(view(game));

    game.deck = [number];
    hit(game, "a", random);
    table.show(view(game));

    expect(table.shown.myMove).toBeTruthy();
    expect(table.cues).toStrictEqual(["turn", "reveal", "turn"]);
  });

  it("allows the host to move for an offline player without a personal cue", () => {
    const game = gameAtFirstTurn();
    game.deck = [number];
    hit(game, "a", random);
    const room = view(game);
    const offlinePlayer = room.players.find((player) => player.id === "b");

    if (!offlinePlayer) {
      throw new Error("Expected Ben in the Room");
    }

    offlinePlayer.connected = false;
    const table = playback(false);
    table.show(room);

    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: false,
    });
    expect(table.cues).toStrictEqual([]);
  });

  it("shows a result immediately when the draw history is incomplete", () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = { ...view(game), dealHistory: [] };
    table.show(afterHit);

    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      dealing: false,
      myMove: true,
      room: afterHit,
    });
    expect(table.flights).toStrictEqual([]);
    expect(table.cues).toStrictEqual(["reveal", "turn"]);
  });

  it("cancels a Flip Three lead-in and queued frames when the player leaves", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = view(game);

    const flip: RoomView = {
      ...afterHit,
      dealHistory: afterHit.dealHistory.map((draw) =>
        draw.type === "draw" && draw.card.id === number.id
          ? { ...draw, flip: { index: 1, total: 3 } }
          : draw
      ),
    };

    table.show(flip);
    table.show({ ...flip });

    expect(table.shown.step?.flip?.index).toBe(0);

    table.update(null);
    await vi.runAllTimersAsync();

    expect(table.shown).toStrictEqual(initialDealPlayback);
    expect(table.flights).toStrictEqual([]);
    expect(table.cues).toStrictEqual([]);
  });

  it("cancels an airborne card and starts a new Room without old cues", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    table.show(view(game));
    expect(table.flights).toMatchObject([{ cardId: freeze.id }]);

    const newRoom = { ...view(gameAtFirstTurn()), code: "FGHJK" };
    table.show(newRoom);
    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      dealing: false,
      myMove: true,
      room: newRoom,
    });
    expect(table.cues).toStrictEqual(["turn"]);
  });
});

type StateMessage = Extract<ServerMessage, { type: "state" }>;

const moveOn = (game: GameState) => {
  const hostId = game.hostId ?? "";

  if (game.phase === "roundOver") {
    nextRound(game, hostId, random);
  } else if (game.phase === "gameOver") {
    startGame(game, hostId, random);
  } else if (game.choice) {
    choose(game, game.choice.chooserId, game.choice.options[0] ?? "", random);
  } else if (game.turnId !== null) {
    hit(game, game.turnId, random);
  }
};

const browserCopy = () => {
  let lists = NO_LISTS;

  return {
    receive: (message: StateMessage) => {
      const overTheWire = parseServerMessage(JSON.stringify(message));

      if (overTheWire?.type !== "state") {
        throw new Error("Could not read the Room update");
      }

      const received = receiveState(lists, overTheWire);
      ({ lists } = received);

      expect(received.gaps).toStrictEqual([]);

      return received.room;
    },
    reconnect: () => {
      lists = NO_LISTS;
    },
  };
};

describe("Deal playback from history sent as new entries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the same deals as full history across a reconnect, new rounds and a new game", async () => {
    const game = createGame();
    addPlayer(game, "a", "Ada", 1);
    addPlayer(game, "b", "Ben", 1);
    addPlayer(game, "c", "Cat", 1);

    const full = playback(true, "b");
    const sent = playback(true, "b");
    const browser = browserCopy();
    let broadcastSeqs: ListSeqs | undefined;
    let online = true;

    const broadcast = async () => {
      const message = toStateMessage("ABCDE", game, broadcastSeqs);
      broadcastSeqs = listSeqsOf(game);

      if (!online) {
        return;
      }

      full.show(view(game));
      sent.show(browser.receive(message));
      await vi.runAllTimersAsync();
    };

    const reconnect = async () => {
      online = true;
      browser.reconnect();
      full.show(view(game));
      sent.show(browser.receive(toStateMessage("ABCDE", game)));
      await vi.runAllTimersAsync();
    };

    full.show(view(game));
    sent.show(browser.receive(toStateMessage("ABCDE", game)));
    startGame(game, "a", random);
    await broadcast();

    const seen = new Set<string>();

    for (let move = 0; move < 400 && game.games < 2; move += 1) {
      if (move === 6) {
        online = false;
      }

      if (move === 9) {
        await reconnect();
      }

      if (game.phase === "roundOver" && game.round >= 3) {
        game.phase = "gameOver";
      }

      moveOn(game);
      seen.add(`${game.games}:${game.round}`);
      await broadcast();
    }

    for (let move = 0; move < 6; move += 1) {
      moveOn(game);
      await broadcast();
    }

    expect({
      games: game.games,
      manyDeals: full.flights.length > DEAL_HISTORY_LIMIT,
      pastHistoryLimit: game.dealSeq > DEAL_HISTORY_LIMIT,
      rounds: seen.size >= 4,
    }).toStrictEqual({
      games: 2,
      manyDeals: true,
      pastHistoryLimit: true,
      rounds: true,
    });
    expect({
      cues: sent.cues,
      flights: sent.flights,
      shown: sent.shown,
      steps: sent.steps,
    }).toStrictEqual({
      cues: full.cues,
      flights: full.flights,
      shown: full.shown,
      steps: full.steps,
    });
  });
});
