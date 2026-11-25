import { isAvatar, pickAvatar, takenAvatars } from "./avatars";
import type { Random } from "./cards";
import { isRoomCommand } from "./client-message";
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
  leaveToWatch,
  nextRound,
  playFor,
  startGame,
  stay,
} from "./engine";
import type { GameState } from "./engine";
import { MAX_SPECTATORS, rejectWatchInstead } from "./moves";
import {
  cleanName,
  listSeqsOf,
  ROOM_REMOVED_CLOSE_CODE,
  toRoomPreview,
  toStateMessage,
} from "./protocol";
import type { ListSeqs, PreviewMessage, ServerMessage } from "./protocol";
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
  /** Each player's last accepted move. */
  lastRequests: Partial<Record<string, string>>;
  /** Each list's sequence number at the last broadcast, so the next one sends only newer entries. */
  broadcastSeqs: ListSeqs;
  /** Each player's rejoin token, by player ID. */
  tokens: Partial<Record<string, string>>;
}

/** A connection bound to a player. */
export interface Seat {
  playerId: string;
  seatedAt: number;
}

/** Admission follows the connection across Worker hibernation. */
export type Admission = Seat | { watchedAt: number };

const withoutPlayer = (byPlayer: Partial<Record<string, string>>, id: string) =>
  Object.fromEntries(
    Object.entries(byPlayer).filter(([playerId]) => playerId !== id)
  );

const playerSeat = (admission: Admission | null) =>
  admission && "playerId" in admission ? admission : null;

const isSpectator = (admission: Admission | null) =>
  admission !== null && "watchedAt" in admission;

const admittedAt = (admission: Admission) =>
  "seatedAt" in admission ? admission.seatedAt : admission.watchedAt;

export interface OpenConnection {
  id: string;
  admission: Admission | null;
  lastPing: Date | null;
}

/** The room's view of its open connections, seated or not. */
export interface Seats {
  connections: () => Iterable<OpenConnection>;
  assign: (connectionId: string, admission: Admission | null) => void;
}

export interface RoomDeps {
  now: () => number;
  random: Random;
  newId: () => string;
}

/**
 * Something the transport must do, in order: reply to the sender, broadcast
 * the live table to admitted connections and the join preview to visitors,
 * relay a passing message to every other admitted connection, or close a
 * connection. Live broadcasts carry new list entries only.
 */
export type RoomEffect =
  | { type: "reply"; message: ServerMessage }
  | { type: "broadcast"; message: ServerMessage; preview: PreviewMessage }
  | { type: "relay"; message: ServerMessage; except: string }
  | { type: "close"; connectionId: string; code: number; reason: string };

type PlannedEffect =
  | Exclude<RoomEffect, { type: "broadcast" }>
  | { type: "broadcast" };

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

/** How a transport delivers replies, audience-specific broadcasts, and closes. */
export interface RoomTransport {
  reply: (message: ServerMessage) => void;
  broadcast: (message: ServerMessage, preview: PreviewMessage) => void;
  relay: (message: ServerMessage, except: string) => void;
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
        transport.broadcast(effect.message, effect.preview);
        break;
      }

      case "relay": {
        transport.relay(effect.message, effect.except);
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
  const game = createGame();

  const room: StoredRoom = {
    botTurn: null,
    broadcastSeqs: listSeqsOf(game),
    code,
    game,
    hostLeftAt: null,
    lastActiveAt: now,
    lastRequests: {},
    stall: null,
    tokens: {},
  };

  return room;
};

const reply = (message: ServerMessage) =>
  ({ message, type: "reply" }) satisfies PlannedEffect;

const BROADCAST = { type: "broadcast" } satisfies PlannedEffect;

const rejection = (message: string, requestId?: string) =>
  reply(
    requestId === undefined
      ? { message, type: "error" }
      : { message, requestId, type: "rejected" }
  );

const attempt = (run: () => PlannedEffect[], requestId?: string) => {
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
      (connection) => playerSeat(connection.admission)?.playerId === playerId
    );

  const admissionOf = (connectionId: string) =>
    [...seats.connections()].find(
      (connection) => connection.id === connectionId
    )?.admission ?? null;

  const seatOf = (connectionId: string) =>
    playerSeat(admissionOf(connectionId));

  const spectatorCount = () =>
    [...seats.connections()].filter(({ admission }) => isSpectator(admission))
      .length;

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
      lastRequestId: stored.lastRequests[playerId],
      playerId,
      token,
      type: "welcome",
    });

  const snapshot = () =>
    toStateMessage(stored.code, game, {}, spectatorCount());

  const preview = () => toRoomPreview(stored.code, game, spectatorCount());

  const broadcastMessage = () => {
    const message = toStateMessage(
      stored.code,
      game,
      stored.broadcastSeqs,
      spectatorCount()
    );

    stored.broadcastSeqs = listSeqsOf(game);

    return message;
  };

  const finish = (planned: PlannedEffect[], expired = false) => {
    const now = deps.now();
    syncTimers(stored, now);

    let broadcast: ServerMessage | undefined;

    const effects = planned.map((effect) => {
      if (effect.type !== "broadcast") {
        return effect;
      }

      broadcast ??= broadcastMessage();

      return {
        message: broadcast,
        preview: preview(),
        type: "broadcast",
      } satisfies RoomEffect;
    });

    const deadlines: number[] = [];

    for (const { admission, lastPing } of seats.connections()) {
      if (admission) {
        deadlines.push(heartbeatDeadline(admittedAt(admission), lastPing));
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
    const joinedToken = joined ? stored.tokens[joined.playerId] : undefined;

    if (joined && joinedToken !== undefined) {
      return welcome(joined.playerId, joinedToken);
    }

    const known = Object.entries(stored.tokens).find(
      ([, saved]) => saved === token
    );

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
    stored.tokens[playerId] = newToken;
    seat(connectionId, playerId);

    return welcome(playerId, newToken);
  };

  const evict = (playerId: string, reason: "kicked" | "left") => {
    stored.tokens = withoutPlayer(stored.tokens, playerId);
    stored.lastRequests = withoutPlayer(stored.lastRequests, playerId);

    return seatedConnections(playerId).map((connection) => {
      seats.assign(connection.id, null);

      return {
        code: ROOM_REMOVED_CLOSE_CODE,
        connectionId: connection.id,
        reason,
        type: "close",
      } satisfies PlannedEffect;
    });
  };

  const act = (playerId: string, command: GameCommand) => {
    const none: PlannedEffect[] = [];
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

  const dropSilentConnections = (now: number) => {
    const silentIds = new Set<string>();
    const closes: PlannedEffect[] = [];

    let changed = false;

    for (const { id, admission, lastPing } of seats.connections()) {
      if (!admission) {
        continue;
      }

      if (now < heartbeatDeadline(admittedAt(admission), lastPing)) {
        continue;
      }

      if ("playerId" in admission) {
        silentIds.add(admission.playerId);
      } else {
        changed = true;
      }

      seats.assign(id, null);
      closes.push({
        code: HEARTBEAT_CLOSE_CODE,
        connectionId: id,
        reason: "Heartbeat timed out",
        type: "close",
      });
    }

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
      const dropped = dropSilentConnections(now);

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

      const effects: PlannedEffect[] =
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

    typing: (connectionId: string) => {
      const playerId = seatOf(connectionId)?.playerId;

      return finish(
        playerId !== undefined && findPlayer(game, playerId)
          ? [
              {
                except: connectionId,
                message: { playerId, type: "typing" },
                type: "relay",
              },
            ]
          : []
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

          if (!isRoomCommand(command)) {
            stored.lastRequests[playerId] = requestId;
          }

          return [BROADCAST, reply({ requestId, type: "accepted" }), ...closes];
        }, requestId),
        onlyBotsLeft()
      );
    },

    disconnect: (admission: Admission | null) => {
      if (isSpectator(admission)) {
        touch();

        return finish([BROADCAST]);
      }

      const departed = playerSeat(admission);

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
        attempt(() => [
          joinSeat(connectionId, name, token, avatar),
          reply(snapshot()),
          BROADCAST,
        ])
      );
    },

    reconcile: () => {
      const seated = new Set(
        Array.from(
          seats.connections(),
          (connection) => playerSeat(connection.admission)?.playerId
        )
      );

      let changed = false;

      for (const player of game.players) {
        const connected = player.bot || seated.has(player.id);

        if (connected !== player.connected) {
          player.connected = connected;
          changed = true;
        }
      }

      return finish(changed ? [BROADCAST] : []);
    },

    snapshot,

    viewFor: (connectionId: string) =>
      admissionOf(connectionId) ? snapshot() : preview(),

    watch: (connectionId: string) => {
      const admission = admissionOf(connectionId);

      const reject = (message: string) =>
        finish([reply({ message, type: "watchError" })]);

      if (playerSeat(admission)) {
        return reject("Leave the room before choosing Watch.");
      }

      if (admission) {
        return finish([reply({ type: "watching" }), reply(snapshot())]);
      }

      if (game.settings.locked) {
        return reject("This room is locked. Ask the host to unlock it.");
      }

      if (spectatorCount() >= MAX_SPECTATORS) {
        return reject(
          "The spectator limit has been reached. You can still join as a player if there's room."
        );
      }

      seats.assign(connectionId, { watchedAt: deps.now() });
      touch();

      return finish([
        reply({ type: "watching" }),
        reply(snapshot()),
        BROADCAST,
      ]);
    },

    watchInstead: (connectionId: string) => {
      const playerId = seatOf(connectionId)?.playerId;

      const reject = (message: string) =>
        finish([reply({ message, type: "watchError" })]);

      if (playerId === undefined || !findPlayer(game, playerId)) {
        return reject("Join the room first.");
      }

      const blocked = rejectWatchInstead(game, playerId, spectatorCount());

      if (blocked !== null) {
        return reject(blocked);
      }

      touch();
      leaveToWatch(game, playerId, deps.random);

      const closes = evict(playerId, "left").filter(
        (close) => close.connectionId !== connectionId
      );

      seats.assign(connectionId, { watchedAt: deps.now() });

      return finish([
        reply({ type: "watching" }),
        reply(snapshot()),
        BROADCAST,
        ...closes,
      ]);
    },

    stopWatching: (connectionId: string) => {
      if (!isSpectator(admissionOf(connectionId))) {
        return finish([]);
      }

      seats.assign(connectionId, null);
      touch();

      return finish([BROADCAST]);
    },
  };
};
