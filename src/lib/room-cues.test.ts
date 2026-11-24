import { describe, expect, it } from "vitest";

import { addPlayer, createGame } from "../game/engine";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { roomCues } from "./room-cues";

const LOGGED_AT = Date.now();

const game = createGame();

addPlayer(game, "me", "Me", 1);

addPlayer(game, "opponent", "Opp", 1);

const before: RoomView = {
  ...toRoomView("ABCDE", game),
  drawSeq: 10,
  log: [
    { at: LOGGED_AT, cue: "bank", game: 1, id: 7, round: 1, text: "Banked." },
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
          cue: "bust",
          game: 1,
          id: 8,
          round: 1,
          text: "Busted.",
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
