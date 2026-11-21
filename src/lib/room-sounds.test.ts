import { describe, expect, it } from "vitest";

import { addPlayer, createGame } from "../game/engine";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { roomCues } from "./room-sounds";

const game = createGame();

addPlayer(game, "me", "Me");

addPlayer(game, "opponent", "Opp");

const before: RoomView = {
  ...toRoomView("ABCDE", game),
  drawSeq: 10,
  log: [{ cue: "bank", id: 7, text: "Banked." }],
  phase: "playing",
  round: 1,
  turnId: "opponent",
};

describe(roomCues, () => {
  it("plays a newly revealed card and alerts the next player", () => {
    expect(
      roomCues(before, { ...before, drawSeq: 11, turnId: "me" }, "me")
    ).toStrictEqual(["reveal", "turn"]);
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
      log: [...before.log, { cue: "bust", id: 8, text: "Busted." }],
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
        { from: { id: "opponent", name: "Opp" }, id: 8, text: "gl" },
      ],
    };

    expect(roomCues(before, chat, "me")).toStrictEqual(["message"]);
    expect(roomCues(before, chat, "opponent")).toStrictEqual([]);
  });
});
