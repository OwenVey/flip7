import { describe, expect, it } from "vitest";

import {
  AVATAR_COUNT,
  AVATARS,
  avatarOf,
  fallbackAvatar,
  parseSavedAvatar,
  pickAvatar,
  takenAvatars,
} from "./avatars";

describe(pickAvatar, () => {
  it("picks the seeded avatar when nobody has it", () => {
    expect(pickAvatar(0)).toBe(1);
    expect(pickAvatar(0.5)).toBe(13);
    expect(pickAvatar(0.999)).toBe(AVATAR_COUNT);
  });

  it("moves on past avatars that are taken, wrapping at the end", () => {
    expect(pickAvatar(0.5, [13, 14])).toBe(15);
    expect(pickAvatar(0.999, [AVATAR_COUNT])).toBe(1);
  });

  it("keeps its pick when someone takes a different avatar", () => {
    expect(pickAvatar(0.5, [2, 20])).toBe(pickAvatar(0.5));
  });

  it("falls back to the seeded avatar when every one is taken", () => {
    expect(pickAvatar(0.5, AVATARS)).toBe(13);
  });
});

describe(fallbackAvatar, () => {
  it("gives the same avatar for the same player id", () => {
    expect(fallbackAvatar("player-1")).toBe(fallbackAvatar("player-1"));
    expect(AVATARS).toContain(fallbackAvatar("player-1"));
  });
});

describe(parseSavedAvatar, () => {
  it("reads a saved avatar", () => {
    expect(parseSavedAvatar("7")).toBe(7);
  });

  it.each(["", "0", "26", "2.5", "seven"])(
    "ignores the corrupted value %j",
    (saved) => {
      expect(parseSavedAvatar(saved)).toBeNull();
    }
  );
});

describe(takenAvatars, () => {
  it("lists people's avatars, using the fallback for older players and skipping bots", () => {
    expect(avatarOf({ bot: true, id: "bot" })).toBeNull();
    expect(
      takenAvatars([
        { avatar: 4, id: "ana" },
        { id: "old" },
        { bot: true, id: "bot" },
      ])
    ).toStrictEqual([4, fallbackAvatar("old")]);
  });
});
