import { DurableObject } from "cloudflare:workers";
import * as v from "valibot";

import { parseClientMessage } from "../src/game/client-message";
import type { ClientMessage } from "../src/game/client-message";
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
    send(ws, { playerId: joinedId, token: joinedToken, type: "welcome" });

    return;
  }

  const known = [...room.tokens].find(([, saved]) => saved === token);

  const knownPlayer = known ? findPlayer(room.game, known[0]) : undefined;

  if (knownPlayer && token !== null) {
    knownPlayer.connected = true;
    ws.serializeAttachment({ playerId: knownPlayer.id } satisfies Attachment);
    send(ws, { playerId: knownPlayer.id, token, type: "welcome" });

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
  send(ws, { playerId, token: newToken, type: "welcome" });
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
      } else {
        const playerId = attachmentOf(ws)?.playerId;

        if (playerId === undefined || !findPlayer(room.game, playerId)) {
          send(ws, { message: "Join the room first.", type: "error" });

          return;
        }

        this.act(room, playerId, message);
      }
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }

      send(ws, { message: error.message, type: "error" });

      return;
    }

    await this.commit();
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

  private act(room: StoredRoom, playerId: string, message: ClientMessage) {
    const { game } = room;

    switch (message.type) {
      case "join": {
        return;
      }

      case "start": {
        startGame(game, playerId, random);

        return;
      }

      case "hit": {
        hit(game, playerId, random);

        return;
      }

      case "stay": {
        stay(game, playerId, random);

        return;
      }

      case "choose": {
        choose(game, playerId, message.targetId, random);

        return;
      }

      case "nextRound": {
        nextRound(game, playerId, random);

        return;
      }

      case "lobby": {
        backToLobby(game, playerId);

        return;
      }

      case "kick": {
        if (game.hostId !== playerId) {
          throw new GameError("Only the host can remove players.");
        }

        if (message.playerId === playerId) {
          throw new GameError("Use Leave to leave the room.");
        }

        this.evict(room, message.playerId, "kicked");

        return;
      }

      case "leave": {
        this.evict(room, playerId, "left");

        return;
      }

      default: {
        message satisfies never;
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
    say(
      room.game,
      reason === "kicked"
        ? `${player.name} was removed by the host.`
        : `${player.name} left.`
    );

    for (const socket of this.socketsFor(playerId)) {
      send(socket, { reason, type: "removed" });
      socket.serializeAttachment(null);
      socket.close(1000, reason);
    }
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

    const view = toRoomView(room.code, room.game);

    for (const socket of this.ctx.getWebSockets()) {
      send(socket, { room: view, type: "state" });
    }

    await this.save();
  }

  private async save() {
    const { room } = this;

    if (!room) {
      return;
    }

    syncTimers(room, Date.now());
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(nextAlarmAt(room));
  }
}
