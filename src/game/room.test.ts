import { describe, expect, it } from "vitest";

import type { Card } from "./cards";
import { nextRound, startGame } from "./engine";
import { HEARTBEAT_STALE_MS, ROOM_REMOVED_CLOSE_CODE } from "./protocol";
import type { ServerMessage } from "./protocol";
import { createRoom, newStoredRoom } from "./room";
import type { RoomOutcome, Seat, Seats } from "./room";
import { ABSENT_GRACE_MS, HOST_GRACE_MS, IDLE_EXPIRY_MS } from "./timers";

const START = 1_000_000;
const random = () => 0.5;

const num = (id: number, value: number) =>
  ({ id, kind: "number", value }) satisfies Card;

interface OpenConnection {
  seat: Seat | null;
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
        connection.seat = seat;
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
      open.set(connectionId, { lastPing: null, seat: null });
    },
    drop: (connectionId: string) => {
      const seat = open.get(connectionId)?.seat ?? null;
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
    seatOf: (connectionId: string) => open.get(connectionId)?.seat ?? null,
    stored,
  };
};

type Harness = ReturnType<typeof harness>;

const replies = (outcome: RoomOutcome) =>
  outcome.effects.flatMap((effect) =>
    effect.type === "reply" ? [effect.message] : []
  );

const welcomeOf = (outcome: RoomOutcome) => {
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

const joinAs = (h: Harness, connectionId: string, name: string) => {
  h.connect(connectionId);

  return welcomeOf(h.room.join(connectionId, name, null));
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

    expect(outcome.effects).toStrictEqual([
      { type: "broadcast" },
      { message: { requestId: "move-1", type: "accepted" }, type: "reply" },
    ]);
    expect(h.stored.game.phase).toBe("playing");

    h.drop("ana-tab");
    h.connect("ana-tab-2");
    const ana = h.stored.tokens.get(h.stored.game.hostId ?? "");
    expect(welcomeOf(h.room.join("ana-tab-2", "", ana ?? null))).toMatchObject({
      lastRequestId: "move-1",
    });
    expect(h.stored.lastRequests?.has(ben.playerId)).toBeFalsy();
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

    expect(outcome.effects).toStrictEqual([
      { type: "broadcast" },
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
    expect(h.stored.tokens.has(ben.playerId)).toBeFalsy();
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
    expect(h.stored.lastRequests?.has(ben.playerId) ?? false).toBeFalsy();
    expect(h.stored.tokens.has(ben.playerId)).toBeFalsy();
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
    expect(h.stored.tokens.size).toBe(1);
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
    expect(h.room.state().room).toMatchObject({
      botSpeed: "fast",
      locked: false,
      targetScore: 100,
    });
    expect(h.stored.game.log.map((entry) => entry.text)).toContain(
      "The host set the winning score to 100."
    );
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
    expect(h.room.state().room.targetScore).toBe(200);
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
    expect(h.room.state().room).toMatchObject({
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
    expect(h.room.state().room.targetScore).toBe(200);

    h.connect("cara-tab");
    expect(replies(h.room.join("cara-tab", "Cara", null))).toStrictEqual([
      {
        message: "This room is locked. Ask the host to unlock it.",
        type: "error",
      },
    ]);
  });

  it("reads settings as defaults on rooms saved before settings", () => {
    const h = harness();
    joinAs(h, "ana-tab", "Ana");
    delete h.stored.game.settings;

    expect(h.room.state().room).toMatchObject({
      botSpeed: "normal",
      locked: false,
      targetScore: 200,
    });
  });
});
