import type { StoredRoom } from "../src/game/room";

const ROOM_KEY = "room";

/** The part of Durable Object storage the room uses. */
export interface RoomStorage {
  get: (key: string) => Promise<StoredRoom | undefined>;
  put: (key: string, value: StoredRoom) => Promise<void>;
  deleteAll: () => Promise<void>;
  getAlarm: () => Promise<number | null>;
  setAlarm: (scheduledTime: number) => Promise<void>;
}

const snapshotOf = (room: StoredRoom) => JSON.stringify(room);

/**
 * Saves the room and its alarm, skipping writes that wouldn't change what's
 * stored. Durable Objects bill every `put` and `setAlarm` as a row written,
 * and most heartbeat alarms change nothing.
 */
export const createRoomStore = (storage: RoomStorage) => {
  let savedSnapshot: string | null = null;
  let pendingAlarm: number | null = null;

  return {
    async load() {
      const [room, alarm] = await Promise.all([
        storage.get(ROOM_KEY),
        storage.getAlarm(),
      ]);

      savedSnapshot = room ? snapshotOf(room) : null;
      pendingAlarm = alarm;

      return room ?? null;
    },

    alarmFired() {
      pendingAlarm = null;
    },

    async save(room: StoredRoom, alarmAt: number) {
      const snapshot = snapshotOf(room);
      const writes: Promise<void>[] = [];

      if (snapshot !== savedSnapshot) {
        writes.push(storage.put(ROOM_KEY, room));
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
