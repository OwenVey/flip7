import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseClientMessage } from "../game/client-message";
import type { ServerMessage } from "../game/protocol";
import { createRoom, deliver, newStoredRoom } from "../game/room";
import type { RoomOutcome, Seat, Seats } from "../game/room";
import { createRoomClient } from "./room-client";
import type { RoomClientDeps } from "./room-client";

const START = 1_000_000;
const REPLY_TIMEOUT_MS = 6000;
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
      broadcast: () => {
        for (const link of links.values()) {
          if (link.open) {
            link.toClient.push(room.state());
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
      carryOut(room.join(link.id, message.name, message.token), link);
    } else if (message.type === "chat") {
      carryOut(room.chat(link.id, message.text), link);
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
      toClient: [room.state()],
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
    testPlayer: () => testPlayer(players),
  };
};

interface TestPlayer {
  client: ReturnType<typeof createRoomClient>;
  link: Link | null;
  reconnects: number;
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
        reconnect: () => {
          player.reconnects += 1;
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
    reconnects: 0,
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

  it("counts a move the room got before the connection dropped", async () => {
    const net = network();
    const ana = net.join("Ana");
    net.join("Ben");

    const sent = ana.client.send({ type: "start" });
    net.flushToServer();
    net.drop(ana);
    net.connect(ana);
    net.flush();

    await expect(sent).resolves.toBeTruthy();
    expect(ana.client.state.notice).toMatchObject({
      confirmed: true,
      message: "Reconnected. Your last move counted.",
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
    expect(ana.reconnects).toBe(1);

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
    ana.client.setOnline(false);

    expect(ana.client.state.canAct).toBeFalsy();
    await expect(ana.client.send({ type: "start" })).resolves.toBeFalsy();
    expect(ana.client.state.notice?.message).toBe(
      "Reconnecting. Try again in a moment."
    );
  });
});

describe("leaving the room", () => {
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
  let reconnects = 0;

  const client = createRoomClient({
    newId: () => crypto.randomUUID(),
    roomExists: async () => await Promise.resolve(true),
    socket: {
      close: () => {
        closed = true;
      },
      isOpen: () => !closed,
      reconnect: () => {
        reconnects += 1;
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
    reconnects: () => reconnects,
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

  it("reconnects on resume only while the connection is down", () => {
    const { client, reconnects } = scripted();
    client.opened();
    client.resume();
    expect(reconnects()).toBe(0);

    client.closed(DROPPED_CLOSE_CODE, 0);
    client.resume();
    expect(reconnects()).toBe(1);
  });
});
