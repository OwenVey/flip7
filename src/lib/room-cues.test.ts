import { describe, expect, it } from "vitest";

import { addPlayer, createGame } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { eventCue, roomCues } from "./room-cues";

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

describe(roomCues, () => {
  it("reports a newly revealed card", () => {
    expect(
      roomCues(before, { ...before, drawSeq: 11, turnId: "me" }, "me")
    ).toStrictEqual(["reveal"]);
    expect(
      roomCues(before, { ...before, drawSeq: 11, turnId: "me" }, "opponent")
    ).toStrictEqual(["reveal"]);
  });

  it("does not replay cues when the same room state is broadcast again", () => {
    expect(roomCues(before, { ...before }, "me")).toStrictEqual([]);
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

    expect(roomCues(before, bust, "me")).toStrictEqual(["bust"]);
    expect(
      roomCues(before, { ...bust, phase: "gameOver" }, "me")
    ).toStrictEqual(["win"]);
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

    expect(roomCues(before, chat, "me")).toStrictEqual(["message"]);
    expect(roomCues(before, chat, "opponent")).toStrictEqual([]);
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
    [{ by: opp, target: me, type: "flipThreeStarted" }, "special"],
    [{ by: opp, target: me, type: "secondChanceGiven" }, "special"],
    [{ player: me, type: "secondChanceKept" }, "special"],
    [{ card: 4, player: me, type: "secondChanceUsed" }, "special"],
    [
      { by: opp, card: "freeze", target: me, type: "actionAssigned" },
      "special",
    ],
    [{ player: me, type: "joined", waitsFor: null }, "join"],
    [{ player: opp, type: "botAdded" }, "join"],
    [{ scores: [], tiedAt: null, type: "roundOver" }, null],
    [{ player: me, type: "secondChanceDiscarded" }, null],
    [{ how: "left", player: opp, type: "evicted" }, null],
  ] satisfies [GameEvent, string | null][])("cues %j with %s", (event, cue) => {
    expect(eventCue(event)).toBe(cue);
  });
});
