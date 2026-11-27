import { describe, expect, it } from "vitest";

import { addPlayer, createGame } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { eventCue, readRoomFeedback } from "./room-cues";

const LOGGED_AT = Date.now();

const game = createGame();

addPlayer(game, "me", "Me", 1);

addPlayer(game, "opponent", "Opp", 1);

const before: RoomView = {
  ...toRoomView("ABCDE", game),
  drawSeq: 10,
  log: [
    {
      at: LOGGED_AT,
      event: {
        by: { kind: "player" },
        player: { id: "me", name: "Me" },
        points: 5,
        type: "stayed",
      },
      game: 1,
      id: 7,
      round: 1,
    },
  ],
  phase: "playing",
  round: 1,
  turnId: "opponent",
};

describe(readRoomFeedback, () => {
  it("reports a newly revealed card", () => {
    expect(
      readRoomFeedback(before, { ...before, drawSeq: 11, turnId: "me" }, "me")
        .table
    ).toBe("reveal");
    expect(
      readRoomFeedback(
        before,
        { ...before, drawSeq: 11, turnId: "me" },
        "opponent"
      ).table
    ).toBe("reveal");
  });

  it("does not replay cues when the same room state is broadcast again", () => {
    expect(readRoomFeedback(before, { ...before }, "me")).toStrictEqual({
      chat: null,
      events: [],
      finale: null,
      table: null,
    });
  });

  it("prioritizes a bust over a reveal and a win over a bust", () => {
    const bust: RoomView = {
      ...before,
      drawSeq: 11,
      log: [
        ...before.log,
        {
          at: LOGGED_AT,
          event: {
            card: 4,
            player: { id: "opponent", name: "Opp" },
            type: "busted",
          },
          game: 1,
          id: 8,
          round: 1,
        },
      ],
    };

    expect(readRoomFeedback(before, bust, "me").table).toBe("bust");
    expect(
      readRoomFeedback(
        before,
        { ...bust, phase: "gameOver", winnerIds: ["me"] },
        "me"
      )
    ).toMatchObject({ finale: "win", table: null });
  });

  it.each([
    { player: { id: "me", name: "Me" }, type: "secondChanceKept" },
    {
      by: { id: "opponent", name: "Opp" },
      target: { id: "me", name: "Me" },
      type: "secondChanceGiven",
    },
    {
      by: { id: "opponent", name: "Opp" },
      card: "freeze",
      target: { id: "me", name: "Me" },
      type: "actionAssigned",
    },
  ] satisfies GameEvent[])(
    "uses the normal reveal sound for $type",
    (event) => {
      const after: RoomView = {
        ...before,
        log: [
          ...before.log,
          { at: LOGGED_AT, event, game: 1, id: 8, round: 1 },
        ],
      };

      expect(readRoomFeedback(before, after, "me").table).toBe("reveal");
    }
  );

  it("plays the losing cue only at a seat that did not win", () => {
    const over: RoomView = {
      ...before,
      phase: "gameOver",
      winnerIds: ["opponent"],
    };

    expect({
      loser: readRoomFeedback(before, over, "me").finale,
      spectator: readRoomFeedback(before, over, null).finale,
      winner: readRoomFeedback(before, over, "opponent").finale,
    }).toStrictEqual({ loser: "lose", spectator: "win", winner: "win" });
  });

  it("plays a message sound for other players' chat, not your own", () => {
    const chat: RoomView = {
      ...before,
      log: [
        ...before.log,
        {
          at: LOGGED_AT,
          from: { avatar: 1, id: "opponent", name: "Opp" },
          game: 1,
          id: 8,
          round: 1,
          text: "gl",
        },
      ],
    };

    expect(readRoomFeedback(before, chat, "me").chat).toBe("message");
    expect(readRoomFeedback(before, chat, "opponent").chat).toBeNull();
  });
});

describe(eventCue, () => {
  const me = { id: "me", name: "Me" };
  const opp = { id: "opponent", name: "Opp" };

  it.each([
    [{ by: { kind: "player" }, player: me, points: 5, type: "stayed" }, "bank"],
    [{ by: { kind: "game" }, player: me, points: 5, type: "stayed" }, "bank"],
    [
      {
        by: { host: opp, kind: "host" },
        player: me,
        points: 5,
        type: "stayed",
      },
      "bank",
    ],
    [{ card: 4, player: me, type: "busted" }, "bust"],
    [{ player: me, type: "flipSeven" }, "flipSeven"],
    [{ by: opp, points: 3, target: me, type: "frozen" }, "freeze"],
    [{ by: opp, target: me, type: "flipThreeStarted" }, "flipThree"],
    [{ by: opp, target: me, type: "secondChanceGiven" }, "special"],
    [{ player: me, type: "secondChanceKept" }, "special"],
    [{ card: 4, player: me, type: "secondChanceUsed" }, "secondChance"],
    [
      { by: opp, card: "freeze", target: me, type: "actionAssigned" },
      "special",
    ],
    [{ player: me, type: "joined", waitsFor: null }, "join"],
    [{ player: opp, type: "botAdded" }, "join"],
    [{ scores: [], tiedAt: null, type: "roundOver" }, null],
    [{ player: me, type: "secondChanceDiscarded" }, null],
    [{ how: "left", player: opp, type: "evicted" }, "leave"],
    [{ type: "deckReshuffled" }, "shuffle"],
  ] satisfies [GameEvent, string | null][])("cues %j with %s", (event, cue) => {
    expect(eventCue(event)).toBe(cue);
  });
});
