import { isAvatar, pickAvatar, takenAvatars } from "./avatars";
import type { Random } from "./cards";
import type { GameCommand } from "./client-message";
import {
  addBot,
  addPlayer,
  backToLobby,
  chat,
  choose,
  configure,
  createGame,
  findPlayer,
  GameError,
  hasHumans,
  hit,
  kick,
  leave,
  nextRound,
  playFor,
  startGame,
  stay,
} from "./engine";
import type { GameState } from "./engine";
import { cleanName, ROOM_REMOVED_CLOSE_CODE, toRoomView } from "./protocol";
import type { ServerMessage } from "./protocol";
import {
  heartbeatDeadline,
  nextAlarmAt,
  runTimers,
  syncTimers,
} from "./timers";
import type { RoomTimers } from "./timers";

const HEARTBEAT_CLOSE_CODE = 1001;

export interface StoredRoom extends RoomTimers {
  code: string;
  game: GameState;
  /** Each player's last accepted move. Missing on rooms saved before moves were recorded. */
  lastRequests?: Map<string, string>;
  tokens: Map<string, string>;
}

/** A connection bound to a player. */
export interface Seat {
  playerId: string;
  seatedAt: number;
}

export interface OpenConnection {
  id: string;
  seat: Seat | null;
  lastPing: Date | null;
}

/** The room's view of its open connections, seated or not. */
export interface Seats {
  connections: () => Iterable<OpenConnection>;
  assign: (connectionId: string, seat: Seat | null) => void;
}

export interface RoomDeps {
  now: () => number;
  random: Random;
  newId: () => string;
}

/** Something the transport must do, in order: reply to the sender, broadcast the table, or close a connection. */
export type RoomEffect =
  | { type: "reply"; message: ServerMessage }
  | { type: "broadcast" }
  | { type: "close"; connectionId: string; code: number; reason: string };

/**
 * What the transport does after a call: save the room and set the alarm for
 * `alarmAt` (or delete the room when `expired`), then carry out `effects` in
 * order.
 */
export interface RoomOutcome {
  effects: RoomEffect[];
  expired: boolean;
  alarmAt: number;
}

/** How a transport carries out effects: reply to the sender, broadcast the table to every seat, or close a connection. */
export interface RoomTransport {
  reply: (message: ServerMessage) => void;
  broadcast: () => void;
  close: (connectionId: string, code: number, reason: string) => void;
}

/** Carries out an outcome's effects in order. Save the room before calling this. */
export const deliver = (outcome: RoomOutcome, transport: RoomTransport) => {
  for (const effect of outcome.effects) {
    switch (effect.type) {
      case "reply": {
        transport.reply(effect.message);
        break;
      }

      case "broadcast": {
        transport.broadcast();
        break;
      }

      case "close": {
        transport.close(effect.connectionId, effect.code, effect.reason);
        break;
      }

      default: {
        effect satisfies never;
      }
    }
  }
};

export const newStoredRoom = (code: string, now: number) => {
  const room: StoredRoom = {
    code,
    game: createGame(),
    hostLeftAt: null,
    lastActiveAt: now,
    stall: null,
    tokens: new Map(),
  };

  return room;
};

const reply = (message: ServerMessage) =>
  ({ message, type: "reply" }) satisfies RoomEffect;

const BROADCAST = { type: "broadcast" } satisfies RoomEffect;

const rejection = (message: string, requestId?: string) =>
  reply(
    requestId === undefined
      ? { message, type: "error" }
      : { message, requestId, type: "rejected" }
  );

const attempt = (run: () => RoomEffect[], requestId?: string) => {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof GameError)) {
      throw error;
    }

    return [rejection(error.message, requestId)];
  }
};

/**
 * The rules of a room around its game: who is seated, rejoining by token,
 * remembering each player's last move, eviction, presence and the clocks.
 * Every call updates the stored room in place and returns what the transport
 * must do.
 */
export const createRoom = (
  stored: StoredRoom,
  seats: Seats,
  deps: RoomDeps
) => {
  const { game } = stored;

  const seatedConnections = (playerId: string) =>
    [...seats.connections()].filter(
      (connection) => connection.seat?.playerId === playerId
    );

  const seatOf = (connectionId: string) =>
    [...seats.connections()].find(
      (connection) => connection.id === connectionId
    )?.seat ?? null;

  const seatedPlayer = (connectionId: string) => {
    const playerId = seatOf(connectionId)?.playerId;

    if (playerId === undefined || !findPlayer(game, playerId)) {
      throw new GameError("Join the room first.");
    }

    return playerId;
  };

  const seat = (connectionId: string, playerId: string) => {
    seats.assign(connectionId, { playerId, seatedAt: deps.now() });
  };

  const welcome = (playerId: string, token: string) =>
    reply({
      lastRequestId: stored.lastRequests?.get(playerId),
      playerId,
      token,
      type: "welcome",
    });

  const finish = (effects: RoomEffect[], expired = false) => {
    const now = deps.now();
    syncTimers(stored, now);

    const deadlines: number[] = [];

    for (const { seat: open, lastPing } of seats.connections()) {
      if (open) {
        deadlines.push(heartbeatDeadline(open.seatedAt, lastPing));
      }
    }

    const outcome: RoomOutcome = {
      alarmAt: nextAlarmAt(stored, deadlines),
      effects,
      expired,
    };

    return outcome;
  };

  const onlyBotsLeft = () => game.players.length > 0 && !hasHumans(game);

  const touch = () => {
    stored.lastActiveAt = deps.now();
  };

  const joinSeat = (
    connectionId: string,
    rawName: string,
    token: string | null,
    avatar: number | undefined
  ) => {
    const joined = seatOf(connectionId);
    const joinedToken = joined ? stored.tokens.get(joined.playerId) : undefined;

    if (joined && joinedToken !== undefined) {
      return welcome(joined.playerId, joinedToken);
    }

    const known = [...stored.tokens].find(([, saved]) => saved === token);
    const knownPlayer = known ? findPlayer(game, known[0]) : undefined;

    if (knownPlayer && token !== null) {
      knownPlayer.connected = true;
      seat(connectionId, knownPlayer.id);

      return welcome(knownPlayer.id, token);
    }

    const name = cleanName(rawName);

    if (name === "") {
      throw new GameError("Enter a name to join.");
    }

    const playerId = deps.newId();
    const newToken = deps.newId();
    addPlayer(
      game,
      playerId,
      name,
      isAvatar(avatar)
        ? avatar
        : pickAvatar(deps.random(), takenAvatars(game.players))
    );
    stored.tokens.set(playerId, newToken);
    seat(connectionId, playerId);

    return welcome(playerId, newToken);
  };

  const evict = (playerId: string, reason: "kicked" | "left") => {
    stored.tokens.delete(playerId);
    stored.lastRequests?.delete(playerId);

    return seatedConnections(playerId).map((connection) => {
      seats.assign(connection.id, null);

      return {
        code: ROOM_REMOVED_CLOSE_CODE,
        connectionId: connection.id,
        reason,
        type: "close",
      } satisfies RoomEffect;
    });
  };

  const act = (playerId: string, command: GameCommand) => {
    const none: RoomEffect[] = [];
    const { random } = deps;

    switch (command.type) {
      case "start": {
        startGame(game, playerId, random);

        return none;
      }

      case "hit":
      case "stay":
      case "choose": {
        if (command.forId !== undefined && command.forId !== playerId) {
          playFor(game, playerId, command.forId, command, random);
          // WARNING: restart the offline clock, or the auto-move can beat the host when the game waits on the same player again.
          stored.stall = null;

          return none;
        }

        if (command.type === "hit") {
          hit(game, playerId, random);
        } else if (command.type === "stay") {
          stay(game, playerId, random);
        } else {
          choose(game, playerId, command.targetId, random);
        }

        return none;
      }

      case "nextRound": {
        nextRound(game, playerId, random);

        return none;
      }

      case "lobby": {
        backToLobby(game, playerId);

        return none;
      }

      case "addBot": {
        addBot(game, playerId, deps.newId(), random);

        return none;
      }

      case "configure": {
        const { botSpeed, locked, targetScore } = command;
        configure(game, playerId, {
          ...(botSpeed !== undefined && { botSpeed }),
          ...(locked !== undefined && { locked }),
          ...(targetScore !== undefined && { targetScore }),
        });

        return none;
      }

      case "kick": {
        kick(game, playerId, command.playerId, random);

        return evict(command.playerId, "kicked");
      }

      case "leave": {
        leave(game, playerId, random);

        return evict(playerId, "left");
      }

      default: {
        command satisfies never;

        return none;
      }
    }
  };

  const dropSilentSeats = (now: number) => {
    const silentIds = new Set<string>();
    const closes: RoomEffect[] = [];

    for (const { id, seat: open, lastPing } of seats.connections()) {
      if (!open || now < heartbeatDeadline(open.seatedAt, lastPing)) {
        continue;
      }

      silentIds.add(open.playerId);
      seats.assign(id, null);
      closes.push({
        code: HEARTBEAT_CLOSE_CODE,
        connectionId: id,
        reason: "Heartbeat timed out",
        type: "close",
      });
    }

    let changed = false;

    for (const id of silentIds) {
      const player = findPlayer(game, id);

      if (player?.connected === true && seatedConnections(id).length === 0) {
        player.connected = false;
        changed = true;
      }
    }

    return { changed, closes };
  };

  return {
    alarm: () => {
      const now = deps.now();
      const dropped = dropSilentSeats(now);

      if (dropped.changed) {
        syncTimers(stored, now);
      }

      const droppedIds = new Set(
        dropped.closes.flatMap((effect) =>
          effect.type === "close" ? [effect.connectionId] : []
        )
      );

      const hasConnections = [...seats.connections()].some(
        (connection) => !droppedIds.has(connection.id)
      );

      const { changed, expired } = runTimers(
        stored,
        now,
        deps.random,
        hasConnections
      );

      const effects: RoomEffect[] =
        changed || dropped.changed
          ? [...dropped.closes, BROADCAST]
          : dropped.closes;

      return finish(effects, expired);
    },

    chat: (connectionId: string, text: string) => {
      touch();

      return finish(
        attempt(() => {
          chat(game, seatedPlayer(connectionId), text);

          return [BROADCAST];
        })
      );
    },

    command: (connectionId: string, command: GameCommand) => {
      touch();
      const { requestId } = command;

      return finish(
        attempt(() => {
          const playerId = seatedPlayer(connectionId);
          const closes = act(playerId, command);

          if (requestId === undefined) {
            return [BROADCAST, ...closes];
          }

          if (command.type !== "leave") {
            stored.lastRequests ??= new Map();
            stored.lastRequests.set(playerId, requestId);
          }

          return [BROADCAST, reply({ requestId, type: "accepted" }), ...closes];
        }, requestId),
        onlyBotsLeft()
      );
    },

    disconnect: (departed: Seat | null) => {
      if (!departed) {
        return finish([]);
      }

      touch();
      const player = findPlayer(game, departed.playerId);

      if (!player || seatedConnections(departed.playerId).length > 0) {
        return finish([]);
      }

      player.connected = false;

      return finish([BROADCAST]);
    },

    join: (
      connectionId: string,
      name: string,
      token: string | null,
      avatar?: number
    ) => {
      touch();

      return finish(
        attempt(() => [joinSeat(connectionId, name, token, avatar), BROADCAST])
      );
    },

    reconcile: () => {
      const seated = new Set(
        Array.from(
          seats.connections(),
          (connection) => connection.seat?.playerId
        )
      );

      let changed = false;

      for (const player of game.players) {
        const connected = player.bot === true || seated.has(player.id);

        if (connected !== player.connected) {
          player.connected = connected;
          changed = true;
        }
      }

      return finish(changed ? [BROADCAST] : []);
    },

    state: () =>
      ({
        room: toRoomView(stored.code, game),
        type: "state",
      }) satisfies ServerMessage,
  };
};
