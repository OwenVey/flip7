import { describe, expect, it } from "vitest";

import { addBot, addPlayer, createGame } from "./engine";
import type { GameEvent } from "./game-events";
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
      lists: { dealHistory: { after: null }, log: { after: null } },
      room: { players: [{ name: "Ana" }, { name: "Ben" }], spectatorCount: 1 },
      type: "state",
    });
  });

  it("rejects a held action resolution without a target", () => {
    const message = state();

    const dealHistory = {
      after: null,
      entries: [
        {
          card: { id: 80, kind: "freeze" },
          outcome: "played",
          seq: 1,
          type: "heldAction",
        },
      ],
      seq: 1,
    };

    expect(
      parseServerMessage(
        JSON.stringify({
          ...message,
          lists: { ...message.lists, dealHistory },
          room: { ...message.room, dealSeq: 1 },
        })
      )
    ).toBeNull();
  });

  const withLog = (entries: unknown[]) => {
    const message = state();
    const { log } = message.lists;

    return JSON.stringify({
      ...message,
      lists: { ...message.lists, log: { ...log, entries } },
    });
  };

  const ana = { id: "a", name: "Ana" };
  const fields = { at: 0, game: 1, id: 90, round: 1 };
  const chatEntry = { ...fields, from: { ...ana, avatar: 1 }, text: "hi" };

  it.each([
    { at: 8_640_000_000_000_001 },
    { from: { ...ana, avatar: 26 } },
    { from: { ...ana, avatar: 0 } },
    { from: { avatar: 1, id: "a", name: "" } },
    { text: 5 },
  ])("rejects corrupt chat %j", (changes) => {
    expect(
      parseServerMessage(withLog([{ ...chatEntry, ...changes }]))
    ).toBeNull();
  });

  it.each([
    undefined,
    { type: "mystery" },
    { player: { id: "a", name: "" }, type: "joined", waitsFor: null },
    { by: { kind: "player" }, player: ana, points: "5", type: "stayed" },
    { by: { kind: "robot" }, player: ana, points: 5, type: "stayed" },
    { card: 13, player: ana, type: "busted" },
    { by: ana, card: "secondChance", target: ana, type: "actionAssigned" },
    { cards: [], type: "heldActionsDiscarded" },
    { targetScore: 150, type: "targetScoreSet" },
    {
      scores: [{ ...ana, points: "5" }],
      tiedAt: null,
      type: "roundOver",
    },
  ])("rejects a corrupt game event %j", (event) => {
    expect(parseServerMessage(withLog([{ ...fields, event }]))).toBeNull();
  });

  it("accepts every kind of game event the engine records", () => {
    const ben = { id: "b", name: "Ben" };
    const host = { host: ana, kind: "host" } as const;

    const events = [
      { player: ana, type: "joined", waitsFor: null },
      { player: ana, type: "joined", waitsFor: "game" },
      { player: ben, type: "botAdded" },
      { how: "leftToWatch", player: ben, type: "evicted" },
      { player: ben, type: "hostChanged" },
      { targetScore: 300, type: "targetScoreSet" },
      { botSpeed: "fast", type: "botSpeedSet" },
      { locked: true, type: "lockSet" },
      { type: "gameAbandoned" },
      { dealer: null, type: "roundStarted" },
      { type: "deckReshuffled" },
      { type: "outOfCards" },
      { by: { kind: "player" }, player: ana, points: 0, type: "stayed" },
      { by: host, player: ben, points: 3, type: "stayed" },
      {
        by: { kind: "game" },
        move: "choose",
        player: ben,
        type: "movedForOffline",
      },
      { card: 12, player: ana, type: "busted" },
      { player: ana, type: "flipSeven" },
      { player: ana, type: "secondChanceKept" },
      { card: 0, player: ana, type: "secondChanceUsed" },
      { by: null, target: ben, type: "secondChanceGiven" },
      { player: ana, type: "secondChanceDiscarded" },
      { by: ana, points: 4, target: ben, type: "frozen" },
      { by: ana, target: ana, type: "flipThreeStarted" },
      { by: ben, card: "flipThree", target: null, type: "actionAssigned" },
      { cards: ["freeze", "flipThree"], type: "heldActionsDiscarded" },
      { card: "freeze", target: null, type: "actionDiscarded" },
      { scores: [{ ...ana, points: 9 }], tiedAt: 200, type: "roundOver" },
      { player: ana, points: 210, scores: [], type: "gameWon" },
    ] satisfies GameEvent[];

    const entries = events.map((event, index) => ({
      ...fields,
      event,
      id: index + 1,
    }));

    expect(parseServerMessage(withLog([...entries, chatEntry]))).toMatchObject({
      lists: { log: { entries: [...entries, chatEntry] } },
    });
  });

  it("accepts a chat entry with an avatar, or none for a bot", () => {
    expect(
      parseServerMessage(
        withLog([
          { ...chatEntry, from: { avatar: 25, id: "a", name: "Ana" }, id: 90 },
          {
            ...chatEntry,
            from: { avatar: null, id: "b", name: "Ben" },
            id: 91,
          },
        ])
      )
    ).not.toBeNull();
  });

  it.each([
    ["without lists", { ...state(), lists: undefined }],
    [
      "with a deal history update missing its entries",
      {
        ...state(),
        lists: { ...state().lists, dealHistory: { after: null, seq: 1 } },
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
