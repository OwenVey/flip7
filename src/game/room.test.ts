import { describe, expect, it } from "vitest";

import type { Card } from "./cards";
import {
  chat,
  DEAL_HISTORY_LIMIT,
  isChat,
  MAX_PLAYERS,
  nextRound,
  startGame,
} from "./engine";
import type { DealEvent, LogEntry } from "./engine";
import { MAX_SPECTATORS } from "./moves";
import {
  HEARTBEAT_STALE_MS,
  ROOM_REMOVED_CLOSE_CODE,
  TYPING_RELAY_MS,
} from "./protocol";
import type { ServerMessage, StateMessage } from "./protocol";
import { createRoom, deliver, newStoredRoom } from "./room";
import type {
  Admission,
  RoomOutcome,
  RoomPassing,
  RoomTransport,
  Seats,
} from "./room";
import { ABSENT_GRACE_MS, HOST_GRACE_MS, IDLE_EXPIRY_MS } from "./timers";

const START = 1_000_000;
const random = () => 0.5;

const num = (id: number, value: number) =>
  ({ id, kind: "number", value }) satisfies Card;

interface OpenConnection {
  admission: Admission | null;
  lastPing: Date | null;
}

const harness = () => {
  let clock = START;
  let ids = 0;
  const open = new Map<string, OpenConnection>();

  const seats: Seats = {
    assign: (connectionId, seat) => {
      const connection = open.get(connectionId);

      if (connection) {
        connection.admission = seat;
      }
    },
    connections: () =>
      Array.from(open, ([id, connection]) => ({ id, ...connection })),
  };

  const stored = newStoredRoom("ABCDE", START);

  const room = createRoom(stored, seats, {
    newId: () => {
      ids += 1;

      return `id-${ids}`;
    },
    now: () => clock,
    random,
  });

  return {
    advance: (ms: number) => {
      clock += ms;
    },
    vanish: (connectionId: string) => {
      open.delete(connectionId);
    },
    connect: (connectionId: string) => {
      open.set(connectionId, { admission: null, lastPing: null });
    },
    drop: (connectionId: string) => {
      const seat = open.get(connectionId)?.admission ?? null;
      open.delete(connectionId);

      return room.disconnect(seat);
    },
    now: () => clock,
    ping: (connectionId: string) => {
      const connection = open.get(connectionId);

      if (connection) {
        connection.lastPing = new Date(clock);
      }
    },
    room,
    seatOf: (connectionId: string) => open.get(connectionId)?.admission ?? null,
    seats,
    stored,
  };
};

type Harness = ReturnType<typeof harness>;

const replies = (outcome: Pick<RoomOutcome, "effects">) =>
  outcome.effects.flatMap((effect) =>
    effect.type === "reply" ? [effect.message] : []
  );

const welcomeOf = (outcome: Pick<RoomOutcome, "effects">) => {
  const welcome = replies(outcome).find(
    (message): message is Extract<ServerMessage, { type: "welcome" }> =>
      message.type === "welcome"
  );

  if (!welcome) {
    throw new Error("Expected a welcome");
  }

  return welcome;
};

const closes = (outcome: RoomOutcome) =>
  outcome.effects.flatMap((effect) =>
    effect.type === "close" ? [effect] : []
  );

const broadcasts = (outcome: RoomOutcome) =>
  outcome.effects.some((effect) => effect.type === "broadcast");

const broadcastOf = (outcome: RoomOutcome) => {
  const found = outcome.effects.find((effect) => effect.type === "broadcast");

  if (found?.message.type !== "state") {
    throw new Error("Expected a broadcast of the table");
  }

  return found.message;
};

const logEvents = (entries: LogEntry[]) =>
  entries.flatMap((entry) => (isChat(entry) ? [] : [entry.event]));

const logTexts = (message: StateMessage) =>
  message.lists.log.entries.map((entry) =>
    isChat(entry) ? entry.text : entry.event.type
  );

const dealSeqs = (message: StateMessage) =>
  message.lists.dealHistory.entries.map((event) => event.seq);

const joinAs = (h: Harness, connectionId: string, name: string) => {
  h.connect(connectionId);

  return welcomeOf(h.room.join(connectionId, name, null));
};

const typingRelays = () => {
  const h = harness();
  joinAs(h, "ana-tab", "Ana");
  joinAs(h, "ben-tab", "Ben");

  const relayed = (...changes: boolean[]) =>
    changes.flatMap((active) =>
      h.room
        .typing("ana-tab", active)
        .map((effect) =>
          effect.type === "relay" && effect.message.type === "typing"
            ? effect.message.active
            : null
        )
    );

  return { h, relayed };
};

const player = (h: Harness, id: string) => {
  const found = h.stored.game.players.find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`No player ${id}`);
  }

  return found;
};

const roundWhereHostMovesFirst = () => {
  const h = harness();
  const ana = joinAs(h, "ana-tab", "Ana");
  const ben = joinAs(h, "ben-tab", "Ben");
  const { game } = h.stored;
  startGame(game, ana.playerId, random);
  game.phase = "roundOver";
  game.round = 0;
  game.dealerIndex = 0;
  game.deck = [num(901, 5), num(902, 3)].toReversed();
  nextRound(game, ana.playerId, random);

  return { ana, ben, h };
};

describe("joining a room", () => {
  it("seats a new player and welcomes them before broadcasting the table", () => {
    const h = harness();
    h.connect("tab");

    const outcome = h.room.join("tab", "  Ana  ", null);

    expect(outcome.effects.map((effect) => effect.type)).toStrictEqual([
      "reply",
      "reply",
      "broadcast",
    ]);
    expect(welcomeOf(outcome)).toStrictEqual({
      lastRequestId: undefined,
      playerId: "id-1",
      token: "id-2",
      type: "welcome",
    });
    expect(h.stored.game.players.map((p) => p.name)).toStrictEqual(["Ana"]);
    expect(h.seatOf("tab")).toStrictEqual({
      playerId: "id-1",
      seatedAt: START,
      typing: null,
    });
    expect(outcome.alarmAt).toBe(START + HEARTBEAT_STALE_MS);
  });

  it("rejects a blank name", () => {
    const h = harness();
    h.connect("tab");

    const outcome = h.room.join("tab", "   ", null);

    expect(replies(outcome)).toStrictEqual([
      { message: "Enter a name to join.", type: "error" },
    ]);
    expect(broadcasts(outcome)).toBeFalsy();
  });

  it("rejects a name made only of invisible characters", () => {
    const h = harness();
    h.connect("tab");

    const outcome = h.room.join("tab", "\u200B\u2060\uFEFF", null);

    expect(replies(outcome)).toStrictEqual([
      { message: "Enter a name to join.", type: "error" },
    ]);
  });

  it("seats a name without the invisible characters hidden in it", () => {
    const h = harness();
    h.connect("tab");

    h.room.join("tab", "A\u200Bna", null);

    expect(h.stored.game.players.map((p) => p.name)).toStrictEqual(["Ana"]);
  });

  it("seats a player with the avatar they picked", () => {
    const h = harness();
    h.connect("tab");

    const { playerId } = welcomeOf(h.room.join("tab", "Ana", null, 7));

    expect(player(h, playerId).avatar).toBe(7);
  });

  it("assigns an avatar nobody has when the pick is missing or unknown", () => {
    const h = harness();
    h.connect("ana-tab");
    h.connect("ben-tab");

    const ana = welcomeOf(h.room.join("ana-tab", "Ana", null));
    const ben = welcomeOf(h.room.join("ben-tab", "Ben", null, 99));

    expect(player(h, ana.playerId).avatar).toBe(13);
    expect(player(h, ben.playerId).avatar).toBe(14);
  });

  it("keeps the first avatar when a player rejoins by token", () => {
    const h = harness();
    h.connect("tab-1");
    const ana = welcomeOf(h.room.join("tab-1", "Ana", null, 3));
    h.connect("tab-2");

    h.room.join("tab-2", "", ana.token, 15);

    expect(player(h, ana.playerId).avatar).toBe(3);
  });

  it("welcomes an already seated tab again without adding a player", () => {
    const h = harness();
    const first = joinAs(h, "tab", "Ana");

    expect(welcomeOf(h.room.join("tab", "Someone", null))).toStrictEqual(first);
    expect(h.stored.game.players).toHaveLength(1);
  });

  it("rejoins by token from a second tab and after going offline", () => {
    const h = harness();
    const ana = joinAs(h, "tab-1", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.connect("tab-2");

    expect(welcomeOf(h.room.join("tab-2", "", ana.token)).playerId).toBe(
      ana.playerId
    );

    h.drop("tab-1");
    h.drop("tab-2");
    expect(player(h, ana.playerId).connected).toBeFalsy();

    h.connect("tab-3");
    h.room.join("tab-3", "", ana.token);
    expect(player(h, ana.playerId).connected).toBeTruthy();
    expect(h.stored.game.players).toHaveLength(2);
  });
});

describe("commands", () => {
  it("accepts a move after broadcasting it, and the welcome on reconnect remembers it", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");

    const outcome = h.room.command("ana-tab", {
      requestId: "move-1",
      type: "start",
    });

    expect(outcome.effects).toMatchObject([
      { message: { type: "state" }, type: "broadcast" },
      { message: { requestId: "move-1", type: "accepted" }, type: "reply" },
    ]);
    expect(h.stored.game.phase).toBe("playing");

    h.drop("ana-tab");
    h.connect("ana-tab-2");
    const ana = h.stored.tokens[h.stored.game.hostId ?? ""];
    expect(welcomeOf(h.room.join("ana-tab-2", "", ana ?? null))).toMatchObject({
      lastRequestId: "move-1",
    });
    expect(Object.hasOwn(h.stored.lastRequests, ben.playerId)).toBeFalsy();
  });

  it("rejects a move from a tab that hasn't joined, quoting the request", () => {
    const h = harness();
    h.connect("tab");

    expect(
      replies(h.room.command("tab", { requestId: "move-1", type: "start" }))
    ).toStrictEqual([
      {
        message: "Join the room first.",
        requestId: "move-1",
        type: "rejected",
      },
    ]);
  });

  it("only lets seated players chat", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    h.connect("lurker");

    expect(broadcasts(h.room.chat("ana-tab", "hi"))).toBeTruthy();
    expect(replies(h.room.chat("lurker", "hi"))).toStrictEqual([
      { message: "Join the room first.", type: "error" },
    ]);
  });

  it("relays a seated player's typing to everyone but their own seat, without changing the room", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.connect("ana-phone");
    h.room.join("ana-phone", "", ana.token);
    h.connect("lurker");
    const before = structuredClone(h.stored);

    expect(h.room.typing("ana-tab", true)).toStrictEqual([
      {
        except: ["ana-tab", "ana-phone"],
        message: { active: true, playerId: ana.playerId, type: "typing" },
        type: "relay",
      },
    ]);
    expect(h.room.typing("lurker", true)).toStrictEqual([]);
    expect(h.stored).toStrictEqual(before);
  });

  it("relays one typing stop after each start, and none before", () => {
    const { relayed } = typingRelays();

    expect(relayed(false, true, false, false)).toStrictEqual([true, false]);
  });

  it("keeps typing visible when one seat sends a chat and another is still typing", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.connect("ana-phone");
    h.room.join("ana-phone", "", ana.token);

    h.room.typing("ana-tab", true);
    h.room.typing("ana-phone", true);

    expect(
      h.room.chat("ana-tab", "hi").effects.map((effect) => effect.type)
    ).toStrictEqual(["broadcast"]);
    expect(h.room.typing("ana-phone", false)).toStrictEqual([
      {
        except: ["ana-tab", "ana-phone"],
        message: { active: false, playerId: ana.playerId, type: "typing" },
        type: "relay",
      },
    ]);
  });

  it("keeps the typing relay cooldown across a chat send", () => {
    const { h, relayed } = typingRelays();

    expect(relayed(true, true)).toStrictEqual([true]);

    h.advance(TYPING_RELAY_MS);
    expect(relayed(true)).toStrictEqual([true]);

    h.room.chat("ana-tab", "hi");
    expect(relayed(true)).toStrictEqual([]);

    h.advance(TYPING_RELAY_MS);
    expect(relayed(true)).toStrictEqual([true]);
  });
});

describe("evicting a player", () => {
  it("closes every seat of a kicked player after accepting the kick", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.connect("ben-phone");
    h.room.join("ben-phone", "", ben.token);

    const outcome = h.room.command("ana-tab", {
      playerId: ben.playerId,
      requestId: "kick-1",
      type: "kick",
    });

    expect(outcome.effects).toMatchObject([
      { message: { type: "state" }, type: "broadcast" },
      { message: { requestId: "kick-1", type: "accepted" }, type: "reply" },
      {
        code: ROOM_REMOVED_CLOSE_CODE,
        connectionId: "ben-tab",
        reason: "kicked",
        type: "close",
      },
      {
        code: ROOM_REMOVED_CLOSE_CODE,
        connectionId: "ben-phone",
        reason: "kicked",
        type: "close",
      },
    ]);
    expect(h.seatOf("ben-tab")).toBeNull();
    expect(Object.hasOwn(h.stored.tokens, ben.playerId)).toBeFalsy();
  });

  it("only lets the host kick", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");

    const outcome = h.room.command("ben-tab", {
      playerId: ana.playerId,
      requestId: "kick-1",
      type: "kick",
    });

    expect(replies(outcome)).toStrictEqual([
      {
        message: "Only the host can remove players.",
        requestId: "kick-1",
        type: "rejected",
      },
    ]);
    expect(closes(outcome)).toHaveLength(0);
  });

  it("forgets a player who leaves, without recording the leave", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");

    const outcome = h.room.command("ben-tab", {
      requestId: "leave-1",
      type: "leave",
    });

    expect(closes(outcome)).toStrictEqual([
      {
        code: ROOM_REMOVED_CLOSE_CODE,
        connectionId: "ben-tab",
        reason: "left",
        type: "close",
      },
    ]);
    expect(Object.hasOwn(h.stored.lastRequests, ben.playerId)).toBeFalsy();
    expect(Object.hasOwn(h.stored.tokens, ben.playerId)).toBeFalsy();
  });
});

describe("presence", () => {
  it("keeps a player online while another of their tabs is open", () => {
    const h = harness();
    const ana = joinAs(h, "tab-1", "Ana");
    h.connect("tab-2");
    h.room.join("tab-2", "", ana.token);

    const first = h.drop("tab-1");
    expect(broadcasts(first)).toBeFalsy();
    expect(player(h, ana.playerId).connected).toBeTruthy();

    const last = h.drop("tab-2");
    expect(broadcasts(last)).toBeTruthy();
    expect(player(h, ana.playerId).connected).toBeFalsy();
  });

  it("drops a seat that stops pinging and marks the player offline", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.advance(HEARTBEAT_STALE_MS);
    h.ping("ana-tab");

    const outcome = h.room.alarm();

    expect(closes(outcome)).toStrictEqual([
      {
        code: 1001,
        connectionId: "ben-tab",
        reason: "Heartbeat timed out",
        type: "close",
      },
    ]);
    expect(broadcasts(outcome)).toBeTruthy();
    expect(player(h, ben.playerId).connected).toBeFalsy();
  });

  it("marks players offline whose seats didn't survive hibernation", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.vanish("ana-tab");

    expect(broadcasts(h.room.reconcile())).toBeTruthy();
    expect(player(h, ana.playerId).connected).toBeFalsy();
    expect(broadcasts(h.room.reconcile())).toBeFalsy();
  });
});

describe("clocks", () => {
  it("hands the host on after the host grace period", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.drop("ana-tab");
    h.advance(HOST_GRACE_MS);
    h.ping("ben-tab");

    expect(broadcasts(h.room.alarm())).toBeTruthy();
    expect(h.stored.game.hostId).toBe(ben.playerId);
    expect(h.stored.game.hostId).not.toBe(ana.playerId);
  });

  it("plays for an offline player after a stall", () => {
    const { ana, h } = roundWhereHostMovesFirst();
    h.drop("ana-tab");
    expect(h.stored.stall).toStrictEqual({
      playerId: ana.playerId,
      since: START,
    });

    h.advance(ABSENT_GRACE_MS);
    h.ping("ben-tab");
    h.room.alarm();

    expect(h.stored.game.turnId).not.toBe(ana.playerId);
  });

  it("restarts the stall when the host moves for an offline player the game waits on again", () => {
    const { ben, h } = roundWhereHostMovesFirst();
    h.room.command("ana-tab", { type: "stay" });
    h.drop("ben-tab");
    expect(h.stored.stall?.since).toBe(START);

    h.advance(HOST_GRACE_MS);
    h.ping("ana-tab");
    h.stored.game.deck = [num(903, 7)];
    h.room.command("ana-tab", { forId: ben.playerId, type: "hit" });

    expect(h.stored.game.turnId).toBe(ben.playerId);
    expect(h.stored.stall).toStrictEqual({
      playerId: ben.playerId,
      since: h.now(),
    });

    h.advance(ABSENT_GRACE_MS - HOST_GRACE_MS);
    h.ping("ana-tab");
    h.room.alarm();
    expect(player(h, ben.playerId).hand).toHaveLength(2);
    expect(h.stored.game.turnId).toBe(ben.playerId);
  });

  it("expires an idle room only once nobody is connected", () => {
    const open = harness();
    open.connect("lurker");
    open.advance(IDLE_EXPIRY_MS);
    expect(open.room.alarm().expired).toBeFalsy();

    const silent = harness();
    joinAs(silent, "tab", "Ana");
    silent.advance(IDLE_EXPIRY_MS);
    expect(silent.room.alarm().expired).toBeTruthy();

    const empty = harness();
    empty.advance(IDLE_EXPIRY_MS);
    expect(empty.room.alarm().expired).toBeTruthy();
  });
});

describe("bots", () => {
  it("lets the host add a bot that is always present", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");

    const outcome = h.room.command("ana-tab", {
      requestId: "00000000-0000-4000-8000-000000000001",
      type: "addBot",
    });

    const [, bot] = h.stored.game.players;

    expect(broadcasts(outcome)).toBeTruthy();
    expect(bot).toMatchObject({ bot: true, connected: true });
    expect(h.room.reconcile().effects).toStrictEqual([]);
    expect(Object.keys(h.stored.tokens)).toHaveLength(1);
  });

  it("plays the bot's moves from the alarm", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    h.room.command("ana-tab", { type: "addBot" });
    h.room.command("ana-tab", { type: "start" });

    if (h.stored.game.turnId === ana.playerId) {
      h.room.command("ana-tab", { type: "stay" });
    }

    const due = h.stored.botTurn?.at ?? 0;
    const logged = h.stored.game.log.length;
    h.advance(due - h.now());
    h.ping("ana-tab");

    expect(broadcasts(h.room.alarm())).toBeTruthy();
    expect(h.stored.game.log.length).toBeGreaterThan(logged);
  });

  it("deletes the room when the last person leaves a table of bots", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    h.room.command("ana-tab", { type: "addBot" });

    expect(h.room.command("ana-tab", { type: "leave" }).expired).toBeTruthy();
  });

  it("keeps the room while another person is still seated", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.room.command("ana-tab", { type: "addBot" });

    expect(h.room.command("ana-tab", { type: "leave" }).expired).toBeFalsy();
    expect(player(h, h.stored.game.hostId ?? "").name).toBe("Ben");
  });
});

describe("room settings", () => {
  it("lets the host change settings, and tells the table", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");

    const outcome = h.room.command("ana-tab", {
      botSpeed: "fast",
      requestId: "00000000-0000-4000-8000-000000000001",
      targetScore: 100,
      type: "configure",
    });

    expect(replies(outcome)).toContainEqual({
      requestId: "00000000-0000-4000-8000-000000000001",
      type: "accepted",
    });
    expect(h.room.snapshot().room.settings).toStrictEqual({
      botSpeed: "fast",
      locked: false,
      targetScore: 100,
    });
    expect(logEvents(h.stored.game.log)).toContainEqual({
      targetScore: 100,
      type: "targetScoreSet",
    });
  });

  it("rejects a guest changing settings", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");

    const outcome = h.room.command("ben-tab", {
      requestId: "00000000-0000-4000-8000-000000000001",
      targetScore: 300,
      type: "configure",
    });

    expect(replies(outcome)).toContainEqual({
      message: "Only the host can do that.",
      requestId: "00000000-0000-4000-8000-000000000001",
      type: "rejected",
    });
    expect(h.room.snapshot().room.settings.targetScore).toBe(200);
  });

  it("turns new players away from a locked room but lets seated players rejoin", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.room.command("ana-tab", { locked: true, type: "configure" });

    h.connect("cara-tab");
    expect(replies(h.room.join("cara-tab", "Cara", null))).toStrictEqual([
      {
        message: "This room is locked. Ask the host to unlock it.",
        type: "error",
      },
    ]);

    h.drop("ben-tab");
    h.connect("ben-phone");
    expect(welcomeOf(h.room.join("ben-phone", "", ben.token)).playerId).toBe(
      ben.playerId
    );

    h.room.command("ana-tab", { locked: false, type: "configure" });
    expect(welcomeOf(h.room.join("cara-tab", "Cara", null))).toBeTruthy();
  });

  it("lets the host lock the room and speed up bots mid-game, but not change the winning score", () => {
    const { h } = roundWhereHostMovesFirst();

    h.room.command("ana-tab", {
      botSpeed: "fast",
      locked: true,
      type: "configure",
    });
    expect(h.room.snapshot().room.settings).toMatchObject({
      botSpeed: "fast",
      locked: true,
    });

    const outcome = h.room.command("ana-tab", {
      requestId: "00000000-0000-4000-8000-000000000002",
      targetScore: 100,
      type: "configure",
    });

    expect(replies(outcome)).toContainEqual({
      message: "You can only change the winning score in the lobby.",
      requestId: "00000000-0000-4000-8000-000000000002",
      type: "rejected",
    });
    expect(h.room.snapshot().room.settings.targetScore).toBe(200);

    h.connect("cara-tab");
    expect(replies(h.room.join("cara-tab", "Cara", null))).toStrictEqual([
      {
        message: "This room is locked. Ask the host to unlock it.",
        type: "error",
      },
    ]);
  });
});

describe("sending the log", () => {
  it("rejects reactions from Spectators and on game-log entries", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const joinedId = h.stored.game.logSeq;
    h.room.chat("ana-tab", "hello");
    h.connect("spectator-tab");
    h.room.watch("spectator-tab");

    const react = (connection: string, messageId: number) =>
      h.room.receive(connection, {
        emoji: "👍",
        messageId,
        requestId: crypto.randomUUID(),
        type: "react",
      });

    expect(replies(react("spectator-tab", h.stored.game.logSeq))).toMatchObject(
      [{ type: "rejected" }]
    );
    expect(replies(react("ana-tab", joinedId))).toMatchObject([
      { type: "rejected" },
    ]);
    expect(h.stored.game.chatReactions.size).toBe(0);
  });

  it("keeps a reaction when the Host kicks its author", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.room.chat("ana-tab", "hello");
    const messageId = h.stored.game.logSeq;
    h.room.receive("ben-tab", { emoji: "🎉", messageId, type: "react" });

    const kicked = h.room.command("ana-tab", {
      playerId: ben.playerId,
      type: "kick",
    });

    expect(broadcastOf(kicked).room.reactions).toStrictEqual({
      [messageId]: { [ben.playerId]: "🎉" },
    });
  });

  it("sends the whole log to a tab that opens, and to one that rejoins", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    h.room.chat("ana-tab", "hello");

    h.connect("ben-tab");
    expect(h.room.snapshot().lists.log).toStrictEqual({
      after: null,
      entries: h.stored.game.log,
      seq: h.stored.game.logSeq,
    });

    h.drop("ana-tab");
    h.connect("ana-tab-2");
    const opened = h.room.snapshot();
    h.room.join("ana-tab-2", "", ana.token);

    expect(opened.lists.log.after).toBeNull();
    expect(logTexts(opened)).toStrictEqual(["joined", "hello"]);
  });

  it("broadcasts only the entries added since the last broadcast", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const seqAfterJoin = h.stored.game.logSeq;

    const sent = broadcastOf(h.room.chat("ana-tab", "hi"));

    expect(sent.lists.log).toStrictEqual({
      after: seqAfterJoin,
      entries: [expect.objectContaining({ text: "hi" })],
      seq: seqAfterJoin + 1,
    });
    expect(sent.room).not.toHaveProperty("log");
    expect(sent.room.players.map((p) => p.name)).toStrictEqual(["Ana"]);
  });

  it("sends nothing new when the log hasn't changed", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.connect("ben-phone");

    const sent = broadcastOf(h.drop("ben-tab"));

    expect(sent.lists.log).toMatchObject({
      after: h.stored.game.logSeq,
      entries: [],
    });
  });

  it("includes entries logged without a broadcast in the next one", () => {
    const h = harness();
    const ana = joinAs(h, "ana-tab", "Ana");
    const before = h.stored.game.logSeq;
    chat(h.stored.game, ana.playerId, "quiet");

    expect(logTexts(broadcastOf(h.room.chat("ana-tab", "loud")))).toStrictEqual(
      ["quiet", "loud"]
    );
    expect(broadcastOf(h.room.chat("ana-tab", "again")).lists.log.after).toBe(
      before + 2
    );
  });

  it("replaces the log when a game starts, then carries on from it", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.room.chat("ben-tab", "lobby chat");

    const started = broadcastOf(h.room.command("ana-tab", { type: "start" }));

    expect(started.lists.log.after).toBeNull();
    expect(logTexts(started)).not.toContain("lobby chat");
    expect(started.lists.log.entries).toStrictEqual(h.stored.game.log);

    const next = broadcastOf(h.room.chat("ben-tab", "good luck"));
    expect(next.lists.log.after).toBe(started.lists.log.seq);
    expect(logTexts(next)).toStrictEqual(["good luck"]);
  });

  it("replaces the log on play again", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.room.command("ana-tab", { type: "start" });
    h.stored.game.phase = "gameOver";
    h.room.chat("ben-tab", "gg");

    const again = broadcastOf(h.room.command("ana-tab", { type: "start" }));

    expect(again.lists.log.after).toBeNull();
    expect(logTexts(again)).not.toContain("gg");
  });

  it("builds a full recovery snapshot without changing the stored room", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    h.room.chat("ana-tab", "one");
    const stored = structuredClone(h.stored);
    h.advance(1000);

    const snapshot = h.room.snapshot();

    expect(snapshot.lists.log.after).toBeNull();
    expect(logTexts(snapshot)).toStrictEqual(["joined", "one"]);
    expect(h.stored).toStrictEqual(stored);
  });

  it("remembers what it broadcast across hibernation", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    const saved = structuredClone(h.stored);

    const woken = createRoom(
      saved,
      { assign: () => {}, connections: () => [] },
      { newId: () => "x", now: () => START, random }
    );

    chat(saved.game, saved.game.players[0]?.id ?? "", "after waking");

    expect(broadcastOf(woken.reconcile()).lists.log).toMatchObject({
      after: h.stored.game.logSeq,
      entries: [expect.objectContaining({ text: "after waking" })],
    });
  });
});

const drawn = (seq: number, id: number) =>
  ({
    card: num(id, 4),
    flip: null,
    outcome: "kept",
    playerId: "id-1",
    seq,
    type: "draw",
  }) satisfies DealEvent;

const drawQuietly = (h: Harness, count: number) => {
  const { game } = h.stored;

  for (let index = 0; index < count; index += 1) {
    game.drawSeq += 1;
    game.dealSeq += 1;
    game.dealHistory = [
      ...game.dealHistory,
      drawn(game.dealSeq, 5000 + game.drawSeq),
    ].slice(-DEAL_HISTORY_LIMIT);
  }
};

describe("sending Deal playback history", () => {
  it("sends every kept draw to a tab that opens, and to one that rejoins", () => {
    const { ana, h } = roundWhereHostMovesFirst();

    h.connect("cat-tab");
    expect(h.room.snapshot().lists.dealHistory).toStrictEqual({
      after: null,
      entries: h.stored.game.dealHistory,
      seq: h.stored.game.dealSeq,
    });

    h.drop("ana-tab");
    h.connect("ana-tab-2");
    const opened = h.room.snapshot();
    h.room.join("ana-tab-2", "", ana.token);

    expect(opened.lists.dealHistory.after).toBeNull();
    expect(opened.lists.dealHistory.entries).toStrictEqual(
      h.stored.game.dealHistory
    );
    expect(opened.room.drawSeq).toBe(h.stored.game.drawSeq);
  });

  it("broadcasts only the draws made since the last broadcast", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "ready"));
    const { dealSeq: before, drawSeq } = h.stored.game;
    h.stored.game.deck = [num(903, 8)];

    const sent = broadcastOf(h.room.command("ana-tab", { type: "hit" }));

    expect(sent.lists.dealHistory).toStrictEqual({
      after: before,
      entries: [
        expect.objectContaining({ card: num(903, 8), seq: before + 1 }),
      ],
      seq: before + 1,
    });
    expect(sent.room).not.toHaveProperty("dealHistory");
    expect(sent.room.drawSeq).toBe(drawSeq + 1);
  });

  it("sends no draws when nothing was drawn", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "one"));

    const sent = broadcastOf(h.room.chat("ana-tab", "two"));

    expect(sent.lists.dealHistory).toStrictEqual({
      after: h.stored.game.dealSeq,
      entries: [],
      seq: h.stored.game.dealSeq,
    });
  });

  it("carries draws on across a new round and a new game", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "ready"));
    const { game } = h.stored;
    const endOfRound = game.dealSeq;

    game.phase = "roundOver";
    game.deck = [num(904, 6), num(905, 9)];

    const round = broadcastOf(
      h.room.command("ana-tab", { requestId: "r1", type: "nextRound" })
    );

    expect(round.lists.dealHistory.after).toBe(endOfRound);
    expect(dealSeqs(round)[0]).toBe(endOfRound + 1);
    expect(dealSeqs(round).at(-1)).toBe(game.dealSeq);

    const endOfGame = game.dealSeq;
    game.phase = "gameOver";
    const again = broadcastOf(h.room.command("ana-tab", { type: "start" }));

    expect(again.lists.dealHistory.after).toBe(endOfGame);
    expect(dealSeqs(again)[0]).toBe(endOfGame + 1);
  });

  it("includes draws made without a broadcast in the next one", () => {
    const { h } = roundWhereHostMovesFirst();

    const before = broadcastOf(h.room.chat("ana-tab", "one")).lists.dealHistory
      .seq;

    drawQuietly(h, 3);

    const sent = broadcastOf(h.room.chat("ana-tab", "two"));

    expect(sent.lists.dealHistory.after).toBe(before);
    expect(dealSeqs(sent)).toStrictEqual([before + 1, before + 2, before + 3]);
  });

  it("sends every kept draw when more were made than it keeps", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "one"));
    drawQuietly(h, DEAL_HISTORY_LIMIT + 1);

    const sent = broadcastOf(h.room.chat("ana-tab", "two"));

    expect(sent.lists.dealHistory.after).toBeNull();
    expect(sent.lists.dealHistory.entries).toStrictEqual(
      h.stored.game.dealHistory
    );
    expect(sent.lists.dealHistory.entries).toHaveLength(DEAL_HISTORY_LIMIT);
  });

  it("sends every kept draw when the last broadcast is ahead of the room", () => {
    const { h } = roundWhereHostMovesFirst();
    const { dealSeq } = h.stored.game;
    h.stored.broadcastSeqs = {
      dealHistory: dealSeq + 5,
      log: h.stored.game.logSeq,
    };

    const sent = broadcastOf(h.room.chat("ana-tab", "after a restore"));

    expect(sent.lists.dealHistory).toStrictEqual({
      after: null,
      entries: h.stored.game.dealHistory,
      seq: dealSeq,
    });
  });

  it("builds a full recovery snapshot of draws without changing the stored room", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "one"));
    const stored = structuredClone(h.stored);

    const snapshot = h.room.snapshot();

    expect(snapshot.lists.dealHistory.after).toBeNull();
    expect(snapshot.lists.dealHistory.entries).toStrictEqual(
      h.stored.game.dealHistory
    );
    expect(h.stored).toStrictEqual(stored);
  });

  it("remembers which draws it broadcast across hibernation", () => {
    const { h } = roundWhereHostMovesFirst();
    broadcastOf(h.room.chat("ana-tab", "one"));
    const before = h.stored.game.dealSeq;
    const saved = structuredClone(h.stored);

    const woken = createRoom(
      saved,
      { assign: () => {}, connections: () => [] },
      { newId: () => "x", now: () => START, random }
    );

    saved.game.drawSeq += 1;
    saved.game.dealSeq = before + 1;
    saved.game.dealHistory = [
      ...saved.game.dealHistory,
      drawn(before + 1, 7001),
    ];

    expect(broadcastOf(woken.reconcile()).lists.dealHistory).toStrictEqual({
      after: before,
      entries: [drawn(before + 1, 7001)],
      seq: before + 1,
    });
  });
});

describe("spectating a room", () => {
  it("only shares live state after admission and returns to the preview after Stop watching", () => {
    const h = harness();
    joinAs(h, "host", "Ana");
    h.room.chat("host", "Private table chat");
    h.connect("guest");

    expect(h.room.viewFor("guest")).toStrictEqual({
      room: {
        code: "ABCDE",
        locked: false,
        phase: "lobby",
        players: [
          { avatar: h.stored.game.players[0]?.avatar, id: "id-1", name: "Ana" },
        ],
        spectatorCount: 0,
      },
      type: "preview",
    });
    const admitted = h.room.watch("guest");
    expect(replies(admitted)).toMatchObject([
      { type: "watching" },
      {
        lists: { log: { after: null } },
        room: { spectatorCount: 1 },
        type: "state",
      },
    ]);
    expect([
      ...replies(h.room.chat("guest", "hi")),
      ...replies(h.room.command("guest", { type: "start" })),
    ]).toStrictEqual([
      { message: "Join the room first.", type: "error" },
      { message: "Join the room first.", type: "error" },
    ]);

    expect(broadcastOf(h.room.stopWatching("guest")).room.spectatorCount).toBe(
      0
    );
    expect(h.room.viewFor("guest").type).toBe("preview");
  });

  it("allows watching a full roster and limits watchers independently", () => {
    const h = harness();

    for (let index = 0; index < MAX_PLAYERS; index += 1) {
      joinAs(h, `player-${index}`, `Player ${index}`);
    }

    for (let index = 0; index < MAX_SPECTATORS; index += 1) {
      const connection = `watcher-${index}`;
      h.connect(connection);
      expect(replies(h.room.watch(connection))[0]).toStrictEqual({
        type: "watching",
      });
    }

    h.connect("extra");
    expect(replies(h.room.watch("extra"))[0]).toMatchObject({
      type: "watchError",
    });
    expect(broadcastOf(h.drop("watcher-0")).room.spectatorCount).toBe(
      MAX_SPECTATORS - 1
    );
    expect(broadcastOf(h.room.watch("extra")).room.spectatorCount).toBe(
      MAX_SPECTATORS
    );
    expect(h.stored.game.players).toHaveLength(MAX_PLAYERS);
  });

  it("keeps play paused with only Spectators connected and clears stale watchers", () => {
    const { h } = roundWhereHostMovesFirst();
    h.connect("guest");
    h.room.watch("guest");
    h.drop("ana-tab");
    h.drop("ben-tab");
    const { drawSeq, hostId, turnId } = h.stored.game;

    h.advance(IDLE_EXPIRY_MS);
    h.ping("guest");
    expect(h.room.alarm().expired).toBeFalsy();
    expect(h.stored.game).toMatchObject({ drawSeq, hostId, turnId });
    expect(h.stored).toMatchObject({
      botTurn: null,
      hostLeftAt: null,
      stall: null,
    });

    h.advance(HEARTBEAT_STALE_MS);
    const stale = h.room.alarm();
    expect(closes(stale)).toMatchObject([{ connectionId: "guest" }]);
    expect(broadcastOf(stale).room.spectatorCount).toBe(0);
  });

  it("pauses a scheduled bot move when its only human player disconnects", () => {
    const h = harness();
    const host = joinAs(h, "host", "Ana");
    h.room.command("host", { type: "addBot" });
    h.connect("guest");
    h.room.watch("guest");

    const { game } = h.stored;
    startGame(game, host.playerId, random);
    game.phase = "roundOver";
    game.round = 0;
    game.dealerIndex = 1;
    game.deck = [num(901, 5), num(902, 3)].toReversed();
    h.room.command("host", { type: "nextRound" });
    expect(h.stored.botTurn).not.toBeNull();

    const { drawSeq, turnId } = game;
    h.drop("host");
    h.advance(HOST_GRACE_MS);
    h.ping("guest");
    h.room.alarm();

    expect(h.stored.botTurn).toBeNull();
    expect(game).toMatchObject({ drawSeq, turnId });
  });

  it("lets a seated player give up their seat and keep watching on the same connection", () => {
    const h = harness();
    joinAs(h, "host", "Ana");
    const ben = joinAs(h, "ben-tab", "Ben");
    h.connect("ben-other-tab");
    h.room.join("ben-other-tab", "", ben.token);

    const switched = h.room.watchInstead("ben-tab");

    expect(replies(switched)).toMatchObject([
      { type: "watching" },
      { room: { spectatorCount: 1 }, type: "state" },
    ]);
    expect(closes(switched)).toMatchObject([
      { connectionId: "ben-other-tab", reason: "left" },
    ]);
    expect({
      names: h.stored.game.players.map(({ name }) => name),
      seat: h.seatOf("ben-tab"),
      token: Object.hasOwn(h.stored.tokens, ben.playerId),
    }).toStrictEqual({
      names: ["Ana"],
      seat: { watchedAt: START },
      token: false,
    });
    expect(logEvents(broadcastOf(switched).lists.log.entries)).toContainEqual(
      expect.objectContaining({ how: "leftToWatch", type: "evicted" })
    );
  });

  it("keeps the last human seated when watching would leave only bots", () => {
    const h = harness();
    joinAs(h, "host", "Ana");
    h.room.command("host", { type: "addBot" });

    const refused = h.room.watchInstead("host");

    expect(refused.expired).toBeFalsy();
    expect(replies(refused)).toMatchObject([{ type: "watchError" }]);
    expect(h.stored.game.players).toHaveLength(2);
    expect(h.seatOf("host")).toHaveProperty("playerId");
  });

  it("keeps a player seated when the game starts before their switch to watching arrives", () => {
    const h = harness();
    const host = joinAs(h, "host", "Ana");
    joinAs(h, "ben-tab", "Ben");
    startGame(h.stored.game, host.playerId, random);

    const refused = h.room.watchInstead("ben-tab");

    expect(replies(refused)).toMatchObject([{ type: "watchError" }]);
    expect(closes(refused)).toStrictEqual([]);
    expect(h.stored.game.players.map(({ name }) => name)).toStrictEqual([
      "Ana",
      "Ben",
    ]);
    expect(h.seatOf("ben-tab")).toHaveProperty("playerId");
  });

  it("keeps a player seated when the spectator limit is reached", () => {
    const h = harness();
    joinAs(h, "host", "Ana");
    joinAs(h, "ben-tab", "Ben");

    for (let index = 0; index < MAX_SPECTATORS; index += 1) {
      h.connect(`watcher-${index}`);
      h.room.watch(`watcher-${index}`);
    }

    expect(replies(h.room.watchInstead("ben-tab"))).toMatchObject([
      { message: "The spectator limit has been reached.", type: "watchError" },
    ]);
    expect(h.seatOf("ben-tab")).toHaveProperty("playerId");
  });

  it("deletes a table of bots when the last human player leaves while someone watches", () => {
    const h = harness();
    joinAs(h, "host", "Ana");
    h.room.command("host", { type: "addBot" });
    h.connect("guest");
    h.room.watch("guest");

    expect(h.room.command("host", { type: "leave" }).expired).toBeTruthy();
  });
});

const deliveredBy = (
  h: Harness,
  result: RoomOutcome | RoomPassing,
  sender?: string
) => {
  const sent: Record<string, string[]> = {};
  const closed: string[] = [];

  const transport: RoomTransport = {
    close: (connectionId) => {
      closed.push(connectionId);
    },
    send: (connectionId, message) => {
      sent[connectionId] = [...(sent[connectionId] ?? []), message.type];
    },
  };

  deliver(result, { seats: h.seats, sender, transport });

  return { closed, sent };
};

describe("receiving a message", () => {
  it("routes each message to its rule and saves only what changes the room", () => {
    const h = harness();
    h.connect("ana-tab");

    const joined = h.room.receive("ana-tab", {
      avatar: 0,
      name: "Ana",
      token: null,
      type: "join",
    });

    expect(welcomeOf(joined).playerId).toBe(h.stored.game.players[0]?.id);

    const typing = h.room.receive("ana-tab", { active: true, type: "typing" });
    const sync = h.room.receive("ana-tab", { type: "sync" });

    expect([typing.save, sync.save]).toStrictEqual([false, false]);
    expect(sync.effects).toMatchObject([
      { message: { type: "state" }, type: "reply" },
    ]);

    const chatted = h.room.receive("ana-tab", { text: "hi", type: "chat" });

    expect([joined.save, chatted.save]).toStrictEqual([true, true]);
    expect(h.stored.game.log.at(-1)).toMatchObject({ text: "hi" });
  });

  it("sends the live table only to admitted connections and the join preview to visitors", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    h.connect("visitor");
    h.connect("watcher");
    h.room.watch("watcher");

    const { sent } = deliveredBy(
      h,
      h.room.receive("ana-tab", { text: "hi", type: "chat" }),
      "ana-tab"
    );

    expect(sent).toStrictEqual({
      "ana-tab": ["state"],
      visitor: ["preview"],
      watcher: ["state"],
    });
  });

  it("relays typing to other admitted connections only and replies only to the sender", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    joinAs(h, "ben-tab", "Ben");
    h.connect("visitor");

    const typing = deliveredBy(
      h,
      h.room.receive("ana-tab", { active: true, type: "typing" }),
      "ana-tab"
    );

    const sync = deliveredBy(
      h,
      h.room.receive("visitor", { type: "sync" }),
      "visitor"
    );

    expect([typing.sent, sync.sent]).toStrictEqual([
      { "ben-tab": ["typing"] },
      { visitor: ["preview"] },
    ]);
  });

  it("broadcasts nothing from a room that expired", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    h.room.receive("ana-tab", { type: "addBot" });
    h.connect("visitor");

    const left = h.room.receive("ana-tab", { type: "leave" });

    expect(left.save && left.expired).toBeTruthy();
    expect(deliveredBy(h, left, "ana-tab")).toStrictEqual({
      closed: ["ana-tab"],
      sent: {},
    });
  });
});
