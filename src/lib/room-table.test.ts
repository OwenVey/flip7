/* oxlint-disable eslint/no-await-in-loop -- Room updates reach playback one at a time, in order. */

import { createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
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
  toStateMessage,
} from "../game/protocol";
import type { ListSeqs, RoomView, StateMessage } from "../game/protocol";
import { gameAtFirstTurn, random, view } from "../test/deal-game";
import type { DealStep } from "./deal-plan";
import { initialDealPlayback } from "./deal-playback";
import type { DealMotion } from "./deal-playback";
import type { RoomCue } from "./room-cues";
import { turnYieldsToOutcome } from "./room-haptics";
import type { RoomHapticCue } from "./room-haptics";
import { createRoomTable } from "./room-table";
import type { RoomTablePage } from "./room-table";

const freeze = { id: 1003, kind: "freeze" } as const;
const number = { id: 1004, kind: "number", value: 7 } as const;

const wait = async (ms: number, signal: AbortSignal) => {
  if (ms <= 0) {
    return;
  }

  const { promise, resolve } = Promise.withResolvers<undefined>();

  const done = () => {
    resolve(undefined);
  };

  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
  await promise;
  clearTimeout(timer);
  signal.removeEventListener("abort", done);
};

const playback = (
  animate = true,
  playerId = "a",
  delays: { landMs?: number; reshuffleMs?: number } = {}
) => {
  let motionEnabled = animate;
  let reshuffles = 0;
  const cues: RoomCue[] = [];
  const haptics: RoomHapticCue[] = [];
  const readinessAtTurnCue: boolean[] = [];
  const flights: { cardId: number; duration: number }[] = [];
  const lands: number[] = [];
  const steps: DealStep[] = [];

  const motion: DealMotion = {
    allowed: () => motionEnabled,
    captureFlight: (step, duration) => async (signal) => {
      flights.push({ cardId: step.card.id, duration });
      steps.push(step);
      await wait(duration, signal);
    },
    land: async (step, _discardDuration, signal) => {
      lands.push(step.card.id);
      await wait(delays.landMs ?? 0, signal);
    },
    reshuffle: async (signal) => {
      reshuffles += 1;
      await wait(delays.reshuffleMs ?? 0, signal);
    },
    sweep: async () => {},
  };

  const [confirmed, setConfirmed] = createSignal<{
    canAct: boolean;
    room: RoomView | null;
    syncId: number;
  }>({ canAct: false, room: null, syncId: 0 });

  const [tabHidden, setTabHidden] = createSignal(false);
  let visibleNow = true;
  let motionChanged: (() => void) | null = null;

  const playHaptic = turnYieldsToOutcome((cue) => {
    haptics.push(cue);
  });

  const page: RoomTablePage = {
    isVisibleNow: () => visibleNow,
    motion,
    nudge: () => {
      readinessAtTurnCue.push(
        untrack(() => roomTable.alerting() && !roomTable.view().actionsDisabled)
      );
    },
    onMotionChange: (listener) => {
      motionChanged = listener;

      return () => {
        motionChanged = null;
      };
    },
    rendered: () => {},
    tabHidden,
  };

  const { roomTable, shown } = createRoot(() => {
    const table = createRoomTable({
      code: "ABCDE",
      haptic: playHaptic,
      page,
      sound: (cue) => {
        cues.push(cue);
      },
      source: {
        canAct: () => confirmed().canAct,
        playerId: () => playerId,
        room: () => confirmed().room,
        status: () => "open",
        syncId: () => confirmed().syncId,
        watching: () => false,
      },
    });

    return {
      roomTable: table,
      shown: createMemo(() => ({
        ...table.view(),
        myMove: table.alerting(),
      })),
    };
  });

  flush();

  return {
    cues,
    flights,
    haptics,
    lands,
    readinessAtTurnCue,
    get reshuffles() {
      return reshuffles;
    },
    setMotion: (enabled: boolean) => {
      motionEnabled = enabled;
      motionChanged?.();
    },
    show: async (
      room: RoomView,
      canAct = true,
      syncId = 1,
      hapticsVisible = true,
      reportedVisible = hapticsVisible
    ) => {
      visibleNow = hapticsVisible;
      setTabHidden(!reportedVisible);
      setConfirmed({ canAct, room, syncId });
      flush();
      await Promise.resolve();
    },
    leave: async () => {
      setConfirmed({ canAct: false, room: null, syncId: 1 });
      flush();
      await Promise.resolve();
    },
    steps,
    get shown() {
      return shown();
    },
  };
};

describe(createRoomTable, () => {
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

    await ownTable.show(view(game));
    await otherTable.show(view(game));
    await reducedTable.show(view(game));
    choose(game, "a", "a", random);
    const afterFlip = view(game);
    await ownTable.show(afterFlip);
    await otherTable.show(afterFlip);
    await reducedTable.show(afterFlip);

    expect(ownTable.haptics).toStrictEqual([]);
    expect(reducedTable.haptics).toStrictEqual(["bust"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(ownTable.haptics).toStrictEqual(["flipThree"]);
    await vi.runAllTimersAsync();
    expect(ownTable.haptics).toStrictEqual(["flipThree", "bust"]);
    expect(otherTable.haptics).toStrictEqual(["turn"]);
  });

  it("gives a Second Chance save priority over a move alert in the same frame", async () => {
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
    await table.show(view(game));
    game.deck = [{ ...number, id: 1006 }];
    hit(game, "a", random);
    await table.show(view(game));

    expect(table.shown.myMove).toBeTruthy();
    expect(table.haptics).toStrictEqual(["saved"]);
  });

  it("lets Freeze settle before alerting the next player in a two-player game", async () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    const table = playback(true, "b");
    await table.show(view(game));

    choose(game, "a", "a", random);
    const frozen = view(game);
    await table.show(frozen);
    await vi.advanceTimersByTimeAsync(320);

    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      myMove: false,
      room: frozen,
    });
    expect({ cues: table.cues, haptics: table.haptics }).toStrictEqual({
      cues: ["reveal", "freeze"],
      haptics: [],
    });

    await table.show({ ...frozen, spectatorCount: 1 });
    await vi.advanceTimersByTimeAsync(519);
    expect(table.cues).toStrictEqual(["reveal", "freeze"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: true,
      room: { spectatorCount: 1 },
    });
    expect({ cues: table.cues, haptics: table.haptics }).toStrictEqual({
      cues: ["reveal", "freeze", "turn"],
      haptics: ["turn"],
    });
  });

  it("celebrates a winning Flip 7 once even when reported visibility lags", async () => {
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
    await table.show(view(game));
    await otherTable.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    await table.show(view(game), true, 1, true, false);
    await otherTable.show(view(game));

    expect(table.shown.room?.winnerIds).toStrictEqual(["a"]);
    expect(table.haptics).toStrictEqual(["celebrate"]);
    expect(otherTable.haptics).toStrictEqual([]);
  });

  it("keeps initial, reconnecting and hidden move alerts quiet", async () => {
    const game = gameAtFirstTurn();
    const table = playback(false);
    await table.show(view(game));
    expect({
      haptics: table.haptics,
      myMove: table.shown.myMove,
    }).toStrictEqual({ haptics: [], myMove: true });

    game.deck = [freeze];
    hit(game, "a", random);
    await table.show(view(game), true, 2);
    expect(table.shown.myMove).toBeTruthy();
    expect(table.haptics).toStrictEqual([]);

    choose(game, "a", "b", random);
    await table.show(view(game), true, 2, false);
    await table.show(view(game), true, 2);
    expect({
      haptics: table.haptics,
      myMove: table.shown.myMove,
    }).toStrictEqual({ haptics: [], myMove: true });

    game.deck = [number];
    hit(game, "a", random);
    await table.show(view(game), true, 2);
    expect(table.haptics).toStrictEqual(["turn"]);
  });

  it.each([true, false])(
    "plays one normal reveal for keeping a Second Chance with motion %s",
    async (animate) => {
      const game = gameAtFirstTurn();
      const table = playback(animate, "b");
      await table.show(view(game));
      game.deck = [{ id: 1006, kind: "secondChance" }];
      hit(game, "a", random);
      await table.show(view(game));
      await vi.runAllTimersAsync();

      expect(table.cues).toStrictEqual(["reveal", "turn"]);
    }
  );

  it("reveals a landed choice before cueing its usable move", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    await table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    const choice = view(game);
    await table.show(choice);

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
    await table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    await table.show(view(game));

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
    await table.show(view(game));
    await vi.runAllTimersAsync();

    game.deck = [{ ...number, id: 1005 }];
    hit(game, "a", random);
    expect(game.phase).toBe("roundOver");
    await table.show(view(game));

    expect(table.shown.room?.phase).toBe("playing");
    expect(table.shown.roundPoints.get("a")).toBe(12);

    await vi.runAllTimersAsync();

    expect(table.shown.room?.phase).toBe("roundOver");
    expect(table.shown.roundPoints.get("a")).toBe(0);
  });

  it("reveals a 16-player opening deal in 2380 ms", async () => {
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
    await table.show(before);
    await table.show(after);

    await vi.advanceTimersByTimeAsync(2379);
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
    await table.show(view(game));
    game.deck = [second, number];
    hit(game, "a", random);
    await table.show(view(game));

    await vi.advanceTimersToNextTimerAsync();
    expect(table.cues).toStrictEqual(["reveal"]);

    hit(game, "b", random);
    await table.show(view(game));
    await vi.advanceTimersByTimeAsync(1);

    expect(table.flights.map(({ cardId }) => cardId)).toStrictEqual([
      number.id,
      second.id,
    ]);
  });

  it("keeps the pause after a reveal when an update without cards queues", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    await table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = view(game);
    await table.show(afterHit);

    await vi.advanceTimersToNextTimerAsync();
    expect(table.cues).toStrictEqual(["reveal"]);
    expect(table.shown.actionsDisabled).toBeTruthy();

    const latest = {
      ...afterHit,
      settings: { ...afterHit.settings, botSpeed: "fast" },
    } satisfies RoomView;

    await table.show(latest);
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
    await table.show(view(game), false);
    game.deck = [number, freeze];
    hit(game, "a", random);
    await table.show(view(game));
    choose(game, "a", "a", random);
    await table.show(view(game));
    await table.show({
      ...view(game),
      settings: { ...game.settings, locked: true },
    });
    hit(game, "b", random);

    const finalRoom = view(game);
    await table.show(finalRoom);

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
    await table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    await table.show(view(game));
    choose(game, "a", "a", random);
    await table.show(view(game));
    await table.show({
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
    await table.show(view(game));
    game.deck = [freeze, number];
    hit(game, "a", random);
    await table.show(view(game));
    hit(game, "b", random);
    const latest = view(game);
    await table.show(latest);
    expect(table.shown.roundPoints.get("a")).toBe(5);

    table.setMotion(false);
    expect(table.shown).toStrictEqual({
      actionsDisabled: false,
      dealing: false,
      moment: null,
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
    await table.show(view(game));
    game.deck = [freeze, number];
    hit(game, "a", random);
    const afterHit = view(game);
    await table.show(afterHit, false);
    table.setMotion(false);
    expect({ frame: table.shown, cues: table.cues }).toMatchObject({
      frame: { actionsDisabled: true, dealing: false, room: afterHit },
      cues: [],
    });

    await table.show(afterHit);
    expect(table.cues).toStrictEqual(["turn"]);
    table.setMotion(true);
    hit(game, "b", random);
    const choice = view(game);
    await table.show(choice);

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
    expect(table.cues).toStrictEqual(["turn", "reveal"]);
  });

  it("keeps the Freeze choice quiet across retries, rejoin and target changes", async () => {
    const game = gameAtFirstTurn();
    const table = playback(false);
    const first = view(game);
    await table.show(first, false);
    await table.show(first);
    await table.show(first, false);
    await table.show({ ...first }, true);
    expect(table.cues).toStrictEqual(["turn"]);

    game.deck = [freeze];
    hit(game, "a", random);
    const choice = view(game);
    await table.show(choice);
    const prompt = choice.choice;

    if (!prompt) {
      throw new Error("Expected a choice after drawing Freeze");
    }

    await table.show({ ...choice, choice: { ...prompt, options: ["b"] } });

    expect(table.shown.myMove).toBeTruthy();
    expect(table.readinessAtTurnCue).toStrictEqual([true, true]);
    expect(table.cues).toStrictEqual(["turn", "reveal"]);
    expect(table.flights).toStrictEqual([]);
  });

  it("finishes a deal during a disconnect and cues the new move when ready", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    await table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = view(game);
    await table.show(afterHit);
    await table.show(afterHit, false);
    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      dealing: false,
      myMove: false,
      room: afterHit,
    });
    expect(table.cues).toStrictEqual(["reveal"]);

    await table.show({ ...afterHit });

    expect(table.cues).toStrictEqual(["reveal", "turn"]);
    expect(table.shown.myMove).toBeTruthy();
  });

  it("keeps successive Hits quiet when the same player remains active", async () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    choose(game, "a", "b", random);
    const table = playback(false);
    await table.show(view(game));

    game.deck = [number];
    hit(game, "a", random);
    await table.show(view(game));
    game.deck = [{ id: 1005, kind: "number", value: 8 }];
    hit(game, "a", random);
    await table.show(view(game));

    expect(table.shown.myMove).toBeTruthy();
    expect(table.cues).toStrictEqual(["turn", "reveal", "reveal"]);
  });

  it("allows the host to move for an offline player without a personal cue", async () => {
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
    await table.show(room);

    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: false,
    });
    expect(table.cues).toStrictEqual([]);
  });

  it("shows a result immediately when the draw history is incomplete", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    await table.show(view(game));
    game.deck = [number];
    hit(game, "a", random);
    const afterHit = { ...view(game), dealHistory: [] };
    await table.show(afterHit);

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
    await table.show(view(game), false);
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

    await table.show(flip);
    await table.show({ ...flip });

    expect(table.shown.step?.flip?.index).toBe(0);

    await table.leave();
    await vi.runAllTimersAsync();

    expect(table.shown).toStrictEqual({
      ...initialDealPlayback,
      myMove: false,
    });
    expect(table.flights).toStrictEqual([]);
    expect(table.cues).toStrictEqual([]);
  });

  it("cancels an airborne card and starts a new Room without old cues", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    await table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    await table.show(view(game));
    expect(table.flights).toMatchObject([{ cardId: freeze.id }]);

    const newRoom = { ...view(gameAtFirstTurn()), code: "FGHJK" };
    await table.show(newRoom);
    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      dealing: false,
      myMove: true,
      room: newRoom,
    });
    expect(table.cues).toStrictEqual(["turn"]);
  });

  it("lets Flip 7 celebrate before opening gameOver and fires win afterward", async () => {
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

    const winner = playback();
    const loser = playback(true, "b");
    await winner.show(view(game));
    await loser.show(view(game));
    winner.cues.length = 0;

    game.deck = [number];
    hit(game, "a", random);
    const over = view(game);
    await winner.show(over);
    await loser.show(over);

    await vi.advanceTimersByTimeAsync(320);
    expect({
      dealing: winner.shown.dealing,
      haptics: winner.haptics,
      loserCues: loser.cues,
      moment: winner.shown.moment,
      winnerCues: winner.cues,
    }).toStrictEqual({
      dealing: true,
      haptics: ["celebrate"],
      loserCues: ["reveal", "flipSeven"],
      moment: { kind: "flipSeven", playerId: "a" },
      winnerCues: ["reveal", "flipSeven"],
    });

    await vi.advanceTimersByTimeAsync(1399);
    expect(winner.cues).toStrictEqual(["reveal", "flipSeven"]);

    await vi.advanceTimersByTimeAsync(1);
    expect({
      dealing: winner.shown.dealing,
      haptics: winner.haptics,
      loserCues: loser.cues,
      moment: winner.shown.moment,
      winnerCues: winner.cues,
    }).toStrictEqual({
      dealing: false,
      haptics: ["celebrate"],
      loserCues: ["reveal", "flipSeven", "lose"],
      moment: null,
      winnerCues: ["reveal", "flipSeven", "win"],
    });
  });

  it("lets Bust settle before alerting the next player", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    await table.show(view(game));

    game.deck = [{ id: 1005, kind: "number", value: 5 }];
    hit(game, "a", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(320);
    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      moment: table.shown.moment,
      myMove: table.shown.myMove,
    }).toStrictEqual({
      cues: ["reveal", "bust"],
      dealing: true,
      moment: { kind: "bust", playerId: "a" },
      myMove: false,
    });

    await vi.advanceTimersByTimeAsync(639);
    expect(table.cues).toStrictEqual(["reveal", "bust"]);

    await vi.advanceTimersByTimeAsync(1);
    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      moment: table.shown.moment,
      myMove: table.shown.myMove,
    }).toStrictEqual({
      cues: ["reveal", "bust", "turn"],
      dealing: false,
      moment: null,
      myMove: true,
    });
  });

  it("paces consecutive Stays sequentially instead of stacking bank cues", async () => {
    const game = gameAtFirstTurn();
    addPlayer(game, "c", "Cat", 1);
    game.phase = "roundOver";
    game.round = 0;
    game.dealerIndex = 1;
    game.deck = [
      { id: 1003, kind: "number", value: 4 },
      { id: 1002, kind: "number", value: 3 },
      { id: 1001, kind: "number", value: 5 },
    ];
    nextRound(game, "a", random);

    const table = playback(true, "c");
    await table.show(view(game));

    stay(game, "a", random);
    await table.show(view(game));
    stay(game, "b", random);
    await table.show(view(game));

    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      moment: table.shown.moment,
    }).toStrictEqual({
      cues: ["bank"],
      dealing: true,
      moment: { kind: "stay", playerId: "a", points: 5 },
    });

    await vi.advanceTimersByTimeAsync(460);
    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      moment: table.shown.moment,
    }).toStrictEqual({
      cues: ["bank", "bank"],
      dealing: true,
      moment: { kind: "stay", playerId: "b", points: 3 },
    });

    await vi.advanceTimersByTimeAsync(460);
    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      moment: table.shown.moment,
      myMove: table.shown.myMove,
    }).toStrictEqual({
      cues: ["bank", "bank", "turn"],
      dealing: false,
      moment: null,
      myMove: true,
    });
  });

  it("stops holding settle beats once Room updates pile up behind them", async () => {
    const game = gameAtFirstTurn();
    addPlayer(game, "c", "Cat", 1);
    addPlayer(game, "d", "Dev", 1);
    game.phase = "roundOver";
    game.round = 0;
    game.dealerIndex = 2;
    game.deck = [
      { id: 1004, kind: "number", value: 6 },
      { id: 1003, kind: "number", value: 4 },
      { id: 1002, kind: "number", value: 3 },
      { id: 1001, kind: "number", value: 5 },
    ];
    nextRound(game, "a", random);

    const table = playback(true, "d");
    await table.show(view(game));

    stay(game, "a", random);
    await table.show(view(game));
    stay(game, "b", random);
    await table.show(view(game));
    stay(game, "c", random);
    await table.show(view(game));
    await vi.advanceTimersByTimeAsync(0);

    expect({
      cues: table.cues,
      moment: table.shown.moment,
    }).toStrictEqual({
      cues: ["bank", "bank"],
      moment: { kind: "stay", playerId: "b", points: 3 },
    });

    await vi.advanceTimersByTimeAsync(460);
    expect(table.shown.moment).toStrictEqual({
      kind: "stay",
      playerId: "c",
      points: 4,
    });

    await vi.advanceTimersByTimeAsync(460);
    expect({
      cues: table.cues,
      moment: table.shown.moment,
      myMove: table.shown.myMove,
    }).toStrictEqual({
      cues: ["bank", "bank", "bank", "turn"],
      moment: null,
      myMove: true,
    });
  });

  it("holds a Second Chance duplicate, plays secondChance on discard, and keeps it in Flip Three", async () => {
    const game = gameAtFirstTurn();
    const [player] = game.players;

    if (player === undefined) {
      throw new Error("Expected Ada at the table");
    }

    player.hand.push({ id: 1005, kind: "secondChance" });
    const table = playback(true, "b");
    await table.show(view(game));

    game.deck = [{ id: 1006, kind: "number", value: 5 }];
    hit(game, "a", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(280);
    expect({ cues: table.cues, lands: table.lands }).toStrictEqual({
      cues: ["reveal"],
      lands: [],
    });

    await vi.advanceTimersByTimeAsync(320);
    expect({ cues: table.cues, lands: table.lands }).toStrictEqual({
      cues: ["reveal", "secondChance"],
      lands: [1006],
    });

    await vi.advanceTimersByTimeAsync(450);
    expect(table.cues).toStrictEqual(["reveal", "secondChance", "turn"]);

    const flipGame = gameAtFirstTurn();
    const [ada] = flipGame.players;

    if (ada === undefined) {
      throw new Error("Expected Ada at the table");
    }

    ada.hand.push({ id: 2005, kind: "secondChance" });
    flipGame.deck = [{ id: 2006, kind: "flipThree" }];
    hit(flipGame, "a", random);
    const flipTable = playback(true, "b");
    await flipTable.show(view(flipGame));

    flipGame.deck = [
      { id: 2009, kind: "number", value: 4 },
      { id: 2008, kind: "number", value: 4 },
      { id: 2007, kind: "number", value: 5 },
    ];
    choose(flipGame, "a", "a", random);
    await flipTable.show(view(flipGame));

    await vi.runAllTimersAsync();
    expect(flipTable.cues).toStrictEqual([
      "flipThree",
      "reveal",
      "secondChance",
      "reveal",
      "reveal",
      "bust",
      "turn",
    ]);
  });

  it("shuffles the deck before flying the next card and does not replay shuffle", async () => {
    const game = gameAtFirstTurn();
    game.discard = [number];
    game.deck = [];
    const table = playback(true, "b", { reshuffleMs: 480 });
    await table.show(view(game));

    hit(game, "a", random);
    await table.show(view(game));

    expect({
      cues: table.cues,
      flights: table.flights,
      moment: table.shown.moment,
      reshuffles: table.reshuffles,
    }).toStrictEqual({
      cues: ["shuffle"],
      flights: [],
      moment: { kind: "reshuffle" },
      reshuffles: 1,
    });

    await vi.advanceTimersByTimeAsync(479);
    expect(table.flights).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect({
      flights: table.flights,
      moment: table.shown.moment,
    }).toStrictEqual({
      flights: [{ cardId: number.id, duration: 280 }],
      moment: null,
    });

    await vi.runAllTimersAsync();
    expect(table.cues).toStrictEqual(["shuffle", "reveal", "turn"]);
  });

  it("plays flipThree when Flip Three activates and pauses before the first flip", async () => {
    const game = gameAtFirstTurn();
    const flipThree = { id: 1005, kind: "flipThree" } as const;
    game.deck = [flipThree];
    hit(game, "a", random);

    const table = playback(true, "b");
    await table.show(view(game));

    game.deck = [
      { id: 1008, kind: "number", value: 8 },
      { id: 1007, kind: "number", value: 6 },
      { id: 1006, kind: "number", value: 4 },
    ];
    choose(game, "a", "b", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(280);
    expect({ cues: table.cues, flights: table.flights }).toStrictEqual({
      cues: ["flipThree"],
      flights: [{ cardId: flipThree.id, duration: 280 }],
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(table.flights).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.flights).toHaveLength(2);

    await vi.runAllTimersAsync();
    expect(table.cues).toStrictEqual([
      "flipThree",
      "reveal",
      "reveal",
      "reveal",
      "turn",
    ]);
  });

  it("holds a non-local action card choice visible before a queued target flies", async () => {
    const game = gameAtFirstTurn();
    const table = playback(true, "b");
    await table.show(view(game));

    game.deck = [freeze];
    hit(game, "a", random);
    const choiceRoom = view(game);
    await table.show(choiceRoom);

    choose(game, "a", "b", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(280);
    expect({
      cues: table.cues,
      dealing: table.shown.dealing,
      flights: table.flights,
      room: table.shown.room,
    }).toStrictEqual({
      cues: ["reveal"],
      dealing: false,
      flights: [{ cardId: freeze.id, duration: 280 }],
      room: choiceRoom,
    });

    await vi.advanceTimersByTimeAsync(379);
    expect(table.flights).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.flights).toHaveLength(2);
  });

  it("settles a mid-batch Freeze, then discards a queued Flip Three without holding it", async () => {
    const game = gameAtFirstTurn();
    addPlayer(game, "c", "Cat", 1);
    game.phase = "roundOver";
    game.round = 0;
    game.dealerIndex = 1;
    const heldFreeze = { id: 1010, kind: "freeze" } as const;
    const heldFlip = { id: 1011, kind: "flipThree" } as const;
    game.deck = [
      { id: 1003, kind: "number", value: 8 },
      { id: 1002, kind: "number", value: 3 },
      { id: 1001, kind: "number", value: 5 },
    ];
    nextRound(game, "a", random);
    game.deck = [
      { id: 1012, kind: "number", value: 11 },
      heldFlip,
      heldFreeze,
      { id: 1009, kind: "number", value: 1 },
      { id: 1008, kind: "flipThree" },
    ];
    hit(game, "a", random);
    choose(game, "a", "c", random);
    choose(game, "c", "b", random);

    const table = playback(true, "a");
    await table.show(view(game));

    choose(game, "c", "b", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(320);
    expect({
      benStatus: table.shown.room?.players[1]?.status,
      cues: table.cues,
      flights: table.flights,
      lands: table.lands,
      moment: table.shown.moment,
    }).toStrictEqual({
      benStatus: "frozen",
      cues: ["reveal", "freeze"],
      flights: [{ cardId: heldFreeze.id, duration: 280 }],
      lands: [heldFreeze.id],
      moment: { byId: "c", kind: "freeze", playerId: "b" },
    });

    await vi.advanceTimersByTimeAsync(519);
    expect(table.flights).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(table.flights).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(280);
    expect({ cues: table.cues, lands: table.lands }).toStrictEqual({
      cues: ["reveal", "freeze", "reveal"],
      lands: [heldFreeze.id, heldFlip.id],
    });
  });

  it("holds an extra Second Chance before discarding and settles a Second Chance gift", async () => {
    const game = gameAtFirstTurn();
    const [ada, ben] = game.players;

    if (!(ada && ben)) {
      throw new Error("Expected Ada and Ben at the table");
    }

    ada.hand.push({ id: 1005, kind: "secondChance" });
    ben.hand.push({ id: 1006, kind: "secondChance" });

    const table = playback(true, "b");
    await table.show(view(game));
    game.deck = [{ id: 1007, kind: "secondChance" }];
    hit(game, "a", random);
    await table.show(view(game));

    await vi.advanceTimersByTimeAsync(280);
    expect({ cues: table.cues, lands: table.lands }).toStrictEqual({
      cues: ["reveal"],
      lands: [],
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(table.lands).toStrictEqual([1007]);

    const giftGame = gameAtFirstTurn();
    const [giftAda] = giftGame.players;

    if (!giftAda) {
      throw new Error("Expected Ada at the table");
    }

    giftAda.hand.push({ id: 2005, kind: "secondChance" });
    const giftTable = playback(true, "b");
    await giftTable.show(view(giftGame));
    giftGame.deck = [{ id: 2006, kind: "secondChance" }];
    hit(giftGame, "a", random);
    await giftTable.show(view(giftGame));

    await vi.advanceTimersByTimeAsync(320);
    expect({
      cues: giftTable.cues,
      moment: giftTable.shown.moment,
    }).toStrictEqual({
      cues: ["reveal"],
      moment: { kind: "secondChanceGiven", playerId: "b" },
    });

    await vi.advanceTimersByTimeAsync(320);
    expect(giftTable.cues).toStrictEqual(["reveal", "turn"]);
  });

  it("lets Freeze settle before playing the gameOver finale", async () => {
    const game = gameAtFirstTurn();
    const [ada] = game.players;

    if (!ada) {
      throw new Error("Expected Ada at the table");
    }

    ada.score = game.settings.targetScore;
    stay(game, "a", random);

    const winner = playback(true, "a");
    const loser = playback(true, "b");
    await winner.show(view(game));
    await loser.show(view(game));
    loser.cues.length = 0;

    game.deck = [freeze];
    hit(game, "b", random);
    const over = view(game);
    await winner.show(over);
    await loser.show(over);

    await vi.advanceTimersByTimeAsync(320);
    expect({
      dealing: winner.shown.dealing,
      loserCues: loser.cues,
      moment: winner.shown.moment,
      winnerCues: winner.cues,
    }).toStrictEqual({
      dealing: true,
      loserCues: ["reveal", "freeze"],
      moment: { byId: "b", kind: "freeze", playerId: "b" },
      winnerCues: ["reveal", "freeze"],
    });

    await vi.advanceTimersByTimeAsync(520);
    expect({
      dealing: winner.shown.dealing,
      loserCues: loser.cues,
      moment: winner.shown.moment,
      winnerCues: winner.cues,
    }).toStrictEqual({
      dealing: false,
      loserCues: ["reveal", "freeze", "lose"],
      moment: null,
      winnerCues: ["reveal", "freeze", "win"],
    });
  });
});

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

      await full.show(view(game));
      await sent.show(browser.receive(message));
      await vi.runAllTimersAsync();
    };

    const reconnect = async () => {
      online = true;
      browser.reconnect();
      await full.show(view(game));
      await sent.show(browser.receive(toStateMessage("ABCDE", game)));
      await vi.runAllTimersAsync();
    };

    await full.show(view(game));
    await sent.show(browser.receive(toStateMessage("ABCDE", game)));
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
