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

export type PlayerView = Player;

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

const heldCards = (state: GameState) => {
  const assignment = state.assignment ?? null;

  const held: HeldCard[] = state.flipRuns.flatMap((run) =>
    run.deferred.map((card) => ({ card, ownerId: run.targetId }))
  );

  if (assignment) {
    for (const card of assignment.cards) {
      if (card.id !== state.choice?.card.id) {
        held.push({ card, ownerId: assignment.chooserId });
      }
    }

    for (const { card, ownerId, targetId } of assignment.assigned) {
      held.push({ card, ownerId: targetId ?? ownerId });
    }
  }

  for (const { card, ownerId, targetId } of state.actionQueue) {
    held.push({ card, ownerId: targetId ?? ownerId });
  }

  return held;
};

export const toRoomView = (code: string, state: GameState) => {
  const view: RoomView = {
    choice: state.choice,
    code,
    dealerId:
      state.phase === "lobby"
        ? null
        : (state.players[state.dealerIndex]?.id ?? null),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    draws: state.draws ?? [],
    drawSeq: state.drawSeq ?? 0,
    flips: state.flipRuns.map(({ remaining, targetId }) => ({
      remaining,
      targetId,
    })),
    held: heldCards(state),
    hostId: state.hostId,
    log: state.log,
    phase: state.phase,
    players: state.players.map((player) => ({
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
