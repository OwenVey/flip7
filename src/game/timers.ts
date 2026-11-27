import type { Random } from "./cards";
import { findPlayer, playForAbsent, playForBot, handOffHost } from "./engine";
import type { GameState } from "./engine";
import { waitingOn } from "./moves";
import { isOnlineHuman } from "./player";
import { HEARTBEAT_STALE_MS } from "./protocol";

export const HOST_GRACE_MS = 20_000;
export const ABSENT_GRACE_MS = 30_000;
export const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** How long a bot waits before its move. */
export const BOT_DELAY_MS = 500;

/** How long a bot waits when the host has sped bots up. */
export const FAST_BOT_DELAY_MS = 200;

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
  /** When the bot the game is waiting on makes its move. */
  botTurn: BotTurn | null;
  lastActiveAt: number;
  hostLeftAt: number | null;
  /** The offline player the game is waiting on, and since when. */
  stall: Stall | null;
}

const syncBotTurn = (
  room: RoomTimers,
  waitingOnId: string | undefined,
  now: number
) => {
  const { game } = room;

  const bot =
    waitingOnId === undefined ? undefined : findPlayer(game, waitingOnId);

  if (bot?.bot !== true) {
    room.botTurn = null;
  } else if (room.botTurn?.playerId !== bot.id) {
    const delay =
      game.settings.botSpeed === "fast" ? FAST_BOT_DELAY_MS : BOT_DELAY_MS;

    room.botTurn = { at: now + delay, playerId: bot.id };
  }
};

/**
 * Starts or clears the grace clocks based on player presence. Spectators keep
 * the room open without starting a bot move, stall clock, or host handoff.
 */
export const syncTimers = (room: RoomTimers, now: number) => {
  const { game } = room;
  const hasOnlineHuman = game.players.some(isOnlineHuman);
  const host = game.hostId === null ? undefined : findPlayer(game, game.hostId);

  if (hasOnlineHuman && host?.connected === false) {
    room.hostLeftAt ??= now;
  } else {
    room.hostLeftAt = null;
  }

  const waiting = waitingOn(game);

  if (!hasOnlineHuman || waiting?.offline !== true) {
    room.stall = null;
  } else if (room.stall?.playerId !== waiting.playerId) {
    room.stall = { playerId: waiting.playerId, since: now };
  }

  syncBotTurn(room, hasOnlineHuman ? waiting?.playerId : undefined, now);
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
    changed = handOffHost(room.game) || changed;
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
