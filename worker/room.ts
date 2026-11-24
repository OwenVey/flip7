import { Server } from "partyserver";
import type { Connection, WSMessage } from "partyserver";

import { parseClientMessage } from "../src/game/client-message";
import {
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  ROOM_MISSING_CLOSE_CODE,
} from "../src/game/protocol";
import type { ServerMessage } from "../src/game/protocol";
import { createRoom, deliver, newStoredRoom } from "../src/game/room";
import type {
  Admission,
  RoomOutcome,
  Seats,
  StoredRoom,
} from "../src/game/room";

const UINT32_RANGE = 2 ** 32;

const random = () => {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));

  return value / UINT32_RANGE;
};

const deps = {
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
  random,
};

const sendFrame = (ws: WebSocket, frame: string) => {
  try {
    ws.send(frame);
  } catch {
    ws.close(1011, "Send failed");
  }
};

const send = (ws: WebSocket, message: ServerMessage) => {
  sendFrame(ws, JSON.stringify(message));
};

// WARNING: messages share arrays with the live room, so serialize them now to match the broadcast position just saved.
const framesOf = (outcome: RoomOutcome) => {
  const frames = new Map<ServerMessage, string>();

  for (const effect of outcome.effects) {
    if (effect.type === "broadcast" && !frames.has(effect.preview)) {
      frames.set(effect.preview, JSON.stringify(effect.preview));
    }

    if (effect.type !== "close" && !frames.has(effect.message)) {
      frames.set(effect.message, JSON.stringify(effect.message));
    }
  }

  return (message: ServerMessage) =>
    frames.get(message) ?? JSON.stringify(message);
};

export class GameRoom extends Server<Env> {
  static override options = { hibernate: true };

  private stored: StoredRoom | null = null;

  private readonly seats: Seats = {
    assign: (connectionId, admission) => {
      this.getConnection<Admission>(connectionId)?.setState(admission);
    },
    connections: () =>
      Array.from(this.getConnections<Admission>(), (connection) => ({
        id: connection.id,
        lastPing: this.ctx.getWebSocketAutoResponseTimestamp(connection),
        admission: connection.state ?? null,
      })),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG)
    );
    void ctx.blockConcurrencyWhile(async () => {
      this.stored = (await ctx.storage.get<StoredRoom>("room")) ?? null;
    });
  }

  async create(code: string) {
    if (this.stored) {
      return false;
    }

    this.stored = newStoredRoom(code, Date.now());
    await this.carryOut(this.room()?.reconcile());

    return true;
  }

  exists() {
    return this.stored !== null;
  }

  override async fetch(request: Request) {
    if (!this.stored) {
      return new Response("Room not found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    return await super.fetch(request);
  }

  override async onStart() {
    await this.carryOut(this.room()?.reconcile());
  }

  override onConnect(connection: Connection) {
    const room = this.room();

    if (room) {
      send(connection, room.viewFor(connection.id));
    }
  }

  override async onMessage(ws: Connection<Admission>, data: WSMessage) {
    const room = this.room();

    if (!room || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      return;
    }

    const message = parseClientMessage(data);

    if (!message) {
      send(ws, { message: "That message wasn't understood.", type: "error" });

      return;
    }

    if (message.type === "join") {
      await this.carryOut(
        room.join(ws.id, message.name, message.token, message.avatar),
        ws
      );
    } else if (message.type === "chat") {
      await this.carryOut(room.chat(ws.id, message.text), ws);
    } else if (message.type === "sync") {
      send(ws, room.viewFor(ws.id));
    } else if (message.type === "watch") {
      await this.carryOut(room.watch(ws.id), ws);
    } else if (message.type === "watchInstead") {
      await this.carryOut(room.watchInstead(ws.id), ws);
    } else if (message.type === "stopWatching") {
      await this.carryOut(room.stopWatching(ws.id), ws);
    } else {
      await this.carryOut(room.command(ws.id, message), ws);
    }
  }

  override async onClose(ws: Connection<Admission>) {
    const admission = ws.state ?? null;
    ws.setState(null);
    await this.carryOut(this.room()?.disconnect(admission));
  }

  override async onError(ws: Connection<Admission>) {
    const admission = ws.state ?? null;
    ws.setState(null);
    await this.carryOut(this.room()?.disconnect(admission));
  }

  override async onAlarm() {
    await this.carryOut(this.room()?.alarm());
  }

  private room() {
    return this.stored ? createRoom(this.stored, this.seats, deps) : null;
  }

  private async carryOut(outcome: RoomOutcome | undefined, sender?: WebSocket) {
    const { stored } = this;

    if (!outcome || !stored) {
      return;
    }

    const frameOf = framesOf(outcome);

    if (outcome.expired) {
      this.stored = null;
      await this.ctx.storage.deleteAll();
    } else {
      await Promise.all([
        this.ctx.storage.put("room", stored),
        this.ctx.storage.setAlarm(outcome.alarmAt),
      ]);
    }

    deliver(outcome, {
      broadcast: (message, preview) => {
        if (outcome.expired) {
          return;
        }

        for (const connection of this.getConnections<Admission>()) {
          sendFrame(connection, frameOf(connection.state ? message : preview));
        }
      },
      close: (connectionId, code, reason) => {
        this.getConnection(connectionId)?.close(code, reason);
      },
      reply: (message) => {
        if (sender) {
          sendFrame(sender, frameOf(message));
        }
      },
    });

    if (outcome.expired) {
      for (const connection of this.getConnections()) {
        if (connection.readyState === WebSocket.OPEN) {
          connection.close(ROOM_MISSING_CLOSE_CODE, "Room closed");
        }
      }
    }
  }
}
