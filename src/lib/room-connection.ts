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

import type { ClientMessage } from "../game/client-message";
import { HEARTBEAT_PING, parseServerMessage } from "../game/protocol";
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
}

type GameCommand = Exclude<ClientMessage, { type: "join" }>;

const RETRY_DELAY_MS = 1500;
const FAILURES_BEFORE_RECHECK = 3;
const REPLY_TIMEOUT_MS = 5000;
const HEARTBEAT = { interval: 20_000, message: HEARTBEAT_PING, wait: 5000 };
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
  onUpdate: (previous: RoomView, current: RoomView, playerId: string) => void
) => {
  const [room, setRoom] = createSignal<RoomView | null>(null);
  const [playerId, setPlayerId] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ConnectionStatus>("connecting");
  const [needsName, setNeedsName] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice | null>(null);

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
  let replyWaiters: VoidFunction[] = [];

  const settleReplies = () => {
    const waiters = replyWaiters;
    replyWaiters = [];

    for (const resolve of waiters) {
      resolve();
    }
  };

  const nextReply = async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    replyWaiters.push(() => {
      resolve(true);
    });

    const timer = setTimeout(() => {
      resolve(false);
    }, REPLY_TIMEOUT_MS);

    const replied = await promise;
    clearTimeout(timer);

    return replied;
  };

  const raw = (message: ClientMessage) => {
    if (socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));

    return true;
  };

  const notify = (message: string) => {
    noticeId += 1;
    setNotice({ id: noticeId, message });
  };

  const forget = () => {
    seatedPlayerId = null;
    previousRoom = null;
    setToken(null);
    setPlayerId(null);
  };

  const handle = (message: ServerMessage) => {
    settleReplies();

    switch (message.type) {
      case "state": {
        const previous = previousRoom;
        previousRoom = seatedPlayerId === null ? null : message.room;
        setRoom(message.room);

        if (previous && seatedPlayerId !== null) {
          onUpdate(previous, message.room, seatedPlayerId);
        }

        return;
      }

      case "welcome": {
        awaitingWelcome = false;
        setToken(message.token);
        seatedPlayerId = message.playerId;
        setPlayerId(message.playerId);
        setNeedsName(false);

        return;
      }

      case "error": {
        if (awaitingWelcome) {
          awaitingWelcome = false;
          forget();
          setNeedsName(true);
        }

        notify(message.message);

        return;
      }

      case "removed": {
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

    if (!exists) {
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
    ws.addEventListener("open", () => {
      previousRoom = null;
      seatedPlayerId = null;
      failures = 0;
      setStatus("open");
      const saved = token();

      if (saved === null) {
        setNeedsName(true);

        return;
      }

      awaitingWelcome = true;
      raw({ name: "", token: saved, type: "join" });
    });
    ws.addEventListener("message", (event: MessageEvent<string>) => {
      const message = parseServerMessage(event.data);

      if (message) {
        handle(message);
      }
    });
    ws.addEventListener("close", () => {
      settleReplies();
      const current = status();

      // WARNING: a replaced socket can report its close after the new one opened.
      if (
        ws.readyState === WebSocket.OPEN ||
        current === "removed" ||
        current === "missing"
      ) {
        return;
      }

      setStatus("reconnecting");
      failures += 1;

      if (failures % FAILURES_BEFORE_RECHECK === 0) {
        void recheckRoom();
      }
    });
  };

  const start = async () => {
    try {
      if (await roomExists(code)) {
        connect();
      } else {
        setStatus("missing");
      }
    } catch {
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
      cancelRetry?.();
      socket?.close();
    };
  });

  return {
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
      if (!raw(command)) {
        notify("Reconnecting. Try again in a moment.");

        return false;
      }

      return await nextReply();
    },
    status,
  };
};

export type RoomConnection = ReturnType<typeof createRoomConnection>;
