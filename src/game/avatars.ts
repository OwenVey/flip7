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

/** Reads an avatar saved in browser storage, or null if it isn't one. */
export const parseSavedAvatar = (data: string) => {
  const avatar = Number(data);

  return isAvatar(avatar) ? avatar : null;
};

/** The avatars people in the room have picked. Bots have none. */
export const takenAvatars = (players: readonly { avatar: number | null }[]) =>
  players.flatMap((player) => player.avatar ?? []);
