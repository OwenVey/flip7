import type { RoomView } from "../game/protocol";
import type { DealStep } from "../lib/deal-plan";
import type { DealPlaybackView } from "../lib/deal-playback";
import type { RoomConnection } from "../lib/room-connection";

export const SCORES_TITLE = "Scores";
export const ROUND_COUNT_MS = 320;

export interface TableProps {
  room: RoomView;
  playerId: string | null;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
  /**
   * The room can't hear this player. Blocks only Leave and Remove, which stay
   * open during the deal and while a move waits for the room.
   */
  offline?: boolean;
}

export interface DealProps {
  /** True while cards are still flying from the deck. */
  dealing?: boolean;
  /** The card being dealt, and where it's going. */
  dealStep?: DealStep | null;
}

export type RoundPointsByPlayer = Pick<DealPlaybackView, "roundPoints">;

export const samePlayerIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
