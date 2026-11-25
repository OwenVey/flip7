import { isRoomCommand } from "../game/client-message";
import type { ClientMessage, GameCommand } from "../game/client-message";
import {
  NO_LISTS,
  receiveState,
  ROOM_MISSING_CLOSE_CODE,
  ROOM_REMOVED_CLOSE_CODE,
  TYPING_SEND_MS,
  TYPING_SHOWN_MS,
} from "../game/protocol";
import type {
  ReceivedLists,
  RoomPreview,
  RoomView,
  ServerMessage,
} from "../game/protocol";

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
  /** Advances with the first room snapshot received on each connection. */
  syncId: number;
  room: RoomView | null;
  preview: RoomPreview | null;
  watching: boolean;
  watchError: string;
  watchPending: boolean;
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
  /** Other players typing a chat message right now, by player ID. */
  typing: string[];
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
  watchPreference: { get: () => boolean; set: (watching: boolean) => void };
}

interface PendingReply {
  resolve: (accepted: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingMove extends PendingReply {
  requestId: string;
}

const REPLY_TIMEOUT_MS = 6000;
const RESYNC_TIMEOUT_MS = 10_000;
const FAILURES_BEFORE_RECHECK = 3;
const TRY_AGAIN = "Reconnecting. Try again in a moment.";

const shouldRecheck = (retryCount: number) =>
  retryCount === 1 ||
  (retryCount > 0 && retryCount % FAILURES_BEFORE_RECHECK === 0);

/**
 * The browser side of the room protocol: watching, joining and rejoining by token, the
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
    preview: null,
    ready: false,
    room: null,
    sending: false,
    status: "connecting",
    syncId: 0,
    typing: [],
    watchError: "",
    watchPending: false,
    watching: false,
  };

  let synced = false;
  let lists: ReceivedLists = NO_LISTS;
  let askedForLists = false;
  let seatedPlayerId: string | null = null;
  let awaitingWelcome = false;
  let joinTimeout: ReturnType<typeof setTimeout> | undefined;
  let resyncTimeout: ReturnType<typeof setTimeout> | undefined;
  let noticeId = 0;
  let lastRequestId: string | undefined;
  let pendingMove: PendingMove | null = null;
  const roomCommands = new Map<string, PendingReply>();
  let stopped = false;
  let wasVisible = false;
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let typingSentAt: number | null = null;
  let typingShown = false;

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
    const pending = roomCommands.get(requestId);

    if (pending) {
      clearTimeout(pending.timeout);
      roomCommands.delete(requestId);
      pending.resolve(accepted);
    }
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

  const stopTyping = (playerId: string) => {
    clearTimeout(typingTimers.get(playerId));

    if (typingTimers.delete(playerId)) {
      update({ typing: state.typing.filter((id) => id !== playerId) });
    }
  };

  const clearTyping = () => {
    for (const playerId of typingTimers.keys()) {
      stopTyping(playerId);
    }
  };

  const showTyping = (playerId: string) => {
    if (playerId === seatedPlayerId) {
      return;
    }

    clearTimeout(typingTimers.get(playerId));
    typingTimers.set(
      playerId,
      setTimeout(() => {
        stopTyping(playerId);
      }, TYPING_SHOWN_MS)
    );

    if (!state.typing.includes(playerId)) {
      update({ typing: [...state.typing, playerId] });
    }
  };

  const finishJoin = (error = "") => {
    clearTimeout(joinTimeout);
    joinTimeout = undefined;
    update({ joinError: error, joining: false });
  };

  const startSync = () => {
    synced = false;
    // WARNING: a new socket starts with the full lists, so don't build on what the old one sent.
    lists = NO_LISTS;
    askedForLists = false;
    seatedPlayerId = null;
    lastRequestId = undefined;
    awaitingWelcome = false;
    typingSentAt = null;
    typingShown = false;
    clearTyping();

    if (state.joining) {
      finishJoin("Connection lost while joining. Try again when reconnected.");
    }

    update({
      ready: false,
      watchPending: false,
      ...(state.watching && { room: null, watching: false }),
    });
    dropRoomCommands();

    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
    }
  };

  const clearSyncTimeout = () => {
    clearTimeout(resyncTimeout);
    resyncTimeout = undefined;
  };

  const stop = (status: ConnectionStatus) => {
    clearSyncTimeout();
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
    update({ playerId: null, room: null });
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

  const receiveRoomState = (
    message: Extract<ServerMessage, { type: "state" }>
  ) => {
    if (seatedPlayerId === null && !state.watching) {
      return;
    }

    const received = receiveState(lists, message);
    ({ lists } = received);

    if (received.gaps.length === 0) {
      askedForLists = false;
    } else if (!askedForLists) {
      askedForLists = raw({ type: "sync" });
    }

    // WARNING: deal playback reads the cards dealt since the shown room from draws, so keep showing that room until they arrive.
    if (received.gaps.includes("draws")) {
      return;
    }

    const firstSync = !synced;
    synced = true;
    update({
      room: received.room,
      ...(firstSync && { syncId: state.syncId + 1 }),
    });

    if (firstSync) {
      clearSyncTimeout();
      settleAfterReconnect();
      update({ ready: seatedPlayerId !== null, status: "open" });
    }
  };

  const watched = () => {
    if (!state.watchPending) {
      return;
    }

    deps.watchPreference.set(true);

    if (seatedPlayerId !== null) {
      seatedPlayerId = null;
      lastRequestId = undefined;
      deps.token.set(null);
      settleMove(false);
      dropRoomCommands();
      update({ playerId: null, ready: false });
    }

    update({
      needsName: false,
      watchError: "",
      watchPending: false,
      watching: true,
    });
  };

  const watchRefused = (message: string) => {
    if (!state.watchPending) {
      return;
    }

    if (seatedPlayerId !== null) {
      update({ watchPending: false });
      notify(message);

      return;
    }

    clearSyncTimeout();
    deps.watchPreference.set(false);
    update({
      needsName: true,
      status: "open",
      watchError: message,
      watchPending: false,
    });
  };

  const handle = (message: ServerMessage) => {
    switch (message.type) {
      case "preview": {
        update({ preview: message.room });

        return;
      }

      case "watching": {
        watched();

        return;
      }

      case "watchError": {
        watchRefused(message.message);

        return;
      }

      case "state": {
        receiveRoomState(message);

        return;
      }

      case "typing": {
        if (message.active) {
          showTyping(message.playerId);
        } else {
          stopTyping(message.playerId);
        }

        return;
      }

      case "welcome": {
        awaitingWelcome = false;
        deps.token.set(message.token);
        deps.watchPreference.set(false);
        synced = false;
        seatedPlayerId = message.playerId;
        ({ lastRequestId } = message);
        update({
          needsName: false,
          playerId: message.playerId,
          watching: false,
        });

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
          clearSyncTimeout();

          if (!state.watching) {
            forget();
            settleMove(false);
          }

          update({ needsName: !state.watching, status: "open" });

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
    clearSyncTimeout();
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

  const requestWatch = () => {
    if (!raw({ type: "watch" })) {
      update({ watchError: TRY_AGAIN });

      return;
    }

    watchSync();
    update({
      needsName: true,
      status: "open",
      watchError: "",
      watchPending: true,
    });
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
      const sent = state.online && state.ready && raw({ text, type: "chat" });

      if (sent) {
        typingShown = false;
      }

      return sent;
    },

    typing: (active: boolean) => {
      if (!state.online || !state.ready) {
        return;
      }

      if (!active) {
        if (typingShown && raw({ active: false, type: "typing" })) {
          typingShown = false;
        }

        return;
      }

      const now = Date.now();

      if (typingSentAt !== null && now - typingSentAt < TYPING_SEND_MS) {
        return;
      }

      if (raw({ active: true, type: "typing" })) {
        typingSentAt = now;
        typingShown = true;
      }
    },

    closed: (code: number, retryCount: number) => {
      if (stopped) {
        return;
      }

      if (code === ROOM_MISSING_CLOSE_CODE) {
        deps.watchPreference.set(false);
        forget();
        stop("missing");

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
      if (
        (!state.needsName && !state.watching) ||
        awaitingWelcome ||
        state.watchPending ||
        stopped
      ) {
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
        clearSyncTimeout();

        if (deps.watchPreference.get()) {
          requestWatch();
        } else {
          update({ needsName: true, status: "open" });
        }

        return;
      }

      clearSyncTimeout();
      watchSync();
      awaitingWelcome = true;
      raw({ name: "", token: saved, type: "join" });
    },

    received: (message: ServerMessage) => {
      if (!stopped) {
        handle(message);
      }
    },

    returnToRoom: () => {
      if (state.status === "removed") {
        stopped = false;
        update({ needsName: false, preview: null });
        startOver();
      }
    },

    retry: () => {
      if (!stopped) {
        startOver();
      }
    },

    send: async (command: GameCommand) => {
      const roomCommand = isRoomCommand(command);

      if (stopped || (pendingMove && !roomCommand)) {
        return false;
      }

      if (!state.online || !state.ready || !socket.isOpen()) {
        notify(TRY_AGAIN);

        return false;
      }

      const requestId = deps.newId();

      if (roomCommand) {
        const { promise, resolve } = Promise.withResolvers<boolean>();

        const timeout = setTimeout(() => {
          settleRoomCommand(requestId, false);
          notify("The room couldn't confirm your request.");
        }, REPLY_TIMEOUT_MS);

        roomCommands.set(requestId, { resolve, timeout });

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

    watch: () => {
      if (
        state.needsName &&
        state.online &&
        !state.watchPending &&
        !awaitingWelcome &&
        !stopped
      ) {
        requestWatch();
      }
    },

    watchInstead: () => {
      if (
        seatedPlayerId === null ||
        state.watchPending ||
        awaitingWelcome ||
        stopped
      ) {
        return;
      }

      if (!state.online || !raw({ type: "watchInstead" })) {
        notify(TRY_AGAIN);

        return;
      }

      update({ watchPending: true });
    },

    stopWatching: () => {
      if (!state.watching || awaitingWelcome || stopped) {
        return;
      }

      deps.watchPreference.set(false);
      synced = false;
      lists = NO_LISTS;
      askedForLists = false;
      update({ needsName: true, room: null, watching: false });

      if (!raw({ type: "stopWatching" })) {
        startOver();
      }
    },

    get state() {
      return state;
    },

    stop: () => {
      if (!stopped) {
        stopped = true;
        clearTimeout(joinTimeout);
        clearSyncTimeout();
        settleMove(false);
        dropRoomCommands();
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
