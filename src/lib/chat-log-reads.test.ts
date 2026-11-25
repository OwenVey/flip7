import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import type { ChatEntry, EventEntry, LogEntry } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { createChatLogReads } from "./chat-log-reads";

const ben = { id: "b", name: "Ben" };

const benChat = (id: number, text: string) =>
  ({
    at: 0,
    from: { ...ben, avatar: 1 },
    game: 1,
    id,
    round: 1,
    text,
  }) satisfies ChatEntry;

const happened = (id: number, event: GameEvent) =>
  ({ at: 0, event, game: 1, id, round: 1 }) satisfies EventEntry;

const stayed = (points: number) =>
  ({
    by: { kind: "player" },
    player: { ...ben },
    points,
    type: "stayed",
  }) satisfies GameEvent;

const newAfterRestore = (restoredEvent: GameEvent) => {
  const [log, setLog] = createSignal<LogEntry[]>([
    benChat(8, "retained"),
    happened(9, stayed(5)),
    benChat(10, "original"),
  ]);

  const { dispose, reads } = createRoot((stop) => ({
    dispose: stop,
    reads: createChatLogReads({
      log,
      playerId: () => "a",
      shown: () => true,
    }),
  }));

  flush();
  reads.setScrollPosition({ atEnd: false, following: false });
  flush();
  setLog([
    benChat(8, "retained"),
    happened(9, restoredEvent),
    benChat(10, "replacement"),
  ]);
  flush();

  const count = reads.newEntries();
  dispose();

  return count;
};

describe(createChatLogReads, () => {
  it("keeps a game event seen when an older save restores it unchanged", () => {
    expect(newAfterRestore(stayed(5))).toBe(1);
  });

  it("counts a game event as new when an older save replaces it under the same ID", () => {
    expect(newAfterRestore(stayed(8))).toBe(2);
  });
});
