import { makeConnectivityListener } from "@solid-primitives/connectivity";
import { usePageVisibility } from "@solid-primitives/page-utilities";
import { makeObjectStorage, makePersisted } from "@solid-primitives/storage";
import { makeTimer } from "@solid-primitives/timer";
import {
  makeHeartbeatWS,
  makeReconnectingWS,
} from "@solid-primitives/websocket";
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
} from "../game/protocol";
import type { RoomView, ServerMessage } from "../game/protocol";
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

const socketUrl = (code: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${location.host}/api/rooms/${code}/socket`;
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
  let socket: ReturnType<typeof makeHeartbeatWS> | null = null;
  let awaitingWelcome = false;
  let cancelRetry: VoidFunction | undefined;
  let noticeId = 0;
  let failures = 0;
  let activeSocket: EventTarget | null = null;
  let lastRequestId: string | undefined;
  let pendingMove: PendingMove | null = null;
  let disposed = false;

  const settleMove = (accepted: boolean) => {
    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
      pendingMove.resolve(accepted);
      pendingMove = null;
      setSending(false);
    }
  };

  const startSync = () => {
    activeSocket = null;
    previousRoom = null;
    seatedPlayerId = null;
    lastRequestId = undefined;
    awaitingWelcome = false;
    setReady(false);

    if (pendingMove) {
      clearTimeout(pendingMove.timeout);
    }
  };

  const raw = (message: ClientMessage) => {
    if (socket?.readyState !== WebSocket.OPEN) {
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

      case "removed": {
        settleMove(false);
        startSync();
        forget();
        setStatus("removed");
        socket?.close();

        return;
      }

      default: {
        message satisfies never;
      }
    }
  };

  const recheckRoom = async () => {
    const exists = await roomExists(code).catch(() => true);

    if (!exists && !disposed && untrack(status) === "reconnecting") {
      settleMove(false);
      startSync();
      setStatus("missing");
      socket?.close();
    }
  };

  const connect = () => {
    const ws = makeHeartbeatWS(
      makeReconnectingWS(socketUrl(code), undefined, {
        delay: RETRY_DELAY_MS,
      }),
      HEARTBEAT
    );

    socket = ws;
    ws.addEventListener("open", (event) => {
      if (disposed) {
        ws.close();

        return;
      }

      startSync();
      activeSocket = event.currentTarget;
      failures = 0;
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
      if (disposed || event.currentTarget !== activeSocket) {
        return;
      }

      const message = parseServerMessage(event.data);

      if (message) {
        handle(message);
      }
    });
    ws.addEventListener("close", () => {
      const current = status();

      // WARNING: a replaced socket can report its close after the new one opened.
      if (
        disposed ||
        ws.readyState === WebSocket.OPEN ||
        current === "removed" ||
        current === "missing"
      ) {
        return;
      }

      startSync();
      setStatus("reconnecting");
      failures += 1;

      if (failures % FAILURES_BEFORE_RECHECK === 0) {
        void recheckRoom();
      }
    });
  };

  const start = async () => {
    try {
      const exists = await roomExists(code);

      if (disposed) {
        return;
      }

      if (exists) {
        connect();
      } else {
        setStatus("missing");
      }
    } catch {
      if (disposed) {
        return;
      }

      setStatus("reconnecting");
      cancelRetry = makeTimer(
        () => {
          void start();
        },
        RETRY_DELAY_MS,
        setTimeout
      );
    }
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
    void start();

    return () => {
      disposed = true;
      cancelRetry?.();
      settleMove(false);
      socket?.close();
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
        socket?.readyState !== WebSocket.OPEN
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
