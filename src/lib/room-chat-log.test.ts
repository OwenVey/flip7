import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import type { LogEntry } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { itemAt } from "../test/item-at";
import { createRoomChatLog } from "./room-chat-log";

const setup = () => {
  const answers: ((accepted: boolean) => void)[] = [];
  const [confirmed, setConfirmed] = createSignal<RoomView["reactions"]>({});
  const [log, setLog] = createSignal<LogEntry[]>([]);
  const [round, setRound] = createSignal(0);

  const chatLog = createRoot(() =>
    createRoomChatLog({
      chat: {
        react: async () => {
          const { promise, resolve } = Promise.withResolvers<boolean>();
          answers.push(resolve);

          return await promise;
        },
        send: () => true,
        typing: () => {},
      },
      inSheet: () => false,
      log,
      playerId: () => "a",
      players: () => [],
      reactions: confirmed,
      resultsRound: () => null,
      round,
      typing: () => [],
    })
  );

  const answer = async (
    index: number,
    accepted: boolean,
    next?: RoomView["reactions"]
  ) => {
    if (next) {
      setConfirmed(next);
    }

    answers[index]?.(accepted);
    await Promise.resolve();
    flush();
  };

  return { answer, chatLog, reactions: chatLog.reactions, setLog, setRound };
};

const player = { avatar: 1, id: "b", name: "Ben" };

const chatEntry = (id: number, round = 1, game = 1) =>
  ({
    at: id * 1000,
    from: player,
    game,
    id,
    round,
    text: "Nice!",
  }) satisfies LogEntry;

const settledRound = {
  at: 3000,
  event: { scores: [], tiedAt: null, type: "roundOver" },
  game: 1,
  id: 3,
  round: 1,
} satisfies LogEntry;

describe("Chat & Log projection", () => {
  it("moves New from the heading back to the first unread event when unfolded", () => {
    const { chatLog, setLog, setRound } = setup();
    setRound(1);
    setLog([chatEntry(1), chatEntry(2)]);
    flush();

    chatLog.reads.setScrollPosition({ atEnd: false, following: false });
    flush();
    setLog([chatEntry(1), chatEntry(2), settledRound]);
    flush();

    const shown = () => itemAt(chatLog.rounds(), 0);
    expect(shown().view()).toMatchObject({
      collapsed: false,
      newAboveHeading: false,
      newBeforeRow: 3,
    });

    setRound(2);
    setLog([chatEntry(1), chatEntry(2), settledRound, chatEntry(4, 2)]);
    flush();

    const folded = shown().view();
    expect(folded).toMatchObject({
      collapsed: true,
      newAboveHeading: true,
      newBeforeRow: undefined,
    });
    expect(folded.rows.map(({ entry }) => entry.id)).toStrictEqual([1, 2]);
    expect(shown().view(true)).toMatchObject({
      collapsed: false,
      newAboveHeading: false,
      newBeforeRow: 3,
    });
    expect(itemAt(chatLog.rounds(), 1).view().newBeforeRow).toBeUndefined();
  });

  it("keeps a chat marker on its row in a folded round", () => {
    const { chatLog, setLog, setRound } = setup();
    setRound(1);
    setLog([chatEntry(1)]);
    flush();

    chatLog.reads.setScrollPosition({ atEnd: false, following: false });
    flush();
    setRound(2);
    setLog([chatEntry(1), chatEntry(2), settledRound, chatEntry(4, 2)]);
    flush();

    expect(itemAt(chatLog.rounds(), 0).view()).toMatchObject({
      collapsed: true,
      newAboveHeading: false,
      newBeforeRow: 2,
    });
  });

  it("keeps round headings without merging chat runs across hidden game events", () => {
    const { chatLog, setLog, setRound } = setup();
    setRound(1);
    setLog([
      chatEntry(1, 0),
      chatEntry(2),
      settledRound,
      chatEntry(4),
      chatEntry(5),
      chatEntry(6, 1, 2),
    ]);
    chatLog.reads.setFilter("Chat");
    flush();

    const rounds = chatLog.rounds();
    expect(rounds.map(({ heading }) => heading)).toStrictEqual([
      "Before the game",
      "Round 1",
      "Game 2 · Round 1",
    ]);
    const round = itemAt(rounds, 1);
    expect(round.collapsible).toBeFalsy();
    expect(
      round
        .view(false)
        .rows.map(({ continuation, entry }) => [entry.id, continuation])
    ).toStrictEqual([
      [2, false],
      [4, false],
      [5, true],
    ]);
  });
});

describe("Chat & Log reactions", () => {
  it("shows a tap at once and drops it when the Room rejects it", async () => {
    const { answer, reactions } = setup();

    const tap = reactions.toggle(2, "👍");
    flush();

    expect(reactions.of(2)).toStrictEqual({ a: "👍" });

    await answer(0, false);
    await tap;

    expect(reactions.of(2)).toBeUndefined();
  });

  it("keeps a newer tap when an earlier one is answered first", async () => {
    const { answer, reactions } = setup();

    const first = reactions.toggle(2, "👍");
    const second = reactions.toggle(2, "🎉");
    flush();

    expect(reactions.mine(2)).toBe("🎉");

    await answer(0, true, { 2: { a: "👍" } });
    await first;

    expect(reactions.mine(2)).toBe("🎉");

    await answer(1, true, { 2: { a: "🎉" } });
    await second;

    expect(reactions.mine(2)).toBe("🎉");
  });

  it("removes the viewer's reaction when they tap it again", async () => {
    const { answer, reactions } = setup();
    await answer(-1, true, { 2: { a: "👍", b: "👍" } });

    const tap = reactions.toggle(2, "👍");
    flush();

    expect(reactions.of(2)).toStrictEqual({ b: "👍" });

    await answer(0, true, { 2: { b: "👍" } });
    await tap;

    expect(reactions.of(2)).toStrictEqual({ b: "👍" });
  });
});
