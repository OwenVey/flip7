import { describe, expect, it } from "vitest";

import { addPlayer, createGame } from "./engine";
import { roundStarted, toRoomView } from "./protocol";
import type { RoomView } from "./protocol";

const game = createGame();

addPlayer(game, "a", "Ana");

addPlayer(game, "b", "Ben");

const lobby = toRoomView("ABCDE", game);

const view = (changes: Partial<RoomView>) =>
  ({ ...lobby, ...changes }) satisfies RoomView;

describe(roundStarted, () => {
  it("is true when the game starts or the next round is dealt", () => {
    expect(
      roundStarted(lobby, view({ phase: "playing", round: 1 }))
    ).toBeTruthy();
    expect(
      roundStarted(
        view({ phase: "roundOver", round: 1 }),
        view({ phase: "playing", round: 2 })
      )
    ).toBeTruthy();
  });

  it("is false within a round, in the lobby and when returning to it", () => {
    const playing = view({ phase: "playing", round: 1 });

    expect(roundStarted(playing, { ...playing })).toBeFalsy();
    expect(roundStarted(lobby, { ...lobby })).toBeFalsy();
    expect(
      roundStarted(view({ phase: "gameOver", round: 4 }), lobby)
    ).toBeFalsy();
  });
});
