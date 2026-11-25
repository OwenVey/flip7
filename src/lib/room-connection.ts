import { makeObjectStorage, makePersisted } from "@solid-primitives/storage";
import { PartySocket } from "partysocket";
import { createMemo, createSignal, onSettled, untrack } from "solid-js";

import { parseSavedAvatar } from "../game/avatars";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING,
  parseServerMessage,
  ROOM_MISSING_CLOSE_CODE,
  ROOM_PARTY,
  ROOM_REMOVED_CLOSE_CODE,
} from "../game/protocol";
import { makeSteadyHeartbeat } from "./heartbeat";
import {
  AVATAR_KEY,
  forgetRoom,
  NAME_KEY,
  rememberRoom,
  tokenKey,
} from "./recent-rooms";
import { createRoomClient } from "./room-client";
import { roomExists } from "./room-functions";

export type { ConnectionStatus, Notice } from "./room-client";

const RETRY_DELAY_MS = 1500;

const HEARTBEAT = {
  interval: HEARTBEAT_INTERVAL_MS,
  message: HEARTBEAT_PING,
  wait: 5000,
};

const STORAGE_PROBE = "flip7:probe";

const FRESH_PARAM = "fresh";

const pickTokenStorage = () =>
  import.meta.env.DEV && new URLSearchParams(location.search).has(FRESH_PARAM)
    ? sessionStorage
    : localStorage;

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

export const createRoomConnection = (code: string) => {
  const [savedName, setSavedName] = makePersisted(
    createSignal("", { ownedWrite: true }),
    {
      ...plainText,
      name: NAME_KEY,
      storage: usableStorage(() => localStorage),
    }
  );

  const [savedAvatar, setSavedAvatar] = makePersisted(
    createSignal<number | null>(null, { ownedWrite: true }),
    {
      deserialize: parseSavedAvatar,
      name: AVATAR_KEY,
      serialize: (avatar: number | null) => String(avatar ?? ""),
      storage: usableStorage(() => localStorage),
    }
  );

  const tokenStorage = usableStorage(pickTokenStorage);

  const [token, setToken] = makePersisted(
    createSignal<string | null>(null, { ownedWrite: true }),
    {
      ...plainText,
      name: tokenKey(code),
      storage: tokenStorage,
    }
  );

  const [watchPreference, setWatchPreference] = makePersisted(
    createSignal(false, { ownedWrite: true }),
    {
      deserialize: (data) => data === "watch",
      name: `flip7:watch:${code}`,
      serialize: (watching) => (watching ? "watch" : ""),
      storage: usableStorage(() => sessionStorage),
    }
  );

  let socket: PartySocket | null = null;

  const client = createRoomClient({
    newId: () => crypto.randomUUID(),
    roomExists: async () => await roomExists(code),
    socket: {
      close: () => {
        const closing = socket;
        socket = null;
        closing?.close();
      },
      isOpen: () => socket?.readyState === PartySocket.OPEN,
      reconnect: () => {
        socket?.reconnect();
      },
      // WARNING: a PartySocket that sat through iOS backgrounding can stop retrying, so build a new one.
      replace: () => {
        const stale = socket;
        socket = null;
        stale?.close();
        connect();
      },
      send: (frame) => {
        if (socket?.readyState !== PartySocket.OPEN) {
          return false;
        }

        socket.send(frame);

        return true;
      },
    },
    watchPreference: {
      get: () => untrack(watchPreference),
      set: (watching) => {
        setWatchPreference(watching);
      },
    },
    token: {
      get: () => untrack(token),
      set: (next) => {
        setToken(next);

        if (next === null) {
          forgetRoom(tokenStorage, code);
        } else {
          rememberRoom(tokenStorage, code, Date.now());
        }
      },
    },
  });

  const [state, setState] = createSignal(client.state, { ownedWrite: true });
  client.subscribe((next) => {
    setState(next);
  });

  const connect = () => {
    const ws = new PartySocket({
      host: location.host,
      maxEnqueuedMessages: 0,
      minReconnectionDelay: RETRY_DELAY_MS,
      party: ROOM_PARTY,
      protocol: location.protocol === "https:" ? "wss" : "ws",
      room: code,
      shouldReconnectOnClose: ({ code: closeCode }) =>
        closeCode !== ROOM_REMOVED_CLOSE_CODE &&
        closeCode !== ROOM_MISSING_CLOSE_CODE,
    });

    socket = ws;
    makeSteadyHeartbeat(ws, HEARTBEAT, () => {
      if (ws === socket) {
        client.heartbeatMissed();
      }
    });

    ws.addEventListener("open", () => {
      if (ws === socket) {
        client.opened();
      }
    });
    ws.addEventListener("message", (event: MessageEvent<string>) => {
      if (ws !== socket || ws.readyState !== PartySocket.OPEN) {
        return;
      }

      const message = parseServerMessage(event.data);

      if (message) {
        client.received(message);
      }
    });
    ws.addEventListener("close", (event) => {
      if (ws === socket) {
        client.closed(event.code, ws.retryCount);
      }
    });
  };

  const reportBrowserState = () => {
    client.browserStateChanged({
      online: navigator.onLine,
      visible: document.visibilityState === "visible",
    });
  };

  onSettled(() => {
    reportBrowserState();
    window.addEventListener("online", reportBrowserState);
    window.addEventListener("offline", reportBrowserState);
    document.addEventListener("visibilitychange", reportBrowserState);
    connect();

    return () => {
      window.removeEventListener("online", reportBrowserState);
      window.removeEventListener("offline", reportBrowserState);
      document.removeEventListener("visibilitychange", reportBrowserState);
      client.stop();
    };
  });

  return {
    canAct: createMemo(() => state().canAct),
    chat: client.chat,
    clearJoinError: client.clearJoinError,
    join: (name: string, avatar: number) => {
      setSavedName(name);
      setSavedAvatar(avatar);
      client.join(name, avatar);
    },
    joinError: () => state().joinError,
    joining: () => state().joining,
    needsName: createMemo(() => state().needsName),
    notice: () => state().notice,
    online: createMemo(() => state().online),
    playerId: createMemo(() => state().playerId),
    room: createMemo(() => state().room),
    preview: createMemo(() => state().preview),
    retry: client.retry,
    returnToRoom: client.returnToRoom,
    savedAvatar,
    savedName,
    send: client.send,
    status: createMemo(() => state().status),
    typing: createMemo(() => state().typing),
    sendTyping: client.typing,
    stopWatching: client.stopWatching,
    syncId: createMemo(() => state().syncId),
    watch: client.watch,
    watchError: () => state().watchError,
    watchInstead: client.watchInstead,
    watchPending: () => state().watchPending,
    watching: createMemo(() => state().watching),
  };
};

export type RoomConnection = ReturnType<typeof createRoomConnection>;
