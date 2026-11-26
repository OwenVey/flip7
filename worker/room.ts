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
  RoomPassing,
  RoomTransport,
  Seats,
  StoredRoom,
} from "../src/game/room";
import { withServerConnectionId } from "./connection-id";
import { createRoomStore } from "./room-store";

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
const framesOf = (outcome: Pick<RoomOutcome, "effects">) => {
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

  private readonly store = createRoomStore(this.ctx.storage);

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
      this.stored = await this.store.load();

      if (!this.stored) {
        this.closeRoomConnections();
      }
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

    return await super.fetch(
      withServerConnectionId(request, crypto.randomUUID())
    );
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

    await this.carryOut(room.receive(ws.id, message), ws.id);
  }

  override async onClose(ws: Connection<Admission>) {
    await this.disconnect(ws);
  }

  override async onError(ws: Connection<Admission>) {
    await this.disconnect(ws);
  }

  override async onAlarm() {
    await this.store.refreshAlarm();
    await this.carryOut(this.room()?.alarm());
  }

  private room() {
    return this.stored ? createRoom(this.stored, this.seats, deps) : null;
  }

  private async disconnect(ws: Connection<Admission>) {
    const admission = ws.state ?? null;
    ws.setState(null);
    await this.carryOut(this.room()?.disconnect(admission));
  }

  private async carryOut(
    result: RoomOutcome | RoomPassing | undefined,
    sender?: string
  ) {
    const { stored } = this;

    if (!result || !stored) {
      return;
    }

    const frameOf = framesOf(result);

    if (result.save && result.expired) {
      this.stored = null;
      await this.store.clear();
    } else if (result.save) {
      await this.store.save(stored, result.alarmAt);
    }

    deliver(result, {
      seats: this.seats,
      sender,
      transport: this.transport(frameOf),
    });

    if (result.save && result.expired) {
      this.closeRoomConnections();
    }
  }

  private closeRoomConnections() {
    for (const connection of this.getConnections()) {
      if (connection.readyState === WebSocket.OPEN) {
        connection.close(ROOM_MISSING_CLOSE_CODE, "Room closed");
      }
    }
  }

  private transport(frameOf: (message: ServerMessage) => string) {
    return {
      close: (connectionId, code, reason) => {
        this.getConnection(connectionId)?.close(code, reason);
      },
      send: (connectionId, message) => {
        const connection = this.getConnection(connectionId);

        if (connection) {
          sendFrame(connection, frameOf(message));
        }
      },
    } satisfies RoomTransport;
  }
}
