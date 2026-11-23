import { isRoomCommand } from "../game/client-message";
import type { ClientMessage, GameCommand } from "../game/client-message";
import { ROOM_REMOVED_CLOSE_CODE } from "../game/protocol";
import type { RoomView, ServerMessage } from "../game/protocol";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "missing"
  | "removed";

export interface Notice {
  id: number;
  message: string;
  confirmed?: boolean;
}

export interface RoomClientState {
  status: ConnectionStatus;
  room: RoomView | null;
  playerId: string | null;
  needsName: boolean;
  joining: boolean;
  joinError: string;
  /** Seated and synced with the table since the last connect. */
  ready: boolean;
  /** A pending move is waiting for the room's reply. */
  sending: boolean;
  online: boolean;
  notice: Notice | null;
  canAct: boolean;
}

/**
 * The socket the room client talks through. `send` returns false when the frame couldn't be sent.
 * `reconnect` retries the current socket. `replace` starts over with a fresh socket.
 */
export interface RoomSocket {
  isOpen: () => boolean;
  send: (frame: string) => boolean;
  reconnect: () => void;
  replace: () => void;
  close: () => void;
}

/** What the browser reports about the page: whether it's online and whether it's showing. */
export interface BrowserState {
  online: boolean;
  visible: boolean;
}

export interface RoomClientDeps {
  socket: RoomSocket;
  roomExists: () => Promise<boolean>;
  newId: () => string;
  /** Where the rejoin token for this room is kept. */
  token: { get: () => string | null; set: (token: string | null) => void };
}

interface PendingMove {
  requestId: string;
  resolve: (accepted: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const REPLY_TIMEOUT_MS = 6000;
const RESYNC_TIMEOUT_MS = 10_000;
const FAILURES_BEFORE_RECHECK = 3;
const TRY_AGAIN = "Reconnecting. Try again in a moment.";

const shouldRecheck = (retryCount: number) =>
  retryCount === 1 ||
  (retryCount > 0 && retryCount % FAILURES_BEFORE_RECHECK === 0);

/**
 * The player's side of the room protocol: joining and rejoining by token, the
 * pending move and how it settles (a reply, a timeout, or the welcome after a
 * reconnect), connection status and the notices shown to the player. Feed it
 * browser and socket events; read `state` or subscribe for changes.
 */
export const createRoomClient = (deps: RoomClientDeps) => {
  const { socket } = deps;
  const listeners = new Set<(state: RoomClientState) => void>();

  let state: RoomClientState = {
    canAct: false,
    joinError: "",
    joining: false,
    needsName: false,
    notice: null,
    online: true,
    playerId: null,
    ready: false,
    room: null,
    sending: false,
    status: "connecting",
  };

  let synced = false;
  let seatedPlayerId: string | null = null;
  let awaitingWelcome = false;
  let joinTimeout: ReturnType<typeof setTimeout> | undefined;
  let resyncTimeout: ReturnType<typeof setTimeout> | undefined;
  let noticeId = 0;
  let lastRequestId: string | undefined;
  let pendingMove: PendingMove | null = null;
  const roomCommands = new Map<string, (accepted: boolean) => void>();
  let stopped = false;
  let wasVisible = false;

  const update = (patch: Partial<Omit<RoomClientState, "canAct">>) => {
    const next = { ...state, ...patch };
    next.canAct = next.online && next.ready && !next.sending;
    state = next;

    for (const listener of listeners) {
      listener(state);
    }
  };

  const notify = (message: string, confirmed = false) => {
    noticeId += 1;
    update({ notice: { confirmed, id: noticeId, message } });
  };

  const raw = (message: ClientMessage) =>
    socket.isOpen() && socket.send(JSON.stringify(message));

  const settleRoomCommand = (requestId: string, accepted: boolean) => {
    roomCommands.get(requestId)?.(accepted);
    roomCommands.delete(requestId);
  };

  const dropRoomCommands = () => {
    for (const requestId of roomCommands.keys()) {
      settleRoomCommand(requestId, false);
    }
  };

  const settleMove = (accepted: boolean) => {
    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
      pendingMove.resolve(accepted);
      pendingMove = null;
      update({ sending: false });
    }
  };

  const finishJoin = (error = "") => {
    clearTimeout(joinTimeout);
    joinTimeout = undefined;
    update({ joinError: error, joining: false });
  };

  const startSync = () => {
    synced = false;
    seatedPlayerId = null;
    lastRequestId = undefined;
    awaitingWelcome = false;

    if (state.joining) {
      finishJoin("Connection lost while joining. Try again when reconnected.");
    }

    update({ ready: false });
    dropRoomCommands();

    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
    }
  };

  const stopWatchingSync = () => {
    clearTimeout(resyncTimeout);
    resyncTimeout = undefined;
  };

  const stop = (status: ConnectionStatus) => {
    stopWatchingSync();
    settleMove(false);
    startSync();
    update({ status });
    stopped = true;
    socket.close();
  };

  const forget = () => {
    seatedPlayerId = null;
    synced = false;
    deps.token.set(null);
    update({ playerId: null });
  };

  const settleAfterReconnect = () => {
    if (!pendingMove) {
      return;
    }

    const accepted = pendingMove.requestId === lastRequestId;
    settleMove(accepted);
    notify(
      accepted
        ? "Reconnected. Your last move counted."
        : "Couldn't confirm your last move. The table is up to date.",
      accepted
    );
  };

  const handle = (message: ServerMessage) => {
    switch (message.type) {
      case "state": {
        const firstSync = seatedPlayerId !== null && !synced;
        synced = seatedPlayerId !== null;
        update({ room: message.room });

        if (firstSync) {
          stopWatchingSync();
          settleAfterReconnect();
          update({ ready: true, status: "open" });
        }

        return;
      }

      case "welcome": {
        awaitingWelcome = false;
        deps.token.set(message.token);
        seatedPlayerId = message.playerId;
        ({ lastRequestId } = message);
        update({ needsName: false, playerId: message.playerId });

        if (state.joining) {
          finishJoin();
        }

        return;
      }

      case "accepted": {
        if (pendingMove?.requestId === message.requestId) {
          settleMove(true);
        }

        settleRoomCommand(message.requestId, true);

        return;
      }

      case "rejected": {
        if (pendingMove?.requestId === message.requestId) {
          settleMove(false);
          notify(message.message);
        }

        if (roomCommands.has(message.requestId)) {
          settleRoomCommand(message.requestId, false);
          notify(message.message);
        }

        return;
      }

      case "error": {
        if (awaitingWelcome) {
          awaitingWelcome = false;
          forget();
          stopWatchingSync();
          settleMove(false);
          update({ needsName: true, status: "open" });

          if (state.joining) {
            finishJoin(message.message);

            return;
          }
        }

        notify(message.message);

        return;
      }

      default: {
        message satisfies never;
      }
    }
  };

  const recheckRoom = async () => {
    const exists = await deps.roomExists().catch(() => true);

    if (!exists && !stopped && state.status === "reconnecting") {
      stop("missing");
    }
  };

  const replaceConnection = () => {
    stopWatchingSync();
    startSync();
    update({ status: "reconnecting" });
    socket.replace();
  };

  // WARNING: iOS Safari can wedge a socket in the background, so replace one that stays unsynced.
  const watchSync = () => {
    resyncTimeout ??= setTimeout(() => {
      resyncTimeout = undefined;

      if (!stopped) {
        replaceConnection();
        watchSync();
      }
    }, RESYNC_TIMEOUT_MS);
  };

  const startOver = () => {
    replaceConnection();
    watchSync();
  };

  return {
    browserStateChanged: ({ online, visible }: BrowserState) => {
      if (stopped) {
        return;
      }

      const returned = online && visible && !(state.online && wasVisible);

      wasVisible = visible;

      if (online !== state.online) {
        update({ online });
      }

      if (returned && state.status === "reconnecting") {
        startOver();
      }
    },

    clearJoinError: () => {
      if (state.joinError) {
        update({ joinError: "" });
      }
    },

    chat: (text: string) => {
      if (!state.online || !synced || !raw({ text, type: "chat" })) {
        notify(TRY_AGAIN);

        return false;
      }

      return true;
    },

    closed: (code: number, retryCount: number) => {
      if (stopped) {
        return;
      }

      if (code === ROOM_REMOVED_CLOSE_CODE) {
        forget();
        stop("removed");

        return;
      }

      startSync();
      update({ status: "reconnecting" });
      watchSync();

      if (shouldRecheck(retryCount)) {
        void recheckRoom();
      }
    },

    heartbeatMissed: () => {
      if (!stopped) {
        socket.reconnect();
      }
    },

    join: (name: string, avatar?: number) => {
      if (!state.needsName || awaitingWelcome || stopped) {
        return;
      }

      if (!state.online || state.status !== "open" || !socket.isOpen()) {
        finishJoin("Not connected yet. Try again in a moment.");

        return;
      }

      awaitingWelcome = true;
      update({ joinError: "", joining: true });
      joinTimeout = setTimeout(startOver, REPLY_TIMEOUT_MS);

      if (!raw({ avatar, name, token: null, type: "join" })) {
        awaitingWelcome = false;
        finishJoin("Not connected yet. Try again in a moment.");
      }
    },

    opened: () => {
      if (stopped) {
        return;
      }

      startSync();
      const saved = deps.token.get();

      if (saved === null) {
        stopWatchingSync();
        update({ needsName: true, status: "open" });

        return;
      }

      stopWatchingSync();
      watchSync();
      awaitingWelcome = true;
      raw({ name: "", token: saved, type: "join" });
    },

    received: (message: ServerMessage) => {
      if (!stopped) {
        handle(message);
      }
    },

    retry: () => {
      if (!stopped) {
        startOver();
      }
    },

    send: async (command: GameCommand) => {
      const roomCommand = isRoomCommand(command);

      if (pendingMove && !roomCommand) {
        return false;
      }

      if (!state.online || !synced || !socket.isOpen()) {
        notify(TRY_AGAIN);

        return false;
      }

      const requestId = deps.newId();

      if (roomCommand) {
        const { promise, resolve } = Promise.withResolvers<boolean>();
        roomCommands.set(requestId, resolve);

        if (!raw({ ...command, requestId })) {
          settleRoomCommand(requestId, false);
        }

        return await promise;
      }

      const { promise, resolve } = Promise.withResolvers<boolean>();
      const timeout = setTimeout(startOver, REPLY_TIMEOUT_MS);
      pendingMove = { requestId, resolve, timeout };
      update({ sending: true });

      if (!raw({ ...command, requestId })) {
        settleMove(false);
      }

      return await promise;
    },

    get state() {
      return state;
    },

    stop: () => {
      if (!stopped) {
        clearTimeout(joinTimeout);
        stopWatchingSync();
        settleMove(false);
        stopped = true;
        socket.close();
      }
    },

    subscribe: (listener: (next: RoomClientState) => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type RoomClient = ReturnType<typeof createRoomClient>;
