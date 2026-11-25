// oxlint-disable landmines-structure/colocated-tests -- This tests the Worker store; src/game only supplies the room fixture.
import { describe, expect, it, vi } from "vitest";

import { addPlayer, startGame } from "../src/game/engine";
import { newStoredRoom } from "../src/game/room";
import { createRoomStore } from "./room-store";
import type { RoomStorage } from "./room-store";

const NOW = 1_000_000;

const fakeStorage = (initial: { room?: unknown; alarm?: number } = {}) => {
  const writes: string[] = [];

  let room =
    initial.room === undefined ? undefined : structuredClone(initial.room);

  let alarm = initial.alarm ?? null;
  let failNext = false;

  const write = (label: string) => {
    if (failNext) {
      failNext = false;
      throw new Error("Storage unavailable");
    }

    writes.push(label);
  };

  const storage: RoomStorage = {
    deleteAll: async () => {
      await Promise.resolve();
      write("deleteAll");
      room = undefined;
      alarm = null;
    },
    get: async () => {
      await Promise.resolve();

      return room === undefined ? undefined : structuredClone(room);
    },
    getAlarm: async () => {
      await Promise.resolve();

      return alarm;
    },
    put: async (_key, value) => {
      await Promise.resolve();
      write("put");
      room = structuredClone(value);
    },
    setAlarm: async (scheduledTime) => {
      await Promise.resolve();
      write(`setAlarm ${scheduledTime}`);
      alarm = scheduledTime;
    },
  };

  return {
    failNextWrite: () => {
      failNext = true;
    },
    fireAlarm: () => {
      alarm = null;
    },
    storage,
    takeWrites: () => writes.splice(0),
  };
};

const loadedStore = async (room = newStoredRoom("ABCDE", NOW)) => {
  const fake = fakeStorage({ alarm: NOW + 500, room });
  const store = createRoomStore(fake.storage);
  const loaded = await store.load();

  if (!loaded) {
    throw new Error("Room didn't load");
  }

  return { ...fake, room: loaded, store };
};

describe(createRoomStore, () => {
  it("treats a room with invalid deal history as missing", async () => {
    using warn = vi.spyOn(console, "warn");
    const room = newStoredRoom("ABCDE", NOW);

    const fake = fakeStorage({
      room: { ...room, game: { ...room.game, dealHistory: null } },
      alarm: NOW + 500,
    });

    const store = createRoomStore(fake.storage);

    await expect(store.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      event: "stored_room_rejected",
      field: "game.dealHistory",
      validation: "array",
    });
    expect(fake.takeWrites()).toStrictEqual([]);

    await store.save(room, NOW + 500);

    await expect(createRoomStore(fake.storage).load()).resolves.toStrictEqual(
      room
    );
  });

  it("redacts record keys and values from rejection warnings", async () => {
    using warn = vi.spyOn(console, "warn");
    const room = newStoredRoom("ABCDE", NOW);

    const { storage } = fakeStorage({
      room: { ...room, tokens: { privatePlayerId: ["private token"] } },
    });

    await expect(createRoomStore(storage).load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      event: "stored_room_rejected",
      field: "tokens.*",
      validation: "string",
    });
  });

  it("restores an in-progress room with deal history and structured log entries", async () => {
    const room = newStoredRoom("ABCDE", NOW);
    addPlayer(room.game, "host", "Host", 1);
    addPlayer(room.game, "guest", "Guest", 2);
    startGame(room.game, "host", () => 0.5);

    const { storage } = fakeStorage({ room });

    expect(room.game.dealHistory.length).toBeGreaterThan(0);
    expect(room.game.log.length).toBeGreaterThan(0);
    await expect(createRoomStore(storage).load()).resolves.toStrictEqual(room);
  });

  it("writes nothing when the room and alarm haven't changed", async () => {
    const { room, store, takeWrites } = await loadedStore();

    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual([]);
  });

  it("saves a new room and sets its alarm", async () => {
    using warn = vi.spyOn(console, "warn");
    const fake = fakeStorage();
    const store = createRoomStore(fake.storage);

    await expect(store.load()).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();

    await store.save(newStoredRoom("ABCDE", NOW), NOW + 500);

    expect(fake.takeWrites()).toStrictEqual(["put", `setAlarm ${NOW + 500}`]);
  });

  it("saves the room without moving an unchanged alarm", async () => {
    const { room, store, takeWrites } = await loadedStore();

    room.lastActiveAt += 1;
    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual(["put"]);
  });

  it("moves the alarm without saving an unchanged room", async () => {
    const { room, store, takeWrites } = await loadedStore();

    await store.save(room, NOW + 900);

    expect(takeWrites()).toStrictEqual([`setAlarm ${NOW + 900}`]);
  });

  it("saves the room when a seat token changes", async () => {
    const { room, store, takeWrites } = await loadedStore();

    room.tokens.player = "token";
    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual(["put"]);
  });

  it("detects changes inside structured storage values", async () => {
    const { room, store, takeWrites } = await loadedStore();
    const metadata = new Map([["key", "original"]]);
    const roomWithMetadata = { ...room, metadata };
    await store.save(roomWithMetadata, NOW + 500);
    expect(takeWrites()).toStrictEqual(["put"]);

    metadata.set("key", "updated");
    await store.save(roomWithMetadata, NOW + 500);
    expect(takeWrites()).toStrictEqual(["put"]);

    await store.save(roomWithMetadata, NOW + 500);
    expect(takeWrites()).toStrictEqual([]);
  });

  it("sets the alarm again after it fires, even for the same time", async () => {
    const { fireAlarm, room, store, takeWrites } = await loadedStore();

    fireAlarm();
    await store.refreshAlarm();
    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual([`setAlarm ${NOW + 500}`]);
  });

  it("keeps the replacement alarm scheduled during startup on an alarm wake", async () => {
    const { fireAlarm, room, store, takeWrites } = await loadedStore();

    fireAlarm();
    await store.save(room, NOW + 900);
    await store.refreshAlarm();
    await store.save(room, NOW + 900);

    expect(takeWrites()).toStrictEqual([`setAlarm ${NOW + 900}`]);
  });

  it("retries writes after one fails", async () => {
    const { failNextWrite, room, store, takeWrites } = await loadedStore();

    room.lastActiveAt += 1;
    failNextWrite();
    await expect(store.save(room, NOW + 500)).rejects.toThrow(
      "Storage unavailable"
    );
    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual(["put"]);
  });

  it("writes the room and alarm again after clearing", async () => {
    const { room, store, takeWrites } = await loadedStore();

    await store.clear();
    await store.save(room, NOW + 500);

    expect(takeWrites()).toStrictEqual([
      "deleteAll",
      "put",
      `setAlarm ${NOW + 500}`,
    ]);
  });
});
