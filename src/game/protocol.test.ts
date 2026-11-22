import { describe, expect, it } from "vitest";

import { fallbackAvatar } from "./avatars";
import { addBot, addPlayer, createGame } from "./engine";
import { roundStarted, toRoomView } from "./protocol";
import type { RoomView } from "./protocol";

const game = createGame();

addPlayer(game, "a", "Ana", 1);

addPlayer(game, "b", "Ben", 1);

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

describe(toRoomView, () => {
  it("shows each person's avatar and none for a bot", () => {
    const state = createGame();
    addPlayer(state, "a", "Ana", 4);
    addBot(state, "a", "bot", () => 0);

    expect(
      toRoomView("ABCDE", state).players.map((player) => player.avatar)
    ).toStrictEqual([4, null]);
  });

  it("gives a player saved before avatars the same avatar every time", () => {
    const state = createGame();
    addPlayer(state, "saved-player", "Ana", 4);
    delete state.players[0]?.avatar;

    const first = toRoomView("ABCDE", state).players[0]?.avatar;

    expect(first).toBe(fallbackAvatar("saved-player"));
    expect(toRoomView("ABCDE", state).players[0]?.avatar).toBe(first);
  });
});
