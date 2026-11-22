import { projectActionCards } from "./action-card-resolution";
import { fallbackAvatar } from "./avatars";
import { TARGET_SCORE } from "./engine";
import type { DrawEvent, GameState, HeldCard, Player } from "./engine";

export const NAME_MAX_LENGTH = 20;
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";

/** How often a client pings the room to show it's still there. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** A socket that hasn't pinged for this long is treated as gone. */
export const HEARTBEAT_STALE_MS = 25_000;
export const ROOM_REMOVED_CLOSE_CODE = 4001;
export const ROOM_PARTY = "game-room";

export const CODE_LENGTH = 5;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`, "u");

export const normalizeCode = (raw: string) => {
  const code = raw.trim().toUpperCase();

  return CODE_PATTERN.test(code) ? code : null;
};

export const cleanName = (raw: string) =>
  raw.replaceAll(/\s+/gu, " ").trim().slice(0, NAME_MAX_LENGTH);

export type PlayerView = Omit<Player, "avatar"> & {
  /** The person's avatar, or null for a bot. */
  avatar: number | null;
};

export interface RoomView extends Pick<
  GameState,
  | "choice"
  | "drawSeq"
  | "hostId"
  | "log"
  | "phase"
  | "round"
  | "turnId"
  | "winnerIds"
> {
  code: string;
  dealerId: string | null;
  deckCount: number;
  discardCount: number;
  draws: DrawEvent[];
  /** Flip Threes still under way, waiting on a choice. */
  flips: { targetId: string; remaining: number }[];
  held: HeldCard[];
  players: PlayerView[];
  targetScore: number;
}

/** A round was dealt between two views of the room: the game started, or the next round began. */
export const roundStarted = (previous: RoomView, current: RoomView) =>
  current.phase !== "lobby" &&
  (previous.phase === "lobby" || current.round !== previous.round);

export type ServerMessage =
  | {
      lastRequestId?: string;
      playerId: string;
      token: string;
      type: "welcome";
    }
  | { requestId: string; type: "accepted" }
  | { message: string; requestId: string; type: "rejected" }
  | { room: RoomView; type: "state" }
  | { message: string; type: "error" };

export const toRoomView = (code: string, state: GameState) => {
  const { choice, flips, held } = projectActionCards(state);

  const view: RoomView = {
    choice,
    code,
    dealerId:
      state.phase === "lobby"
        ? null
        : (state.players[state.dealerIndex]?.id ?? null),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    draws: state.draws ?? [],
    drawSeq: state.drawSeq ?? 0,
    flips,
    held,
    hostId: state.hostId,
    log: state.log,
    phase: state.phase,
    players: state.players.map((player) => ({
      avatar:
        player.bot === true
          ? null
          : (player.avatar ?? fallbackAvatar(player.id)),
      bot: player.bot === true,
      bustCard: player.bustCard,
      connected: player.connected,
      hand: player.hand,
      id: player.id,
      lastRound: player.lastRound,
      name: player.name,
      score: player.score,
      status: player.status,
    })),
    round: state.round,
    targetScore: TARGET_SCORE,
    turnId: state.turnId,
    winnerIds: state.winnerIds,
  };

  return view;
};

export const parseServerMessage = (raw: string) => {
  try {
    // SAFETY: The room Worker serializes only typed ServerMessage values.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The Worker and browser share the wire type.
    const message = JSON.parse(raw) as ServerMessage | null;

    return message?.type === undefined ? null : message;
  } catch {
    return null;
  }
};
