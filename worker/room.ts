import { Server } from "partyserver";
import type { Connection, WSMessage } from "partyserver";

import { parseClientMessage } from "../src/game/client-message";
import { HEARTBEAT_PING, HEARTBEAT_PONG } from "../src/game/protocol";
import type { ServerMessage } from "../src/game/protocol";
import { createRoom, deliver, newStoredRoom } from "../src/game/room";
import type { RoomOutcome, Seat, Seats, StoredRoom } from "../src/game/room";

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

// WARNING: messages share arrays with the live room, so serialize them before awaiting storage lets another event change it.
const framesOf = (outcome: RoomOutcome) => {
  const frames = new Map<ServerMessage, string>();

  for (const effect of outcome.effects) {
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
    assign: (connectionId, seat) => {
      this.getConnection<Seat>(connectionId)?.setState(seat);
    },
    connections: () =>
      Array.from(this.getConnections<Seat>(), (connection) => ({
        id: connection.id,
        lastPing: this.ctx.getWebSocketAutoResponseTimestamp(connection),
        seat: connection.state ?? null,
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
      send(connection, room.snapshot());
    }
  }

  override async onMessage(ws: Connection<Seat>, data: WSMessage) {
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
      await this.carryOut(room.sync(), ws);
    } else {
      await this.carryOut(room.command(ws.id, message), ws);
    }
  }

  override async onClose(ws: Connection<Seat>) {
    await this.carryOut(this.room()?.disconnect(ws.state ?? null));
  }

  override async onError(ws: Connection<Seat>) {
    await this.carryOut(this.room()?.disconnect(ws.state ?? null));
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
      broadcast: (message) => {
        this.broadcast(frameOf(message));
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
  }
}
