import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPlayer,
  choose,
  createGame,
  hit,
  nextRound,
  startGame,
} from "../game/engine";
import type { GameState } from "../game/engine";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { createDealPlayback, initialDealPlayback } from "./deal-playback";
import type { DealMotion } from "./deal-playback";
import type { RoomCue } from "./room-cues";

const random = () => 0.5;
const freeze = { id: 1003, kind: "freeze" } as const;
const number = { id: 1004, kind: "number", value: 7 } as const;
const view = (game: GameState) => structuredClone(toRoomView("ABCDE", game));

const gameAtFirstTurn = () => {
  const game = createGame();
  addPlayer(game, "a", "Ada");
  addPlayer(game, "b", "Ben");
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
  const cues: RoomCue[] = [];
  const readinessAtTurnCue: boolean[] = [];
  const flights: { cardId: number; duration: number }[] = [];

  const motion: DealMotion = {
    allowed: () => animate,
    captureFlight: (step, duration) => async (signal) => {
      flights.push({ cardId: step.card.id, duration });
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
    }
  );

  return {
    ...instance,
    cues,
    flights,
    readinessAtTurnCue,
    show: (room: RoomView, canAct = true) => {
      instance.update({ canAct, playerId, room });
    },
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
        incomingCardId: freeze.id,
        myMove: false,
        room: { choice: { card: freeze } },
      },
      cues: [],
    });

    await vi.advanceTimersToNextTimerAsync();

    expect(table.shown).toMatchObject({
      actionsDisabled: true,
      incomingCardId: null,
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

  it("hurries queued updates and skips the cue for a superseded choice", async () => {
    const game = gameAtFirstTurn();
    const table = playback();
    table.show(view(game), false);
    game.deck = [freeze];
    hit(game, "a", random);
    table.show(view(game));
    choose(game, "a", "a", random);
    table.show(view(game));

    const finalRoom = view(game);
    table.show(finalRoom);

    await vi.runAllTimersAsync();

    expect(table.flights).toStrictEqual([
      { cardId: freeze.id, duration: 460 },
      { cardId: freeze.id, duration: 220 },
    ]);
    expect(table.shown).toMatchObject({
      actionsDisabled: false,
      myMove: false,
      room: finalRoom,
    });
    expect(table.cues).not.toContain("turn");
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
    const afterHit = { ...view(game), draws: [] };
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
      draws: afterHit.draws.map((draw) =>
        draw.card.id === number.id
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
    expect(table.shown.incomingCardId).toBe(freeze.id);

    const newRoom = { ...view(gameAtFirstTurn()), code: "FGHJK" };
    table.show(newRoom);
    await vi.runAllTimersAsync();

    expect(table.shown).toMatchObject({
      dealing: false,
      incomingCardId: null,
      myMove: true,
      room: newRoom,
    });
    expect(table.cues).toStrictEqual(["turn"]);
  });
});
