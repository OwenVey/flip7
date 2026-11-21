import { Server } from "partyserver";
import type { Connection, WSMessage } from "partyserver";

import { parseClientMessage } from "../src/game/client-message";
import type { GameCommand } from "../src/game/client-message";
import {
  addPlayer,
  backToLobby,
  chat,
  choose,
  createGame,
  findPlayer,
  GameError,
  hit,
  nextRound,
  removePlayer,
  say,
  startGame,
  stay,
} from "../src/game/engine";
import type { GameState } from "../src/game/engine";
import {
  cleanName,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  ROOM_REMOVED_CLOSE_CODE,
  toRoomView,
} from "../src/game/protocol";
import type { ServerMessage } from "../src/game/protocol";
import {
  heartbeatDeadline,
  nextAlarmAt,
  runTimers,
  syncTimers,
} from "../src/game/timers";
import type { RoomTimers } from "../src/game/timers";

const UINT32_RANGE = 2 ** 32;

interface StoredRoom extends RoomTimers {
  code: string;
  game: GameState;
  lastRequests?: Map<string, string>;
  tokens: Map<string, string>;
}

interface Seat {
  playerId: string;
  seatedAt: number;
}

const random = () => {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));

  return value / UINT32_RANGE;
};

const send = (ws: WebSocket, message: ServerMessage) => {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    ws.close(1011, "Send failed");
  }
};

const roomState = (room: StoredRoom) =>
  ({
    room: toRoomView(room.code, room.game),
    type: "state",
  }) satisfies ServerMessage;

const seatSocket = (socket: Connection<Seat>, playerId: string) => {
  socket.setState({ playerId, seatedAt: Date.now() });
};

const sendWelcome = (
  ws: WebSocket,
  room: StoredRoom,
  playerId: string,
  token: string
) => {
  const lastRequestId = room.lastRequests?.get(playerId);
  send(ws, { lastRequestId, playerId, token, type: "welcome" });
};

const reject = (ws: WebSocket, message: string, requestId?: string) => {
  send(
    ws,
    requestId === undefined
      ? { message, type: "error" }
      : { message, requestId, type: "rejected" }
  );
};

const seatedPlayer = (ws: Connection<Seat>, room: StoredRoom) => {
  const playerId = ws.state?.playerId;

  if (playerId === undefined || !findPlayer(room.game, playerId)) {
    throw new GameError("Join the room first.");
  }

  return playerId;
};

const joinRoom = (
  ws: Connection<Seat>,
  room: StoredRoom,
  rawName: string,
  token: string | null
) => {
  const joinedId = ws.state?.playerId;

  const joinedToken =
    joinedId === undefined ? undefined : room.tokens.get(joinedId);

  if (joinedId !== undefined && joinedToken !== undefined) {
    sendWelcome(ws, room, joinedId, joinedToken);

    return;
  }

  const known = [...room.tokens].find(([, saved]) => saved === token);

  const knownPlayer = known ? findPlayer(room.game, known[0]) : undefined;

  if (knownPlayer && token !== null) {
    knownPlayer.connected = true;
    seatSocket(ws, knownPlayer.id);
    sendWelcome(ws, room, knownPlayer.id, token);

    return;
  }

  const name = cleanName(rawName);

  if (name === "") {
    throw new GameError("Enter a name to join.");
  }

  const playerId = crypto.randomUUID();
  const newToken = crypto.randomUUID();
  addPlayer(room.game, playerId, name);
  room.tokens.set(playerId, newToken);
  seatSocket(ws, playerId);
  sendWelcome(ws, room, playerId, newToken);
};

export class GameRoom extends Server<Env> {
  static override options = { hibernate: true };

  private room: StoredRoom | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG)
    );
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<StoredRoom>("room")) ?? null;
    });
  }

  async create(code: string) {
    if (this.room) {
      return false;
    }

    this.room = {
      code,
      game: createGame(),
      hostLeftAt: null,
      lastActiveAt: Date.now(),
      stall: null,
      tokens: new Map(),
    };
    await this.save();

    return true;
  }

  exists() {
    return this.room !== null;
  }

  override async fetch(request: Request) {
    if (!this.room) {
      return new Response("Room not found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    return await super.fetch(request);
  }

  override async onStart() {
    const { room } = this;

    if (!room) {
      return;
    }

    const seated = new Set(
      Array.from(
        this.getConnections<Seat>(),
        (socket) => socket.state?.playerId
      )
    );

    let changed = false;

    for (const player of room.game.players) {
      const connected = seated.has(player.id);

      if (connected !== player.connected) {
        player.connected = connected;
        changed = true;
      }
    }

    if (changed) {
      await this.commit();
    }
  }

  override onConnect(connection: Connection) {
    if (this.room) {
      send(connection, roomState(this.room));
    }
  }

  override async onMessage(ws: Connection<Seat>, data: WSMessage) {
    const { room } = this;

    if (!room || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      return;
    }

    const message = parseClientMessage(data);

    if (!message) {
      send(ws, { message: "That message wasn't understood.", type: "error" });

      return;
    }

    room.lastActiveAt = Date.now();

    try {
      if (message.type === "join") {
        joinRoom(ws, room, message.name, message.token);
        await this.commit();

        return;
      }

      if (message.type === "chat") {
        chat(room.game, seatedPlayer(ws, room), message.text);
        await this.commit();

        return;
      }

      await this.handleCommand(ws, room, message);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }

      reject(
        ws,
        error.message,
        message.type === "join" || message.type === "chat"
          ? undefined
          : message.requestId
      );
    }
  }

  override async onClose(ws: Connection<Seat>) {
    await this.disconnect(ws);
  }

  override async onError(ws: Connection<Seat>) {
    await this.disconnect(ws);
  }

  override async onAlarm() {
    const { room } = this;

    if (!room) {
      return;
    }

    const now = Date.now();
    const presenceChanged = this.dropSilentSockets(room, now);

    if (presenceChanged) {
      syncTimers(room, now);
    }

    const { changed, expired } = runTimers(
      room,
      now,
      random,
      this.getConnections()[Symbol.iterator]().next().done === false
    );

    if (expired) {
      await this.ctx.storage.deleteAll();
      this.room = null;

      return;
    }

    await (changed || presenceChanged ? this.commit() : this.save());
  }

  private async handleCommand(
    ws: Connection<Seat>,
    room: StoredRoom,
    message: GameCommand
  ) {
    const playerId = seatedPlayer(ws, room);
    const { requestId } = message;

    const finishEviction = this.act(room, playerId, message);

    if (requestId !== undefined && message.type !== "leave") {
      room.lastRequests ??= new Map();
      room.lastRequests.set(playerId, requestId);
    }

    await this.commit();

    if (requestId !== undefined) {
      send(ws, { requestId, type: "accepted" });
    }

    finishEviction?.();
  }

  private act(room: StoredRoom, playerId: string, message: GameCommand) {
    const { game } = room;

    switch (message.type) {
      case "start": {
        startGame(game, playerId, random);

        return null;
      }

      case "hit": {
        hit(game, playerId, random);

        return null;
      }

      case "stay": {
        stay(game, playerId, random);

        return null;
      }

      case "choose": {
        choose(game, playerId, message.targetId, random);

        return null;
      }

      case "nextRound": {
        nextRound(game, playerId, random);

        return null;
      }

      case "lobby": {
        backToLobby(game, playerId);

        return null;
      }

      case "kick": {
        if (game.hostId !== playerId) {
          throw new GameError("Only the host can remove players.");
        }

        if (message.playerId === playerId) {
          throw new GameError("Use Leave to leave the room.");
        }

        return this.evict(room, message.playerId, "kicked");
      }

      case "leave": {
        return this.evict(room, playerId, "left");
      }

      default: {
        message satisfies never;

        return null;
      }
    }
  }

  private evict(room: StoredRoom, playerId: string, reason: "kicked" | "left") {
    const player = findPlayer(room.game, playerId);

    if (!player) {
      throw new GameError("That player already left.");
    }

    removePlayer(room.game, playerId, random);
    room.tokens.delete(playerId);
    room.lastRequests?.delete(playerId);
    say(
      room.game,
      reason === "kicked"
        ? `${player.name} was removed by the host.`
        : `${player.name} left.`
    );

    const sockets = this.socketsFor(playerId);

    for (const socket of sockets) {
      socket.setState(null);
    }

    return () => {
      for (const socket of sockets) {
        socket.close(ROOM_REMOVED_CLOSE_CODE, reason);
      }
    };
  }

  private heartbeatDeadline(socket: Connection<Seat>, seat: Seat) {
    const pingedAt = this.ctx.getWebSocketAutoResponseTimestamp(socket);

    return heartbeatDeadline(seat.seatedAt, pingedAt);
  }

  // WARNING: a dropped network never sends a close, so silent sockets look open until TCP gives up.
  private dropSilentSockets(room: StoredRoom, now: number) {
    const silentIds = new Set<string>();

    for (const socket of this.getConnections<Seat>()) {
      const seat = socket.state;

      if (!seat || now < this.heartbeatDeadline(socket, seat)) {
        continue;
      }

      silentIds.add(seat.playerId);
      socket.setState(null);

      socket.close(1001, "Heartbeat timed out");
    }

    let changed = false;

    for (const id of silentIds) {
      const player = findPlayer(room.game, id);

      if (player?.connected === true && this.socketsFor(id).length === 0) {
        player.connected = false;
        changed = true;
      }
    }

    return changed;
  }

  private socketsFor(playerId: string) {
    return [...this.getConnections<Seat>()].filter(
      (socket) => socket.state?.playerId === playerId
    );
  }

  private async disconnect(ws: Connection<Seat>) {
    const { room } = this;
    const playerId = ws.state?.playerId;

    if (!room || playerId === undefined) {
      return;
    }

    ws.setState(null);
    room.lastActiveAt = Date.now();
    const player = findPlayer(room.game, playerId);

    if (!player || this.socketsFor(playerId).length > 0) {
      await this.save();

      return;
    }

    player.connected = false;
    await this.commit();
  }

  private async commit() {
    const { room } = this;

    if (!room) {
      return;
    }

    const saved = this.save();
    this.broadcast(JSON.stringify(roomState(room)));

    await saved;
  }

  private async save() {
    const { room } = this;

    if (!room) {
      return;
    }

    const now = Date.now();
    syncTimers(room, now);

    const deadlines: number[] = [];

    for (const socket of this.getConnections<Seat>()) {
      if (socket.state) {
        deadlines.push(this.heartbeatDeadline(socket, socket.state));
      }
    }

    await Promise.all([
      this.ctx.storage.put("room", room),
      this.ctx.storage.setAlarm(nextAlarmAt(room, deadlines)),
    ]);
  }
}
