import type { Random } from "./cards";
import { findPlayer, playForAbsent, playForBot, transferHost } from "./engine";
import type { GameState } from "./engine";
import { waitingOn } from "./moves";
import { HEARTBEAT_STALE_MS } from "./protocol";

export const HOST_GRACE_MS = 20_000;
export const ABSENT_GRACE_MS = 30_000;
export const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** How long a bot waits before its move. */
export const BOT_DELAY_MS = 500;

export interface Stall {
  playerId: string;
  since: number;
}

export interface BotTurn {
  playerId: string;
  at: number;
}

export interface RoomTimers {
  game: GameState;
  /** When the bot the game is waiting on makes its move. Missing on rooms saved before bots. */
  botTurn?: BotTurn | null;
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

  return game.players.some(
    (other) => other.connected && other.bot !== true && other.id !== id
  );
};

const humanOnline = (game: GameState) =>
  game.players.some((player) => player.connected && player.bot !== true);

const syncBotTurn = (
  room: RoomTimers,
  blockerId: string | null,
  now: number
) => {
  const { game } = room;
  const bot = blockerId === null ? undefined : findPlayer(game, blockerId);

  if (bot?.bot !== true || !humanOnline(game)) {
    room.botTurn = null;
  } else if (room.botTurn?.playerId !== bot.id) {
    room.botTurn = { at: now + BOT_DELAY_MS, playerId: bot.id };
  }
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

  const blockerId = waitingOn(game)?.playerId ?? null;

  if (blockerId === null || !offlineWhileOthersOnline(game, blockerId)) {
    room.stall = null;
  } else if (room.stall?.playerId !== blockerId) {
    room.stall = { playerId: blockerId, since: now };
  }

  syncBotTurn(room, blockerId, now);
};

export const heartbeatDeadline = (seatedAt: number, lastPing: Date | null) =>
  Math.max(seatedAt, lastPing?.getTime() ?? 0) + HEARTBEAT_STALE_MS;

export const nextAlarmAt = (
  room: RoomTimers,
  heartbeatDeadlines: Iterable<number> = []
) => {
  const deadlines = [room.lastActiveAt + IDLE_EXPIRY_MS];

  if (room.hostLeftAt !== null) {
    deadlines.push(room.hostLeftAt + HOST_GRACE_MS);
  }

  if (room.stall) {
    deadlines.push(room.stall.since + ABSENT_GRACE_MS);
  }

  if (room.botTurn) {
    deadlines.push(room.botTurn.at);
  }

  let next = Math.min(...deadlines);

  for (const deadline of heartbeatDeadlines) {
    next = Math.min(next, deadline);
  }

  return next;
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

  if (room.botTurn && now >= room.botTurn.at) {
    room.botTurn = null;
    changed = playForBot(room.game, random) || changed;
  }

  const idle = now - room.lastActiveAt >= IDLE_EXPIRY_MS;

  if (idle && hasSockets) {
    room.lastActiveAt = now;
  }

  return { changed, expired: idle && !hasSockets };
};
