import { isDeepStrictEqual } from "node:util";

import { getDotPath, safeParse } from "valibot";

import type { StoredRoom } from "../src/game/room";
import { StoredRoomSchema } from "./stored-room-schema";

const ROOM_KEY = "room";

/** The part of Durable Object storage the room uses. */
export interface RoomStorage {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Storage values are untrusted until load parses them.
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: StoredRoom) => Promise<void>;
  deleteAll: () => Promise<void>;
  getAlarm: () => Promise<number | null>;
  setAlarm: (scheduledTime: number) => Promise<void>;
}

/**
 * Saves the room and its alarm, skipping writes that wouldn't change what's
 * stored. Durable Objects bill every `put` and `setAlarm` as a row written,
 * and most heartbeat alarms change nothing.
 */
export const createRoomStore = (storage: RoomStorage) => {
  let savedSnapshot: StoredRoom | null = null;
  let pendingAlarm: number | null = null;

  return {
    async load() {
      const [record, alarm] = await Promise.all([
        storage.get(ROOM_KEY),
        storage.getAlarm(),
      ]);

      pendingAlarm = alarm;

      const result = safeParse(StoredRoomSchema, record, { abortEarly: true });

      if (!result.success) {
        if (record !== undefined) {
          const [issue] = result.issues;

          const [root, child] = issue.path ?? [];
          const recordKey = root?.key;

          const field =
            child && (recordKey === "tokens" || recordKey === "lastRequests")
              ? `${recordKey}.*`
              : getDotPath(issue);

          console.warn({
            event: "stored_room_rejected",
            field: field ?? "room",
            validation: issue.type,
          });

          await storage.deleteAll();
          pendingAlarm = null;
        }

        savedSnapshot = null;

        return null;
      }

      savedSnapshot = structuredClone(result.output);

      return result.output;
    },

    async refreshAlarm() {
      pendingAlarm = await storage.getAlarm();
    },

    async save(room: StoredRoom, alarmAt: number) {
      const writes: Promise<void>[] = [];
      let snapshot = savedSnapshot;

      if (!isDeepStrictEqual(room, savedSnapshot)) {
        snapshot = structuredClone(room);
        writes.push(storage.put(ROOM_KEY, snapshot));
      }

      if (alarmAt !== pendingAlarm) {
        writes.push(storage.setAlarm(alarmAt));
      }

      await Promise.all(writes);
      savedSnapshot = snapshot;
      pendingAlarm = alarmAt;
    },

    async clear() {
      await storage.deleteAll();
      savedSnapshot = null;
      pendingAlarm = null;
    },
  };
};
