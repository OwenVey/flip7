/* oxlint-disable eslint/no-await-in-loop -- Moves reach the room one at a time, in order. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseClientMessage } from "../game/client-message";
import { DEAL_HISTORY_LIMIT, isChat } from "../game/engine";
import type { LogEntry } from "../game/engine";
import {
  ROOM_REMOVED_CLOSE_CODE,
  TYPING_SEND_MS,
  TYPING_SHOWN_MS,
} from "../game/protocol";
import type { ServerMessage } from "../game/protocol";
import { createRoom, deliver, newStoredRoom } from "../game/room";
import type {
  Admission,
  RoomOutcome,
  RoomPassing,
  RoomTransport,
  Seats,
} from "../game/room";
import { createRoomClient } from "./room-client";
import type { RoomClientDeps } from "./room-client";

const chatText = (entry: LogEntry | undefined) =>
  entry !== undefined && isChat(entry) ? entry.text : undefined;

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
  admission: Admission | null;
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
        connection.admission = seat;
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

  const transport: RoomTransport = {
    close: (connectionId, code) => {
      connections.delete(connectionId);
      links.get(connectionId)?.toClient.push({ closeCode: code });
    },
    send: (connectionId, message) => {
      const link = links.get(connectionId);

      if (link?.open === true) {
        link.toClient.push(message);
      }
    },
  };

  const carryOut = (result: RoomOutcome | RoomPassing, sender?: string) => {
    deliver(result, { seats, sender, transport });
  };

  const handleFrame = (link: Link, frame: string) => {
    const message = parseClientMessage(frame);

    if (!message) {
      throw new Error(`Unparseable frame ${frame}`);
    }

    if (message.type === "sync") {
      syncs.push(link.id);
    }

    carryOut(room.receive(link.id, message), link.id);
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

    const id = `conn-${linkCount}`;

    const link: Link = {
      id,
      open: true,
      toClient: [room.viewFor(id)],
      toServer: [],
    };

    links.set(link.id, link);
    connections.set(link.id, { admission: null, lastPing: null });
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
    const seat = connections.get(link.id)?.admission ?? null;
    connections.delete(link.id);
    carryOut(room.disconnect(seat));
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
  watching: boolean;
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
      watchPreference: {
        get: () => player.watching,
        set: (watching) => {
          player.watching = watching;
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
    watching: false,
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

describe("typing through the room client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a player typing to everyone else until they send", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");

    ana.client.typing(true);
    net.flush();

    expect(ben.client.state.typing).toStrictEqual([ana.client.state.playerId]);
    expect(ana.client.state.typing).toStrictEqual([]);

    ana.client.chat("hi");
    net.flush();

    expect(ben.client.state.typing).toStrictEqual([]);
  });

  it("stops showing a player typing when they clear their draft", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");

    ana.client.typing(true);
    ana.client.typing(false);
    ana.client.typing(false);

    expect(
      ana.link?.toServer
        .map(parseClientMessage)
        .filter((message) => message?.type === "typing")
    ).toStrictEqual([
      { active: true, type: "typing" },
      { active: false, type: "typing" },
    ]);

    net.flush();

    expect(ben.client.state.typing).toStrictEqual([]);
  });

  it("stops showing a player typing when they go quiet", () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");

    ana.client.typing(true);
    net.flush();
    vi.advanceTimersByTime(TYPING_SHOWN_MS);

    expect(ben.client.state.typing).toStrictEqual([]);
  });

  it("keeps the typing start cooldown across a chat send", () => {
    const net = network();
    const ana = net.join("Ana");

    const sent = () =>
      ana.link?.toServer.filter((frame) => frame.includes('"typing"')).length;

    ana.client.typing(true);
    ana.client.typing(true);

    expect(sent()).toBe(1);

    vi.advanceTimersByTime(TYPING_SEND_MS);
    ana.client.typing(true);

    expect(sent()).toBe(2);

    ana.client.chat("hi");
    ana.client.typing(true);

    expect(sent()).toBe(2);

    vi.advanceTimersByTime(TYPING_SEND_MS);
    ana.client.typing(true);

    expect(sent()).toBe(3);
  });
});

describe("the log through the room client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates reactions in place and treats a player's Seats as one reactor", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const otherSeat = net.testPlayer();
    otherSeat.token = ana.token;
    const spectator = net.testPlayer();
    net.connect(otherSeat);
    net.connect(spectator);
    net.flush();
    spectator.client.watch();
    net.flush();
    ana.client.chat("hello");
    net.flush();
    const { logSeq: messageId } = net.stored.game;
    const before = ben.client.state.room?.log;

    const first = ana.client.send({ emoji: "👍", messageId, type: "react" });
    net.flush();
    await expect(first).resolves.toBeTruthy();
    expect(ben.client.state.room?.log).toBe(before);
    const anaId = ana.client.state.playerId ?? "";
    expect(
      [ben, spectator, otherSeat].map(
        ({ client }) => client.state.room?.reactions
      )
    ).toStrictEqual(
      Array.from({ length: 3 }, () => ({ [messageId]: { [anaId]: "👍" } }))
    );

    const replacement = otherSeat.client.send({
      emoji: "❤️",
      messageId,
      type: "react",
    });

    net.flush();
    await replacement;
    expect(spectator.client.state.room?.reactions).toStrictEqual({
      [messageId]: { [anaId]: "❤️" },
    });
  });

  it("restores confirmed reactions after reconnecting without replaying offline taps", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    ben.client.chat("hello");
    net.flush();
    const { logSeq: messageId } = net.stored.game;
    const initial = ana.client.send({ emoji: "❤️", messageId, type: "react" });
    net.flush();
    await initial;

    net.drop(ana);
    await expect(
      ana.client.send(
        { emoji: "🎉", messageId, type: "react" },
        { quiet: true }
      )
    ).resolves.toBeFalsy();
    net.connect(ana);
    net.flush();
    expect(ana.client.state).toMatchObject({
      notice: null,
      room: {
        reactions: { [messageId]: { [ana.client.state.playerId ?? ""]: "❤️" } },
      },
    });

    const removal = ana.client.send({ emoji: null, messageId, type: "react" });
    net.flush();
    await expect(removal).resolves.toBeTruthy();
    expect(ben.client.state.room?.reactions).toStrictEqual({});
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
    expect(chatText(ben.client.state.room?.log.at(-1))).toBe("hi Ben");
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
          (entry) => isChat(entry) && entry.text === "lobby chat"
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
    expect(chatText(ana.client.state.room?.log.at(-1))).toBe("you there?");
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
      ana.client.state.room?.log.some(
        (entry) => isChat(entry) && entry.text === "two"
      )
    ).toBeFalsy();

    net.flush();
    expect(logIds(ana)).toStrictEqual(serverLogIds(net));
  });
});

type Network = ReturnType<typeof network>;

const serverDealHistory = (net: Network) => ({
  dealSeq: net.stored.game.dealSeq,
  drawSeq: net.stored.game.drawSeq,
  dealHistory: net.stored.game.dealHistory,
});

const dealHistoryOf = (player: TestPlayer) => ({
  dealSeq: player.client.state.room?.dealSeq,
  drawSeq: player.client.state.room?.drawSeq,
  dealHistory: player.client.state.room?.dealHistory,
});

const sendNextMove = async (net: Network) => {
  const { game } = net.stored;

  const byId = (id: string | null | undefined) =>
    net.players.find(
      (player) => player.link !== null && player.client.state.playerId === id
    );

  const host = byId(game.hostId);

  if (!host) {
    throw new Error("Expected the host to be online");
  }

  if (game.phase === "roundOver") {
    return await host.client.send({ type: "nextRound" });
  }

  if (game.phase === "lobby" || game.phase === "gameOver") {
    return await host.client.send({ type: "start" });
  }

  const moverId = game.choice?.chooserId ?? game.turnId ?? undefined;
  const mover = byId(moverId);
  const forId = mover ? undefined : moverId;

  return game.choice
    ? await (mover ?? host).client.send({
        forId,
        targetId: game.choice.options[0] ?? "",
        type: "choose",
      })
    : await (mover ?? host).client.send({ forId, type: "hit" });
};

const moveTableOn = async (net: Network) => {
  const sent = sendNextMove(net);
  net.flush();

  if (!(await sent)) {
    throw new Error("The room didn't accept the move");
  }
};

const deliverQueued = (
  player: TestPlayer,
  keep: (message: ServerMessage) => boolean = () => true
) => {
  for (const delivery of player.link?.toClient.splice(0) ?? []) {
    if (!("closeCode" in delivery) && keep(delivery)) {
      player.client.received(delivery);
    }
  }
};

const missABroadcastWithDraws = async () => {
  const net = network();
  const ana = net.join("Ana");
  net.join("Ben");
  await moveTableOn(net);
  const shown = ana.client.state.room;

  const missed = sendNextMove(net);
  net.flushToServer();
  deliverQueued(ana, (message) => message.type !== "state");
  net.flush();

  if (!(await missed) || net.stored.game.drawSeq === shown?.drawSeq) {
    throw new Error("Expected the missed move to draw");
  }

  const next = sendNextMove(net);
  net.flushToServer();
  deliverQueued(ana);

  return { ana, net, next, shown };
};

describe("Deal playback history through the room client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends each broadcast's Deal playback events in order", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    await moveTableOn(net);

    for (let move = 0; move < 12; move += 1) {
      const before = ben.client.state.room?.dealHistory ?? [];
      await moveTableOn(net);
      const after = ben.client.state.room?.dealHistory ?? [];
      const kept = before.filter((draw) => after.includes(draw));

      expect({
        ana: dealHistoryOf(ana),
        ben: dealHistoryOf(ben),
        keptInOrder: after.slice(0, kept.length),
      }).toStrictEqual({
        ana: serverDealHistory(net),
        ben: serverDealHistory(net),
        keptInOrder: kept,
      });
    }

    expect(net.syncs).toStrictEqual([]);
  });

  it("matches the room's draws across new rounds and a new game", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    const { game } = net.stored;
    const secondRoundOfSecondGame = () => game.games === 2 && game.round >= 2;
    await moveTableOn(net);

    for (let move = 0; move < 1000 && !secondRoundOfSecondGame(); move += 1) {
      if (
        game.games === 1 &&
        game.phase === "roundOver" &&
        game.dealSeq > DEAL_HISTORY_LIMIT
      ) {
        game.phase = "gameOver";
      }

      await moveTableOn(net);

      expect([dealHistoryOf(ana), dealHistoryOf(ben)]).toStrictEqual([
        serverDealHistory(net),
        serverDealHistory(net),
      ]);
    }

    expect({
      dealHistory: ben.client.state.room?.dealHistory.length,
      games: game.games,
      syncs: net.syncs,
    }).toStrictEqual({ dealHistory: DEAL_HISTORY_LIMIT, games: 2, syncs: [] });
  });

  it("catches up on draws made while reconnecting", async () => {
    const net = network();
    net.join("Ben");
    const ana = net.join("Ana");
    await moveTableOn(net);
    const seen = ana.client.state.room?.drawSeq ?? 0;

    net.drop(ana);
    net.flush();

    while (net.stored.game.drawSeq < seen + 3) {
      await moveTableOn(net);
    }

    expect(ana.client.state.room?.drawSeq).toBe(seen);

    net.connect(ana);
    net.flush();

    expect(dealHistoryOf(ana)).toStrictEqual(serverDealHistory(net));
    expect(net.syncs).toStrictEqual([]);
  });

  it("keeps showing the room it has while draws it missed are on the way", async () => {
    const { ana, shown } = await missABroadcastWithDraws();

    expect(ana.client.state.room).toBe(shown);
    expect(
      ana.link?.toServer.filter((frame) => frame.includes("sync"))
    ).toHaveLength(1);
  });

  it("shows the room with every kept draw once they arrive, then carries on", async () => {
    const { ana, net, next, shown } = await missABroadcastWithDraws();
    net.flush();
    await expect(next).resolves.toBeTruthy();

    expect({ ...dealHistoryOf(ana), syncs: net.syncs }).toStrictEqual({
      ...serverDealHistory(net),
      syncs: [ana.link?.id],
    });
    expect(ana.client.state.room?.drawSeq).toBeGreaterThan(shown?.drawSeq ?? 0);

    await moveTableOn(net);

    expect({ ...dealHistoryOf(ana), syncs: net.syncs }).toStrictEqual({
      ...serverDealHistory(net),
      syncs: [ana.link?.id],
    });
  });
});

describe("a room that goes back to an older save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces draws and log it has that the room no longer does", async () => {
    const net = network();
    const ana = net.join("Ana");
    const ben = net.join("Ben");
    await moveTableOn(net);
    const older = structuredClone(net.stored);
    await moveTableOn(net);
    await moveTableOn(net);
    ben.client.chat("lost");
    net.flush();

    Object.assign(net.stored.game, older.game);
    net.stored.broadcastSeqs = older.broadcastSeqs;
    ben.client.chat("after the restore");
    net.flush();

    expect({
      ...dealHistoryOf(ana),
      log: ana.client.state.room?.log,
      syncs: net.syncs,
    }).toStrictEqual({
      ...serverDealHistory(net),
      log: net.stored.game.log,
      syncs: [ana.link?.id, ben.link?.id],
    });
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

describe("watching a room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows live updates, keeps watching after a failed join, then takes a Seat", async () => {
    const net = network();
    const host = net.join("Ana");
    net.join("Ben");
    const guest = net.testPlayer();
    net.connect(guest);
    net.flush();

    guest.client.watch();
    net.flush();
    expect(guest.client.state).toMatchObject({
      canAct: false,
      needsName: false,
      playerId: null,
      room: { spectatorCount: 1 },
      watching: true,
    });
    const started = host.client.send({ type: "start" });
    net.flush();
    await started;
    host.client.chat("Good luck");
    net.flush();
    const live = guest.client.state.room;
    expect({
      phase: live?.phase,
      chat: chatText(live?.log.at(-1)),
    }).toStrictEqual({
      chat: "Good luck",
      phase: "playing",
    });

    guest.client.join("Ana");
    net.flush();
    expect(guest.client.state).toMatchObject({
      joinError: "Someone here is already called Ana.",
      room: { spectatorCount: 1 },
      watching: true,
    });
    guest.client.join("Cara");
    net.flush();
    expect(guest.client.state).toMatchObject({
      ready: true,
      room: { spectatorCount: 0 },
      watching: false,
    });
    expect({
      newestPlayer: guest.client.state.room?.players.at(-1),
      savedPlayer: guest.token !== null,
      watchPreference: guest.watching,
    }).toMatchObject({
      newestPlayer: { name: "Cara", status: "out" },
      savedPlayer: true,
      watchPreference: false,
    });
  });

  it("resumes watching after reconnect until the room is locked", async () => {
    const net = network();
    const host = net.join("Ana");
    const guest = net.testPlayer();
    net.connect(guest);
    guest.client.watch();
    net.flush();
    net.drop(guest);
    net.connect(guest);
    net.flush();
    expect(guest.client.state.watching).toBeTruthy();

    const locked = host.client.send({ locked: true, type: "configure" });
    net.flush();
    await expect(locked).resolves.toBeTruthy();
    expect(guest.client.state).toMatchObject({
      room: { settings: { locked: true } },
      watching: true,
    });

    net.drop(guest);
    net.connect(guest);
    net.flush();
    expect(guest.client.state).toMatchObject({
      needsName: true,
      preview: { locked: true },
      room: null,
      watchError: "This room is locked. Ask the host to unlock it.",
      watching: false,
    });
    expect(guest.watching).toBeFalsy();
  });

  it("returns to the join preview and stops resuming Watch after leaving Watch", () => {
    const net = network();
    const host = net.join("Ana");
    const guest = net.testPlayer();
    net.connect(guest);
    guest.client.watch();
    net.flush();
    guest.client.stopWatching();
    net.flush();

    expect(host.client.state.room?.spectatorCount).toBe(0);
    expect(guest.client.state).toMatchObject({
      needsName: true,
      preview: { spectatorCount: 0 },
      room: null,
      watching: false,
    });
    net.drop(guest);
    net.connect(guest);
    net.flush();
    expect(guest.client.state.watching).toBeFalsy();
  });

  it("gives up a seat to watch, forgets the token, and resumes watching after a reconnect", () => {
    const net = network();
    const host = net.join("Ana");
    const ben = net.join("Ben");

    ben.client.watchInstead();
    expect(ben.client.state.watchPending).toBeTruthy();
    net.flush();

    expect(ben.token).toBeNull();
    expect(ben.client.state).toMatchObject({
      canAct: false,
      needsName: false,
      playerId: null,
      room: { players: [{ name: "Ana" }], spectatorCount: 1 },
      watchPending: false,
      watching: true,
    });
    expect(host.client.state.room?.players).toHaveLength(1);

    net.drop(ben);
    net.connect(ben);
    net.flush();
    expect(ben.client.state.watching).toBeTruthy();
  });

  it("keeps the seat and explains why when watching isn't allowed", () => {
    const net = network();
    const ana = net.join("Ana");
    void ana.client.send({ type: "addBot" });
    net.flush();

    ana.client.watchInstead();
    net.flush();

    expect(ana.token).not.toBeNull();
    expect(ana.client.state.notice?.message).toContain("only person playing");
    expect(ana.client.state.playerId).not.toBeNull();
    expect(ana.client.state).toMatchObject({
      watchPending: false,
      watching: false,
    });
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
      phase: "playing",
      settings: { botSpeed: "fast" },
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
    watchPreference: { get: () => false, set: () => {} },
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
