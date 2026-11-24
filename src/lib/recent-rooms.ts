import * as v from "valibot";

import { normalizeCode } from "../game/protocol";

export const NAME_KEY = "flip7:name";
export const AVATAR_KEY = "flip7:avatar";

const TOKEN_PREFIX = "flip7:token:";
const RECENT_KEY = "flip7:recent";
const RECENT_LIMIT = 5;

export const tokenKey = (code: string) => `${TOKEN_PREFIX}${code}`;

/** A room this browser holds a seat in. */
export interface RecentRoom {
  code: string;
  joinedAt: number;
}

/** The part of `Storage` that saving a room needs, which the in-memory fallback also has. */
type ItemStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const RecentTimesSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.record(v.string(), v.number())
);

const readTimes = (storage: ItemStorage) => {
  const result = v.safeParse(
    RecentTimesSchema,
    storage.getItem(RECENT_KEY) ?? "{}"
  );

  return result.success ? result.output : {};
};

const writeTimes = (storage: ItemStorage, times: Record<string, number>) => {
  const newest = Object.entries(times)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, RECENT_LIMIT);

  storage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(newest)));
};

const savedSeatCodes = (storage: Storage) => {
  const codes: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? "";

    const code = key.startsWith(TOKEN_PREFIX)
      ? normalizeCode(key.slice(TOKEN_PREFIX.length))
      : null;

    if (code !== null && (storage.getItem(key) ?? "") !== "") {
      codes.push(code);
    }
  }

  return codes;
};

/** Rooms with a saved rejoin token and join time, most recently joined first. */
export const readRecentRooms = (storage: Storage) => {
  const times = readTimes(storage);

  return savedSeatCodes(storage)
    .flatMap((code) => {
      const joinedAt = times[code];

      return joinedAt === undefined
        ? []
        : [{ code, joinedAt } satisfies RecentRoom];
    })
    .toSorted((a, b) => b.joinedAt - a.joinedAt);
};

export const rememberRoom = (
  storage: ItemStorage,
  code: string,
  now: number
) => {
  writeTimes(storage, { ...readTimes(storage), [code]: now });
};

/** Drops the room's join time and rejoin token, for a room that is gone or a seat that was lost. */
export const forgetRoom = (storage: ItemStorage, code: string) => {
  const { [code]: _forgotten, ...rest } = readTimes(storage);

  writeTimes(storage, rest);
  storage.removeItem(tokenKey(code));
};
