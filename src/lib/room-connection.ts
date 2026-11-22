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

import { isAvatar, randomAvatar } from "../game/avatars";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING,
  parseServerMessage,
  ROOM_PARTY,
  ROOM_REMOVED_CLOSE_CODE,
} from "../game/protocol";
import { makeSteadyHeartbeat } from "./heartbeat";
import { createRoomClient } from "./room-client";
import { roomExists } from "./room-functions";

export type { ConnectionStatus, Notice } from "./room-client";

const RETRY_DELAY_MS = 1500;

const HEARTBEAT = {
  interval: HEARTBEAT_INTERVAL_MS,
  message: HEARTBEAT_PING,
  wait: 5000,
};

const NAME_KEY = "hot-streak:name";
const AVATAR_KEY = "hot-streak:avatar";
const STORAGE_PROBE = "hot-streak:probe";

const FRESH_PARAM = "fresh";

const tokenKey = (code: string) => `hot-streak:token:${code}`;

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
    createSignal(randomAvatar(Math.random), { ownedWrite: true }),
    {
      deserialize: (data: string) => {
        const avatar = Number(data);

        return isAvatar(avatar) ? avatar : randomAvatar(Math.random);
      },
      name: AVATAR_KEY,
      serialize: String,
      storage: usableStorage(() => localStorage),
    }
  );

  const [token, setToken] = makePersisted(
    createSignal<string | null>(null, { ownedWrite: true }),
    {
      ...plainText,
      name: tokenKey(code),
      storage: usableStorage(pickTokenStorage),
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
      send: (frame) => {
        if (socket?.readyState !== PartySocket.OPEN) {
          return false;
        }

        socket.send(frame);

        return true;
      },
    },
    token: {
      get: () => untrack(token),
      set: (next) => {
        setToken(next);
      },
    },
  });

  const [state, setState] = createSignal(client.state, { ownedWrite: true });
  client.subscribe((next) => {
    setState(next);
  });
  const owner = getOwner();

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

  const watchConnectivity = () => {
    makeConnectivityListener((isOnline) => {
      client.setOnline(isOnline);
    });
    const visible = usePageVisibility();
    createEffect(
      () => state().online && visible(),
      (back) => {
        if (back) {
          client.resume();
        }
      }
    );
  };

  // WARNING: browser-only primitives add owners the server render lacks, so start them after hydration.
  onSettled(() => {
    client.setOnline(navigator.onLine);
    runWithOwner(owner, watchConnectivity);
    connect();

    return () => {
      client.stop();
    };
  });

  return {
    canAct: () => state().canAct,
    chat: client.chat,
    clearJoinError: client.clearJoinError,
    join: (name: string, avatar: number) => {
      setSavedName(name);
      setSavedAvatar(avatar);
      client.join(name, avatar);
    },
    joinError: () => state().joinError,
    joining: () => state().joining,
    needsName: () => state().needsName,
    notice: () => state().notice,
    online: () => state().online,
    playerId: () => state().playerId,
    room: () => state().room,
    savedAvatar,
    savedName,
    send: client.send,
    status: () => state().status,
  };
};

export type RoomConnection = ReturnType<typeof createRoomConnection>;
