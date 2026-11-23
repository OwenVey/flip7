import { afterEach, describe, expect, it } from "vitest";

import {
  forgetRoom,
  readRecentRooms,
  rememberRoom,
  tokenKey,
} from "./recent-rooms";

const seat = (code: string) => {
  localStorage.setItem(tokenKey(code), `token-${code}`);
};

describe(readRecentRooms, () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("lists rooms with a saved token, newest join first", () => {
    seat("ABCDE");
    seat("FGHJK");
    rememberRoom(localStorage, "ABCDE", 1000);
    rememberRoom(localStorage, "FGHJK", 2000);

    expect(readRecentRooms(localStorage)).toStrictEqual([
      { code: "FGHJK", joinedAt: 2000 },
      { code: "ABCDE", joinedAt: 1000 },
    ]);
  });

  it("keeps seats saved before join times, after the timed ones", () => {
    seat("ABCDE");
    seat("FGHJK");
    rememberRoom(localStorage, "FGHJK", 2000);

    expect(readRecentRooms(localStorage)).toStrictEqual([
      { code: "FGHJK", joinedAt: 2000 },
      { code: "ABCDE", joinedAt: null },
    ]);
  });

  it("skips join times whose token is gone and ignores corrupt data", () => {
    rememberRoom(localStorage, "ABCDE", 1000);
    expect(readRecentRooms(localStorage)).toStrictEqual([]);

    seat("ABCDE");
    localStorage.setItem("flip7:recent", "not json");
    expect(readRecentRooms(localStorage)).toStrictEqual([
      { code: "ABCDE", joinedAt: null },
    ]);
  });

  it("forgets a room's join time and token together", () => {
    seat("ABCDE");
    rememberRoom(localStorage, "ABCDE", 1000);
    forgetRoom(localStorage, "ABCDE");

    expect(localStorage.getItem(tokenKey("ABCDE"))).toBeNull();
    expect(readRecentRooms(localStorage)).toStrictEqual([]);
  });
});
