import { TARGET_SCORE } from "./engine";
import type { GameState, Player } from "./engine";

export const NAME_MAX_LENGTH = 20;
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";
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
  players: PlayerView[];
  targetScore: number;
}

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
  | { message: string; type: "error" }
  | { reason: "kicked" | "left"; type: "removed" };

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
    drawSeq: state.drawSeq ?? 0,
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
