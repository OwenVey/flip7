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
  /** Seated and synced with the table since the last connect. */
  ready: boolean;
  /** A pending move is waiting for the room's reply. */
  sending: boolean;
  online: boolean;
  notice: Notice | null;
  canAct: boolean;
}

/** The socket the room client talks through. `send` returns false when the frame couldn't be sent. */
export interface RoomSocket {
  isOpen: () => boolean;
  send: (frame: string) => boolean;
  reconnect: () => void;
  close: () => void;
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
const FAILURES_BEFORE_RECHECK = 3;
const TRY_AGAIN = "Reconnecting. Try again in a moment.";

const shouldRecheck = (retryCount: number) =>
  retryCount === 1 ||
  (retryCount > 0 && retryCount % FAILURES_BEFORE_RECHECK === 0);

/**
 * The player's side of the room protocol: joining and rejoining by token, the
 * pending move and how it settles (a reply, a timeout, or the welcome after a
 * reconnect), connection status and the notices shown to the player. Feed it
 * socket events; read `state` or subscribe for changes.
 */
export const createRoomClient = (deps: RoomClientDeps) => {
  const { socket } = deps;
  const listeners = new Set<(state: RoomClientState) => void>();

  let state: RoomClientState = {
    canAct: false,
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
  let noticeId = 0;
  let lastRequestId: string | undefined;
  let pendingMove: PendingMove | null = null;
  let stopped = false;

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

  const settleMove = (accepted: boolean) => {
    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
      pendingMove.resolve(accepted);
      pendingMove = null;
      update({ sending: false });
    }
  };

  const startSync = () => {
    synced = false;
    seatedPlayerId = null;
    lastRequestId = undefined;
    awaitingWelcome = false;
    update({ ready: false });

    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
    }
  };

  const stop = (status: ConnectionStatus) => {
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

        return;
      }

      case "accepted": {
        if (pendingMove?.requestId === message.requestId) {
          settleMove(true);
        }

        return;
      }

      case "rejected": {
        if (pendingMove?.requestId === message.requestId) {
          settleMove(false);
          notify(message.message);
        }

        return;
      }

      case "error": {
        if (awaitingWelcome) {
          awaitingWelcome = false;
          forget();
          settleMove(false);
          update({ needsName: true, status: "open" });
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

  const reconnect = () => {
    startSync();
    update({ status: "reconnecting" });
    socket.reconnect();
  };

  return {
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

      if (shouldRecheck(retryCount)) {
        void recheckRoom();
      }
    },

    join: (name: string) => {
      awaitingWelcome = true;

      if (!raw({ name, token: null, type: "join" })) {
        awaitingWelcome = false;
        notify("Not connected yet. Try again in a moment.");
      }
    },

    opened: () => {
      if (stopped) {
        return;
      }

      startSync();
      const saved = deps.token.get();

      if (saved === null) {
        update({ needsName: true, status: "open" });

        return;
      }

      awaitingWelcome = true;
      raw({ name: "", token: saved, type: "join" });
    },

    received: (message: ServerMessage) => {
      if (!stopped) {
        handle(message);
      }
    },

    resume: () => {
      if (!stopped && state.status === "reconnecting") {
        socket.reconnect();
      }
    },

    send: async (command: GameCommand) => {
      if (pendingMove) {
        return false;
      }

      if (!state.online || !synced || !socket.isOpen()) {
        notify(TRY_AGAIN);

        return false;
      }

      const requestId = deps.newId();
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const timeout = setTimeout(reconnect, REPLY_TIMEOUT_MS);
      pendingMove = { requestId, resolve, timeout };
      update({ sending: true });

      if (!raw({ ...command, requestId })) {
        settleMove(false);
      }

      return await promise;
    },

    setOnline: (online: boolean) => {
      update({ online });
    },

    get state() {
      return state;
    },

    stop: () => {
      if (!stopped) {
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
