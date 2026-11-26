import { createSignal, onSettled } from "solid-js";

import type { RoomView } from "../game/protocol";
import type { DealPlaybackView } from "../lib/deal-playback";
import type { RoomConnection } from "../lib/room-connection";

export const SCORES_TITLE = "Scores";
export const ROUND_COUNT_MS = 320;
export const SHEET_TABLE_QUERY = "(width < 64rem), (height <= 30rem)";

/** Tracks `--sheet-table` after mount so Chat & Log mounts in one place per layout. */
export const createSheetTable = () => {
  const [sheetTable, setSheetTable] = createSignal(false);

  onSettled(() => {
    const query = globalThis.matchMedia?.(SHEET_TABLE_QUERY);

    const sync = () => {
      setSheetTable(query?.matches ?? false);
    };

    sync();
    query?.addEventListener?.("change", sync);

    return () => {
      query?.removeEventListener?.("change", sync);
    };
  });

  return sheetTable;
};

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

export type RoundPointsByPlayer = Pick<DealPlaybackView, "roundPoints">;

export const samePlayerIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
