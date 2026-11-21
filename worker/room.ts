import { DurableObject } from "cloudflare:workers";
import * as v from "valibot";

import { parseClientMessage } from "../src/game/client-message";
import type { GameCommand } from "../src/game/client-message";
import {
  addPlayer,
  backToLobby,
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
  toRoomView,
} from "../src/game/protocol";
import type { ServerMessage } from "../src/game/protocol";
import { nextAlarmAt, runTimers, syncTimers } from "../src/game/timers";
import type { RoomTimers } from "../src/game/timers";

const UINT32_RANGE = 2 ** 32;

interface StoredRoom extends RoomTimers {
  code: string;
  game: GameState;
  lastRequests?: Map<string, string>;
  tokens: Map<string, string>;
}

type Attachment = v.InferOutput<typeof AttachmentSchema>;

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

const AttachmentSchema = v.object({ playerId: v.string() });

const attachmentOf = (ws: WebSocket) => {
  const result = v.safeParse(AttachmentSchema, ws.deserializeAttachment());

  return result.success ? result.output : null;
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

const joinRoom = (
  ws: WebSocket,
  room: StoredRoom,
  rawName: string,
  token: string | null
) => {
  const joinedId = attachmentOf(ws)?.playerId;

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
    ws.serializeAttachment({ playerId: knownPlayer.id } satisfies Attachment);
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
  ws.serializeAttachment({ playerId } satisfies Attachment);
  sendWelcome(ws, room, playerId, newToken);
};

export class GameRoom extends DurableObject<Env> {
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

  override fetch(request: Request) {
    if (!this.room) {
      return new Response("Room not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    send(server, {
      room: toRoomView(this.room.code, this.room.game),
      type: "state",
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const { room } = this;

    if (!room || data instanceof ArrayBuffer) {
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

      await this.handleCommand(ws, room, message);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }

      reject(
        ws,
        error.message,
        message.type === "join" ? undefined : message.requestId
      );
    }
  }

  override async webSocketClose(ws: WebSocket) {
    await this.disconnect(ws);
  }

  override async webSocketError(ws: WebSocket) {
    await this.disconnect(ws);
  }

  override async alarm() {
    const { room } = this;

    if (!room) {
      return;
    }

    const { changed, expired } = runTimers(
      room,
      Date.now(),
      random,
      this.ctx.getWebSockets().length > 0
    );

    if (expired) {
      this.room = null;
      await this.ctx.storage.deleteAll();

      return;
    }

    await (changed ? this.commit() : this.save());
  }

  private async handleCommand(
    ws: WebSocket,
    room: StoredRoom,
    message: GameCommand
  ) {
    const playerId = attachmentOf(ws)?.playerId;
    const { requestId } = message;

    if (playerId === undefined || !findPlayer(room.game, playerId)) {
      throw new GameError("Join the room first.");
    }

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
      socket.serializeAttachment(null);
    }

    return () => {
      for (const socket of sockets) {
        send(socket, { reason, type: "removed" });
        socket.close(1000, reason);
      }
    };
  }

  private socketsFor(playerId: string) {
    return this.ctx
      .getWebSockets()
      .filter((socket) => attachmentOf(socket)?.playerId === playerId);
  }

  private async disconnect(ws: WebSocket) {
    const { room } = this;
    const playerId = attachmentOf(ws)?.playerId;

    if (!room || playerId === undefined) {
      return;
    }

    ws.serializeAttachment(null);
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
    const view = toRoomView(room.code, room.game);

    for (const socket of this.ctx.getWebSockets()) {
      send(socket, { room: view, type: "state" });
    }

    await saved;
  }

  private async save() {
    const { room } = this;

    if (!room) {
      return;
    }

    syncTimers(room, Date.now());
    await Promise.all([
      this.ctx.storage.put("room", room),
      this.ctx.storage.setAlarm(nextAlarmAt(room)),
    ]);
  }
}
