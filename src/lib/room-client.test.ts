import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseClientMessage } from "../game/client-message";
import { ROOM_REMOVED_CLOSE_CODE } from "../game/protocol";
import type { ServerMessage } from "../game/protocol";
import { createRoom, deliver, newStoredRoom } from "../game/room";
import type { RoomOutcome, Seat, Seats } from "../game/room";
import { createRoomClient } from "./room-client";
import type { RoomClientDeps } from "./room-client";

const START = 1_000_000;
const REPLY_TIMEOUT_MS = 6000;
const RESYNC_TIMEOUT_MS = 10_000;
const DROPPED_CLOSE_CODE = 1006;

type Delivery = ServerMessage | { closeCode: number };

interface Link {
  id: string;
  open: boolean;
  toServer: string[];
  toClient: Delivery[];
}

interface ServerConnection {
  seat: Seat | null;
  lastPing: Date | null;
}

const hasTraffic = (links: Map<string, Link>) =>
  [...links.values()].some(
    (link) => link.toServer.length > 0 || link.toClient.length > 0
  );

const network = () => {
  let linkCount = 0;
  let idCount = 0;
  const connections = new Map<string, ServerConnection>();
  const links = new Map<string, Link>();
  const players: TestPlayer[] = [];
  const syncs: string[] = [];

  const seats: Seats = {
    assign: (connectionId, seat) => {
      const connection = connections.get(connectionId);

      if (connection) {
        connection.seat = seat;
      }
    },
    connections: () =>
      Array.from(connections, ([id, connection]) => ({ id, ...connection })),
  };

  const stored = newStoredRoom("ABCDE", START);

  const room = createRoom(stored, seats, {
    newId: () => {
      idCount += 1;

      return `id-${idCount}`;
    },
    now: () => START,
    random: () => 0.5,
  });

  const carryOut = (outcome: RoomOutcome, sender: Link | null) => {
    deliver(outcome, {
      broadcast: (message) => {
        for (const link of links.values()) {
          if (link.open) {
            link.toClient.push(message);
          }
        }
      },
      close: (connectionId, code) => {
        connections.delete(connectionId);
        links.get(connectionId)?.toClient.push({ closeCode: code });
      },
      reply: (message) => {
        sender?.toClient.push(message);
      },
    });
  };

  const handleFrame = (link: Link, frame: string) => {
    const message = parseClientMessage(frame);

    if (!message) {
      throw new Error(`Unparseable frame ${frame}`);
    }

    if (message.type === "join") {
      carryOut(
        room.join(link.id, message.name, message.token, message.avatar),
        link
      );
    } else if (message.type === "chat") {
      carryOut(room.chat(link.id, message.text), link);
    } else if (message.type === "sync") {
      syncs.push(link.id);
      link.toClient.push(room.snapshot());
    } else {
      carryOut(room.command(link.id, message), link);
    }
  };

  const flushToServer = () => {
    for (const link of links.values()) {
      for (const frame of link.toServer.splice(0)) {
        handleFrame(link, frame);
      }
    }
  };

  const flushToClients = () => {
    for (const player of players) {
      const { link } = player;

      for (const delivery of link?.toClient.splice(0) ?? []) {
        if (player.link !== link || !link) {
          break;
        }

        if ("closeCode" in delivery) {
          link.open = false;
          links.delete(link.id);
          player.link = null;
          player.client.closed(delivery.closeCode, 0);
        } else {
          player.client.received(delivery);
        }
      }
    }
  };

  const flush = () => {
    while (hasTraffic(links)) {
      flushToServer();
      flushToClients();
    }
  };

  const connect = (player: TestPlayer) => {
    linkCount += 1;

    const link: Link = {
      id: `conn-${linkCount}`,
      open: true,
      toClient: [room.snapshot()],
      toServer: [],
    };

    links.set(link.id, link);
    connections.set(link.id, { lastPing: null, seat: null });
    player.link = link;
    player.client.opened();
  };

  const drop = (player: TestPlayer, retryCount = 0) => {
    const { link } = player;

    if (!link) {
      return;
    }

    link.open = false;
    links.delete(link.id);
    player.link = null;
    const seat = connections.get(link.id)?.seat ?? null;
    connections.delete(link.id);
    carryOut(room.disconnect(seat), null);
    player.client.closed(DROPPED_CLOSE_CODE, retryCount);
  };

  const join = (name: string) => {
    const player = testPlayer(players);
    connect(player);
    flush();
    player.client.join(name);
    flush();

    return player;
  };

  return {
    connect,
    drop,
    flush,
    flushToServer,
    join,
    players,
    stored,
    syncs,
    testPlayer: () => testPlayer(players),
  };
};

interface TestPlayer {
  client: ReturnType<typeof createRoomClient>;
  link: Link | null;
  replacements: number;
  token: string | null;
}

const testPlayer = (players: TestPlayer[]) => {
  const player: TestPlayer = {
    client: createRoomClient({
      newId: () => crypto.randomUUID(),
      roomExists: async () => await Promise.resolve(true),
      socket: {
        close: () => {
          player.link = null;
        },
        isOpen: () => player.link?.open === true,
        reconnect: () => {},
        replace: () => {
          player.replacements += 1;
        },
        send: (frame) => {
          if (player.link?.open !== true) {
            return false;
          }

          player.link.toServer.push(frame);

          return true;
        },
      },
      token: {
        get: () => player.token,
        set: (token) => {
          player.token = token;
        },
      },
    }),
    link: null,
    replacements: 0,
    token: null,
  };

  players.push(player);

  return player;
};

describe("joining through the room client", () => {
  it("asks a new player for a name, then seats them", () => {
    const net = network();
    const ana = net.testPlayer();
    net.connect(ana);
    net.flush();

    expect(ana.client.state).toMatchObject({
      needsName: true,
      ready: false,
      status: "open",
    });

    ana.client.join("Ana");
    net.flush();

    expect(ana.client.state).toMatchObject({
      canAct: true,
      needsName: false,
      playerId: "id-1",
      ready: true,
    });
    expect(ana.token).toBe("id-2");
    expect(ana.client.state.room?.players.map((p) => p.name)).toStrictEqual([
      "Ana",
    ]);
  });

  it("rejoins with the saved token after a dropped connection", () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");
    net.drop(ana);

    expect(ana.client.state).toMatchObject({
      canAct: false,
      status: "reconnecting",
    });

    net.connect(ana);
    net.flush();

    expect(ana.client.state).toMatchObject({
      playerId: "id-1",
      ready: true,
      status: "open",
    });
    expect(net.stored.game.players).toHaveLength(2);
  });

  it("lets a player correct a rejected name and retry", () => {
    const net = network();
    net.join("Ana");
    const guest = net.testPlayer();
    net.connect(guest);
    net.flush();

    guest.client.join("Ana");
    guest.client.join("Ben");
    expect(guest.client.state.joining).toBeTruthy();
    net.flush();

    expect(guest.client.state).toMatchObject({
      joinError: "Someone here is already called Ana.",
      joining: false,
      needsName: true,
      notice: null,
    });

    guest.client.join("Ben");
    net.flush();
    expect(guest.client.state).toMatchObject({
      joinError: "",
      joining: false,
      needsName: false,
      ready: true,
    });
  });
});

const logIds = (player: TestPlayer) =>
  player.client.state.room?.log.map((entry) => entry.id);

const serverLogIds = (net: ReturnType<typeof network>) =>
  net.stored.game.log.map((entry) => entry.id);

describe("the log through the room client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds each broadcast's new entries to the log it has", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const before = ben.client.state.room?.log;

    ana.client.chat("hi Ben");
    net.flush();

    expect(logIds(ben)).toStrictEqual(serverLogIds(net));
    expect(ben.client.state.room?.log.slice(0, -1)).toStrictEqual(before);
    expect(ben.client.state.room?.log.at(-1)?.text).toBe("hi Ben");
    expect(net.syncs).toStrictEqual([]);
  });

  it("keeps the same log when a broadcast adds nothing", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    net.connect(net.testPlayer());
    const before = ana.client.state.room?.log;

    net.drop(ben);
    net.flush();

    expect(ana.client.state.room?.log).toBe(before);
  });

  it("replaces the log when a game starts", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    ben.client.chat("lobby chat");
    net.flush();

    const sent = ana.client.send({ type: "start" });
    net.flush();
    await sent;

    for (const player of [ana, ben]) {
      expect(logIds(player)).toStrictEqual(serverLogIds(net));
      expect(
        player.client.state.room?.log.some(
          (entry) => entry.text === "lobby chat"
        )
      ).toBeFalsy();
    }
  });

  it("catches up on entries missed while reconnecting", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const sent = ana.client.send({ type: "start" });
    net.flushToServer();
    net.drop(ana);
    ben.client.chat("you there?");
    net.flush();

    net.connect(ana);
    net.flush();

    await expect(sent).resolves.toBeTruthy();
    expect(logIds(ana)).toStrictEqual(serverLogIds(net));
    expect(ana.client.state.room?.log.at(-1)?.text).toBe("you there?");
    expect(net.syncs).toStrictEqual([]);
  });

  it("asks for the whole log when it misses a broadcast, then carries on", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");

    ben.client.chat("one");
    net.flushToServer();
    ana.link?.toClient.splice(0);
    ben.client.chat("two");
    net.flush();

    expect(net.syncs).toStrictEqual([ana.link?.id]);
    expect(logIds(ana)).toStrictEqual(serverLogIds(net));

    ben.client.chat("three");
    net.flush();

    expect(logIds(ana)).toStrictEqual(serverLogIds(net));
    expect(net.syncs).toHaveLength(1);
  });

  it("asks only once while waiting for the whole log", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");

    ben.client.chat("one");
    net.flushToServer();
    ana.link?.toClient.splice(0);
    ben.client.chat("two");
    ben.client.chat("three");
    net.flushToServer();
    const queued = ana.link?.toClient.splice(0) ?? [];

    for (const delivery of queued) {
      if (!("closeCode" in delivery)) {
        ana.client.received(delivery);
      }
    }

    expect(
      ana.link?.toServer.filter((frame) => frame.includes("sync"))
    ).toHaveLength(1);
    expect(
      ana.client.state.room?.log.some((entry) => entry.text === "two")
    ).toBeFalsy();

    net.flush();
    expect(logIds(ana)).toStrictEqual(serverLogIds(net));
  });
});

describe("recovering a stuck connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces the socket on a return to visibility only while reconnecting", () => {
    const net = network();
    const ana = net.join("Ana");
    const hidden = { online: true, visible: false };
    const visible = { online: true, visible: true };

    ana.client.browserStateChanged(hidden);
    ana.client.browserStateChanged(visible);
    expect(ana.replacements).toBe(0);

    net.drop(ana);
    ana.client.browserStateChanged(visible);
    expect(ana.replacements).toBe(0);

    ana.client.browserStateChanged(hidden);
    ana.client.browserStateChanged(visible);
    ana.client.browserStateChanged(visible);
    expect(ana.replacements).toBe(1);
  });

  it("starts over when the connection stays down", () => {
    const net = network();
    const ana = net.join("Ana");
    net.drop(ana);
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS / 2);
    ana.client.closed(DROPPED_CLOSE_CODE, 1);
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS / 2);

    expect(ana.replacements).toBe(1);
    expect(ana.client.state.status).toBe("reconnecting");

    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS);

    expect(ana.replacements).toBe(2);
  });

  it("starts over when a rejoin gets no reply", () => {
    const net = network();
    const ana = net.join("Ana");
    net.drop(ana);
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS - 1);
    net.connect(ana);
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS - 1);

    expect(ana.replacements).toBe(0);

    vi.advanceTimersByTime(1);

    expect(ana.replacements).toBe(1);
    expect(ana.client.state.status).toBe("reconnecting");
  });

  it("stops watching once the table is back in sync", () => {
    const net = network();
    const ana = net.join("Ana");
    net.drop(ana);
    net.connect(ana);
    net.flush();
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS * 3);

    expect(ana.replacements).toBe(0);
    expect(ana.client.state.status).toBe("open");
  });

  it("doesn't start over while waiting for a new player's name", () => {
    const net = network();
    const ana = net.testPlayer();
    net.connect(ana);
    net.flush();
    vi.advanceTimersByTime(RESYNC_TIMEOUT_MS * 3);

    expect(ana.replacements).toBe(0);
    expect(ana.client.state.needsName).toBeTruthy();
  });
});

describe("a pending move", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true once the room accepts it", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const sent = ana.client.send({ type: "start" });
    expect(ana.client.state).toMatchObject({ canAct: false, sending: true });
    net.flush();

    await expect(sent).resolves.toBeTruthy();
    expect(ana.client.state.sending).toBeFalsy();
    expect(ana.client.state.room?.phase).toBe("playing");
  });

  it("confirms a pending move after returning to a visible, online page", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");
    const visibleAndOnline = { online: true, visible: true };
    ana.client.browserStateChanged(visibleAndOnline);

    const sent = ana.client.send({ type: "start" });
    net.flushToServer();
    ana.client.browserStateChanged({ online: true, visible: false });
    net.drop(ana);
    ana.client.browserStateChanged({ online: false, visible: true });
    expect(ana.replacements).toBe(0);

    ana.client.browserStateChanged(visibleAndOnline);
    ana.client.browserStateChanged(visibleAndOnline);
    expect(ana.replacements).toBe(1);
    expect(ana.client.state).toMatchObject({ canAct: false, sending: true });

    net.connect(ana);
    net.flush();
    ana.client.browserStateChanged(visibleAndOnline);

    await expect(sent).resolves.toBeTruthy();
    expect({
      replacements: ana.replacements,
      state: ana.client.state,
    }).toMatchObject({
      replacements: 1,
      state: {
        canAct: true,
        notice: {
          confirmed: true,
          message: "Reconnected. Your last move counted.",
        },
        sending: false,
      },
    });
  });

  it("can't confirm a move lost with the connection", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const sent = ana.client.send({ type: "start" });
    net.drop(ana);
    net.connect(ana);
    net.flush();

    await expect(sent).resolves.toBeFalsy();
    expect(ana.client.state.notice?.message).toBe(
      "Couldn't confirm your last move. The table is up to date."
    );
    expect(net.stored.game.phase).toBe("lobby");
  });

  it("reconnects when no reply comes in time", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const sent = ana.client.send({ type: "start" });
    net.flushToServer();
    ana.link?.toClient.splice(0);
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS);

    expect(ana.client.state.status).toBe("reconnecting");
    expect(ana.replacements).toBe(1);

    net.drop(ana);
    net.connect(ana);
    net.flush();

    await expect(sent).resolves.toBeTruthy();
  });

  it("allows only one at a time", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const first = ana.client.send({ type: "start" });

    await expect(ana.client.send({ type: "start" })).resolves.toBeFalsy();
    net.flush();
    await expect(first).resolves.toBeTruthy();
  });

  it("says why the room rejected it", async () => {
    const net = network();
    net.join("Ana");
    const ben = net.join("Ben");

    const sent = ben.client.send({ type: "start" });
    net.flush();

    await expect(sent).resolves.toBeFalsy();
    expect(ben.client.state.notice?.message).toBe("Only the host can do that.");
  });

  it("isn't sent while offline", async () => {
    const net = network();
    const ana = net.join("Ana");
    ana.client.browserStateChanged({ online: false, visible: true });

    expect(ana.client.state.canAct).toBeFalsy();
    await expect(ana.client.send({ type: "start" })).resolves.toBeFalsy();
    expect(ana.client.state.notice?.message).toBe(
      "Reconnecting. Try again in a moment."
    );
  });
});

describe("room commands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("change settings without holding up the player's moves", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const configured = ana.client.send({ botSpeed: "fast", type: "configure" });
    expect(ana.client.state).toMatchObject({ canAct: true, sending: false });

    const started = ana.client.send({ type: "start" });
    expect(ana.client.state).toMatchObject({ canAct: false, sending: true });
    net.flush();

    await expect(configured).resolves.toBeTruthy();
    await expect(started).resolves.toBeTruthy();
    expect(ana.client.state.room).toMatchObject({
      botSpeed: "fast",
      phase: "playing",
    });
  });

  it("remove a player while a move waits for the room", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");
    const cara = net.join("Cara");
    const caraId = cara.client.state.playerId ?? "";

    const started = ana.client.send({ type: "start" });
    const kicked = ana.client.send({ playerId: caraId, type: "kick" });
    net.flush();

    await expect(started).resolves.toBeTruthy();
    await expect(kicked).resolves.toBeTruthy();
    expect(net.stored.game.players.map((player) => player.name)).toStrictEqual([
      "Ana",
      "Ben",
    ]);
  });

  it("don't stop a move sent before them from being confirmed after a reconnect", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const started = ana.client.send({ type: "start" });
    const configured = ana.client.send({ locked: true, type: "configure" });
    net.flushToServer();
    net.drop(ana);
    net.connect(ana);
    net.flush();

    await expect(configured).resolves.toBeFalsy();
    await expect(started).resolves.toBeTruthy();
    expect(ana.client.state.notice?.message).toBe(
      "Reconnected. Your last move counted."
    );
  });

  it("say why the room rejected them", async () => {
    const net = network();
    net.join("Ana");
    const ben = net.join("Ben");

    const sent = ben.client.send({ locked: true, type: "configure" });
    net.flush();

    await expect(sent).resolves.toBeFalsy();
    expect(ben.client.state.notice?.message).toBe("Only the host can do that.");
  });

  it("settles a room command whose reply never arrives", async () => {
    const net = network();
    const ana = net.join("Ana");
    const sent = ana.client.send({ locked: true, type: "configure" });

    net.flushToServer();
    ana.link?.toClient.splice(0);
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS);

    await expect(sent).resolves.toBeFalsy();
    expect(ana.client.state).toMatchObject({
      canAct: true,
      notice: { message: "The room couldn't confirm your request." },
      status: "open",
    });
  });

  it("settles all outstanding room commands and clears their timers on stop", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const configured = ana.client.send({ locked: true, type: "configure" });

    const kicked = ana.client.send({
      playerId: ben.client.state.playerId ?? "",
      type: "kick",
    });

    ana.client.stop();

    await expect(Promise.all([configured, kicked])).resolves.toStrictEqual([
      false,
      false,
    ]);
    vi.advanceTimersByTime(REPLY_TIMEOUT_MS);
    expect(ana.client.state.notice).toBeNull();
  });
});

describe("leaving the room", () => {
  it("lets a player leave while a move waits for the room", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const started = ana.client.send({ type: "start" });
    const left = ana.client.send({ type: "leave" });
    net.flush();

    await expect(started).resolves.toBeTruthy();
    await expect(left).resolves.toBeTruthy();
    expect(ana.client.state).toMatchObject({
      playerId: null,
      status: "removed",
    });
    expect(ana.token).toBeNull();
    expect(net.stored.game.players.map((player) => player.name)).toStrictEqual([
      "Ben",
    ]);
  });

  it("forgets a kicked player and stops", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const benId = ben.client.state.playerId ?? "";

    const sent = ana.client.send({ playerId: benId, type: "kick" });
    net.flush();

    await expect(sent).resolves.toBeTruthy();
    expect(ben.client.state).toMatchObject({
      playerId: null,
      status: "removed",
    });
    expect(ben.token).toBeNull();
  });
});

const scripted = (overrides: Partial<RoomClientDeps> = {}) => {
  const frames: string[] = [];
  let token: string | null = "saved-token";
  let closed = false;
  let replacements = 0;
  let retries = 0;

  const client = createRoomClient({
    newId: () => crypto.randomUUID(),
    roomExists: async () => await Promise.resolve(true),
    socket: {
      close: () => {
        closed = true;
      },
      isOpen: () => !closed,
      reconnect: () => {
        retries += 1;
      },
      replace: () => {
        replacements += 1;
      },
      send: (frame) => {
        frames.push(frame);

        return !closed;
      },
    },
    token: {
      get: () => token,
      set: (next) => {
        token = next;
      },
    },
    ...overrides,
  });

  return {
    client,
    frames,
    isClosed: () => closed,
    replacements: () => replacements,
    retries: () => retries,
    token: () => token,
  };
};

describe("the room client on its own", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for a name again when the saved token is refused", () => {
    const { client, frames, token } = scripted();
    client.opened();

    expect(frames).toStrictEqual([
      JSON.stringify({ name: "", token: "saved-token", type: "join" }),
    ]);

    client.received({ message: "This room is full.", type: "error" });

    expect(client.state).toMatchObject({
      needsName: true,
      notice: { message: "This room is full." },
      playerId: null,
      status: "open",
    });
    expect(token()).toBeNull();
  });

  it("stops when a re-check finds the room gone", async () => {
    const { client, isClosed } = scripted({
      roomExists: async () => await Promise.resolve(false),
    });

    client.opened();
    client.closed(DROPPED_CLOSE_CODE, 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.state.status).toBe("missing");
    expect(isClosed()).toBeTruthy();
  });

  it("doesn't re-check the room on every retry", async () => {
    let checks = 0;

    const { client } = scripted({
      roomExists: async () => {
        checks += 1;

        return await Promise.resolve(true);
      },
    });

    client.opened();

    for (const retryCount of [1, 2, 3, 4, 5, 6]) {
      client.closed(DROPPED_CLOSE_CODE, retryCount);
    }

    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(3);
  });

  it("retries the current socket after a missed heartbeat", () => {
    const { client, replacements, retries } = scripted();
    client.opened();
    client.heartbeatMissed();
    expect(retries()).toBe(1);
    expect(replacements()).toBe(0);

    client.stop();
    client.heartbeatMissed();
    expect(retries()).toBe(1);
  });

  it("starts a fresh connection on retry until the room is gone", () => {
    const { client, replacements } = scripted();
    client.retry();
    expect(replacements()).toBe(1);

    client.closed(ROOM_REMOVED_CLOSE_CODE, 0);
    client.retry();
    expect(replacements()).toBe(1);
  });
});
