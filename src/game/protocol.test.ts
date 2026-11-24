import { describe, expect, it } from "vitest";

import { addBot, addPlayer, createGame } from "./engine";
import {
  cleanName,
  parseServerMessage,
  roundStarted,
  toRoomView,
  toStateMessage,
} from "./protocol";
import type { RoomView } from "./protocol";

const game = createGame();

addPlayer(game, "a", "Ana", 1);

addPlayer(game, "b", "Ben", 1);

const lobby = toRoomView("ABCDE", game);

const view = (changes: Partial<RoomView>) =>
  ({ ...lobby, ...changes }) satisfies RoomView;

describe(cleanName, () => {
  it("collapses whitespace and trims", () => {
    expect(cleanName("  Ana \t\n Lee  ")).toBe("Ana Lee");
  });

  it("strips zero-width, bidi and other invisible characters", () => {
    expect(cleanName("A\u200Bn\u200Da\u2060\uFEFF")).toBe("Ana");
    expect(cleanName("\u202EAna\u202C")).toBe("Ana");
    expect(cleanName("An\u0000a\u007F")).toBe("Ana");
  });

  it("leaves nothing of a name made only of invisible characters", () => {
    expect(cleanName("\u200B\u200C\u2060 \u00AD")).toBe("");
  });

  it("keeps a space between words that an invisible character sat next to", () => {
    expect(cleanName("Ana \u200B Lee")).toBe("Ana Lee");
  });
});

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

  it("is true when the host plays again straight from game over", () => {
    expect(
      roundStarted(
        view({ phase: "gameOver", round: 1 }),
        view({ phase: "playing", round: 1 })
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
});

const state = () => toStateMessage("ABCDE", game, {}, 1);

describe(parseServerMessage, () => {
  it("accepts a live room update the Worker sends", () => {
    expect(parseServerMessage(JSON.stringify(state()))).toMatchObject({
      lists: { draws: { after: null }, log: { after: null } },
      room: { players: [{ name: "Ana" }, { name: "Ben" }], spectatorCount: 1 },
      type: "state",
    });
  });

  it.each([
    ["without lists", { ...state(), lists: undefined }],
    [
      "with a draws update missing its entries",
      {
        ...state(),
        lists: { ...state().lists, draws: { after: null, seq: 1 } },
      },
    ],
    [
      "with players that aren't a list",
      { ...state(), room: { ...state().room, players: null } },
    ],
    [
      "with unknown settings",
      {
        ...state(),
        room: {
          ...state().room,
          settings: { ...state().room.settings, targetScore: 150 },
        },
      },
    ],
  ])("rejects a live room update %s", (_, message) => {
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });
});
