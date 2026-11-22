import type { Random } from "./cards";

/** How many avatars a player can pick from, numbered from 1. */
export const AVATAR_COUNT = 25;

export const AVATARS = Array.from(
  { length: AVATAR_COUNT },
  (_, index) => index + 1
);

export const isAvatar = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= AVATAR_COUNT;

export const randomAvatar = (random: Random) =>
  1 + Math.floor(random() * AVATAR_COUNT);

/** A stable avatar for a player saved before players picked one. */
export const fallbackAvatar = (playerId: string) => {
  let hash = 0;

  for (const char of playerId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  }

  return 1 + (hash % AVATAR_COUNT);
};

export const avatarSrc = (avatar: number) => `/avatars/${avatar}.svg`;
