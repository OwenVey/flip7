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

/**
 * Picks an avatar from a random number in [0, 1), preferring one nobody has
 * yet. It walks on from the seeded avatar, so a pick only moves when someone
 * takes that avatar.
 */
export const pickAvatar = (seed: number, taken: Iterable<number> = []) => {
  const start = Math.floor(seed * AVATAR_COUNT);
  const used = new Set(taken);

  for (let step = 0; step < AVATAR_COUNT; step += 1) {
    const avatar = ((start + step) % AVATAR_COUNT) + 1;

    if (!used.has(avatar)) {
      return avatar;
    }
  }

  return start + 1;
};

/** A stable avatar for a player saved before players picked one. */
export const fallbackAvatar = (playerId: string) => {
  let hash = 0;

  for (const char of playerId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  }

  return 1 + (hash % AVATAR_COUNT);
};

/** Reads an avatar saved in browser storage, or null if it isn't one. */
export const parseSavedAvatar = (data: string) => {
  const avatar = Number(data);

  return isAvatar(avatar) ? avatar : null;
};

interface AvatarHolder {
  id: string;
  bot?: boolean;
  avatar?: number;
}

/** The avatar a player shows, or null for a bot. */
export const avatarOf = (player: AvatarHolder) =>
  player.bot === true ? null : (player.avatar ?? fallbackAvatar(player.id));

export const takenAvatars = (players: readonly AvatarHolder[]) =>
  players.flatMap((player) => avatarOf(player) ?? []);
