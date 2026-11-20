import type { Random } from "./cards";
import {
  blockingPlayerId,
  findPlayer,
  playForAbsent,
  transferHost,
} from "./engine";
import type { GameState } from "./engine";

export const HOST_GRACE_MS = 20_000;
export const ABSENT_GRACE_MS = 30_000;
export const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface Stall {
  playerId: string;
  since: number;
}

export interface RoomTimers {
  game: GameState;
  lastActiveAt: number;
  hostLeftAt: number | null;
  /** Missing on rooms saved before offline players were auto-played. */
  stall?: Stall | null;
}

const offlineWhileOthersOnline = (game: GameState, id: string | null) => {
  const player = id === null ? undefined : findPlayer(game, id);

  if (!player || player.connected) {
    return false;
  }

  return game.players.some((other) => other.connected && other.id !== id);
};

/**
 * Starts or clears the grace clocks to match the room. A clock only runs while
 * someone else is online, so an abandoned room doesn't hand off the host or
 * play itself out with nobody watching.
 */
export const syncTimers = (room: RoomTimers, now: number) => {
  const { game } = room;

  if (offlineWhileOthersOnline(game, game.hostId)) {
    room.hostLeftAt ??= now;
  } else {
    room.hostLeftAt = null;
  }

  const blockerId = blockingPlayerId(game);

  if (blockerId === null || !offlineWhileOthersOnline(game, blockerId)) {
    room.stall = null;
  } else if (room.stall?.playerId !== blockerId) {
    room.stall = { playerId: blockerId, since: now };
  }
};

export const nextAlarmAt = (room: RoomTimers) => {
  const deadlines = [room.lastActiveAt + IDLE_EXPIRY_MS];

  if (room.hostLeftAt !== null) {
    deadlines.push(room.hostLeftAt + HOST_GRACE_MS);
  }

  if (room.stall) {
    deadlines.push(room.stall.since + ABSENT_GRACE_MS);
  }

  return Math.min(...deadlines);
};

/**
 * Runs whatever is due. Every due clock is cleared or pushed forward, so the
 * alarm that follows is always in the future and can't fire in a loop.
 */
export const runTimers = (
  room: RoomTimers,
  now: number,
  random: Random,
  hasSockets: boolean
) => {
  let changed = false;

  if (room.hostLeftAt !== null && now - room.hostLeftAt >= HOST_GRACE_MS) {
    room.hostLeftAt = null;
    changed = transferHost(room.game) || changed;
  }

  if (room.stall && now - room.stall.since >= ABSENT_GRACE_MS) {
    room.stall = null;
    changed = playForAbsent(room.game, random) || changed;
  }

  const idle = now - room.lastActiveAt >= IDLE_EXPIRY_MS;

  if (idle && hasSockets) {
    room.lastActiveAt = now;
  }

  return { changed, expired: idle && !hasSockets };
};
