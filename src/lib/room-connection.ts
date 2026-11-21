import { makeConnectivityListener } from "@solid-primitives/connectivity";
import { usePageVisibility } from "@solid-primitives/page-utilities";
import { makeObjectStorage, makePersisted } from "@solid-primitives/storage";
import { PartySocket } from "partysocket";
import {
  createEffect,
  createSignal,
  getOwner,
  onSettled,
  runWithOwner,
  untrack,
} from "solid-js";

import type { ClientMessage, GameCommand } from "../game/client-message";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING,
  parseServerMessage,
  ROOM_PARTY,
  ROOM_REMOVED_CLOSE_CODE,
} from "../game/protocol";
import type { RoomView, ServerMessage } from "../game/protocol";
import { makeSteadyHeartbeat } from "./heartbeat";
import { roomExists } from "./room-functions";

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

interface PendingMove {
  requestId: string;
  resolve: (accepted: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const RETRY_DELAY_MS = 1500;
const FAILURES_BEFORE_RECHECK = 3;
const REPLY_TIMEOUT_MS = 6000;

const HEARTBEAT = {
  interval: HEARTBEAT_INTERVAL_MS,
  message: HEARTBEAT_PING,
  wait: 5000,
};

const NAME_KEY = "hot-streak:name";
const STORAGE_PROBE = "hot-streak:probe";

const tokenKey = (code: string) => `hot-streak:token:${code}`;

// WARNING: private windows can throw on any storage access, so fall back to memory.
const usableStorage = (pick: () => Storage) => {
  try {
    const storage = pick();
    storage.setItem(STORAGE_PROBE, STORAGE_PROBE);
    storage.removeItem(STORAGE_PROBE);

    return storage;
  } catch {
    return makeObjectStorage({});
  }
};

const plainText = {
  deserialize: (data: string) => data,
  serialize: (data: string | null) => data ?? "",
};

export const createRoomConnection = (
  code: string,
  onUpdate?: (previous: RoomView, current: RoomView, playerId: string) => void
) => {
  const [room, setRoom] = createSignal<RoomView | null>(null);
  const [playerId, setPlayerId] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ConnectionStatus>("connecting");
  const [needsName, setNeedsName] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice | null>(null);
  const [ready, setReady] = createSignal(false);
  const [sending, setSending] = createSignal(false);

  const [savedName, setSavedName] = makePersisted(
    createSignal("", { ownedWrite: true }),
    {
      ...plainText,
      name: NAME_KEY,
      storage: usableStorage(() => localStorage),
    }
  );

  const [token, setToken] = makePersisted(
    createSignal<string | null>(null, { ownedWrite: true }),
    {
      ...plainText,
      name: tokenKey(code),
      storage: usableStorage(() => sessionStorage),
    }
  );

  const [online, setOnline] = createSignal(true, { ownedWrite: true });
  const owner = getOwner();

  let previousRoom: RoomView | null = null;
  let seatedPlayerId: string | null = null;
  let socket: PartySocket | null = null;
  let awaitingWelcome = false;
  let noticeId = 0;
  let lastRequestId: string | undefined;
  let pendingMove: PendingMove | null = null;

  const settleMove = (accepted: boolean) => {
    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
      pendingMove.resolve(accepted);
      pendingMove = null;
      setSending(false);
    }
  };

  const startSync = () => {
    previousRoom = null;
    seatedPlayerId = null;
    lastRequestId = undefined;
    awaitingWelcome = false;
    setReady(false);

    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
    }
  };

  const closeSocket = () => {
    const closing = socket;
    socket = null;
    closing?.close();
  };

  const raw = (message: ClientMessage) => {
    if (socket?.readyState !== PartySocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));

    return true;
  };

  const notify = (message: string, confirmed = false) => {
    noticeId += 1;
    setNotice({ confirmed, id: noticeId, message });
  };

  const forget = () => {
    seatedPlayerId = null;
    previousRoom = null;
    setToken(null);
    setPlayerId(null);
  };

  const handle = (message: ServerMessage) => {
    switch (message.type) {
      case "state": {
        const previous = previousRoom;
        previousRoom = seatedPlayerId === null ? null : message.room;
        setRoom(message.room);

        if (seatedPlayerId !== null) {
          if (previous) {
            onUpdate?.(previous, message.room, seatedPlayerId);
          } else {
            if (pendingMove) {
              const accepted = pendingMove.requestId === lastRequestId;
              settleMove(accepted);
              notify(
                accepted
                  ? "Reconnected. Your last move counted."
                  : "Couldn't confirm your last move. The table is up to date.",
                accepted
              );
            }

            setStatus("open");
            setReady(true);
          }
        }

        return;
      }

      case "welcome": {
        awaitingWelcome = false;
        setToken(message.token);
        seatedPlayerId = message.playerId;
        ({ lastRequestId } = message);
        setPlayerId(message.playerId);
        setNeedsName(false);

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
          setNeedsName(true);
          setStatus("open");
        }

        notify(message.message);

        return;
      }

      default: {
        message satisfies never;
      }
    }
  };

  const recheckRoom = async (ws: PartySocket) => {
    const exists = await roomExists(code).catch(() => true);

    if (!exists && ws === socket && untrack(status) === "reconnecting") {
      settleMove(false);
      startSync();
      setStatus("missing");
      closeSocket();
    }
  };

  const connect = () => {
    const ws = makeSteadyHeartbeat(
      new PartySocket({
        host: location.host,
        maxEnqueuedMessages: 0,
        minReconnectionDelay: RETRY_DELAY_MS,
        party: ROOM_PARTY,
        protocol: location.protocol === "https:" ? "wss" : "ws",
        room: code,
        shouldReconnectOnClose: ({ code: closeCode }) =>
          closeCode !== ROOM_REMOVED_CLOSE_CODE,
      }),
      HEARTBEAT
    );

    socket = ws;
    ws.addEventListener("open", () => {
      startSync();
      const saved = token();

      if (saved === null) {
        setStatus("open");
        setNeedsName(true);

        return;
      }

      awaitingWelcome = true;
      raw({ name: "", token: saved, type: "join" });
    });
    ws.addEventListener("message", (event: MessageEvent<string>) => {
      if (ws !== socket || ws.readyState !== PartySocket.OPEN) {
        return;
      }

      const message = parseServerMessage(event.data);

      if (message) {
        handle(message);
      }
    });
    ws.addEventListener("close", (event) => {
      if (ws !== socket) {
        return;
      }

      if (event.code === ROOM_REMOVED_CLOSE_CODE) {
        settleMove(false);
        startSync();
        forget();
        setStatus("removed");
        closeSocket();

        return;
      }

      startSync();
      setStatus("reconnecting");
      const { retryCount } = ws;

      if (
        retryCount === 1 ||
        (retryCount > 0 && retryCount % FAILURES_BEFORE_RECHECK === 0)
      ) {
        void recheckRoom(ws);
      }
    });
  };

  const watchConnectivity = () => {
    makeConnectivityListener((isOnline) => {
      setOnline(isOnline);
    });
    const visible = usePageVisibility();
    createEffect(
      () => online() && visible(),
      (back) => {
        if (back && untrack(status) === "reconnecting") {
          socket?.reconnect();
        }
      }
    );
  };

  // WARNING: browser-only primitives add owners the server render lacks, so start them after hydration.
  onSettled(() => {
    setOnline(navigator.onLine);
    runWithOwner(owner, watchConnectivity);
    connect();

    return () => {
      settleMove(false);
      closeSocket();
    };
  });

  return {
    canAct: () => online() && ready() && !sending(),
    chat: (text: string) => {
      if (!online() || previousRoom === null || !raw({ text, type: "chat" })) {
        notify("Reconnecting. Try again in a moment.");

        return false;
      }

      return true;
    },
    join: (name: string) => {
      setSavedName(name);
      awaitingWelcome = true;

      if (!raw({ name, token: null, type: "join" })) {
        awaitingWelcome = false;
        notify("Not connected yet. Try again in a moment.");
      }
    },
    needsName,
    notice,
    online,
    playerId,
    room,
    savedName,
    send: async (command: GameCommand) => {
      if (pendingMove) {
        return false;
      }

      if (
        !online() ||
        previousRoom === null ||
        socket?.readyState !== PartySocket.OPEN
      ) {
        notify("Reconnecting. Try again in a moment.");

        return false;
      }

      const requestId = crypto.randomUUID();
      const { promise, resolve } = Promise.withResolvers<boolean>();

      const timeout = setTimeout(() => {
        startSync();
        setStatus("reconnecting");
        socket?.reconnect();
      }, REPLY_TIMEOUT_MS);

      pendingMove = { requestId, resolve, timeout };
      setSending(true);

      if (!raw({ ...command, requestId })) {
        settleMove(false);
      }

      return await promise;
    },
    status,
  };
};

export type RoomConnection = ReturnType<typeof createRoomConnection>;
