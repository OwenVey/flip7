import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import type { RoomView } from "../game/protocol";
import { createRoomChatLog } from "./room-chat-log";

const setup = () => {
  const answers: ((accepted: boolean) => void)[] = [];
  const [confirmed, setConfirmed] = createSignal<RoomView["reactions"]>({});

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
      log: () => [],
      playerId: () => "a",
      players: () => [],
      reactions: confirmed,
      resultsRound: () => null,
      round: () => 0,
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

  return { answer, reactions: chatLog.reactions };
};

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
