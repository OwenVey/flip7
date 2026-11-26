import { createEffect, createMemo, createSignal } from "solid-js";

import type { LogEntry, LogPlayer } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { createChatLogReads } from "./chat-log-reads";
import type { ChatControls } from "./room-connection";

interface RoomChatLogSource {
  log: () => LogEntry[];
  reactions: () => Pick<RoomView, "myReactions" | "reactionCounts">;
  players: () => readonly LogPlayer[];
  playerId: () => string | null;
  chat: ChatControls;
  /** Other players typing a chat message, by player ID. */
  typing: () => readonly string[];
  /** The layout puts Chat & Log in a sheet instead of beside the page. */
  inSheet: () => boolean;
  /** The round whose results the table shows, once Deal playback lets them show. */
  resultsRound: () => number | null;
  /** The room's current round, 0 in the lobby. Its log stays unfolded until the next round starts. */
  round: () => number;
}

/**
 * The room's Chat & Log for one viewer: the draft, one read state, and
 * whether its sheet is open. Create it once per Room so the draft and unread
 * position carry over from the lobby to the table and between layouts. The
 * sheet makes way for Scores when a round's results show, and reopens only if
 * the viewer opens it during them.
 */
export const createRoomChatLog = (source: RoomChatLogSource) => {
  const [openedAt, setOpenedAt] = createSignal<number | null>();

  const sheetResultsRound = createMemo(() =>
    source.inSheet() ? source.resultsRound() : null
  );

  const sheetOpen = () => {
    const at = openedAt();
    const round = sheetResultsRound();

    return (
      source.inSheet() && at !== undefined && (round === null || at === round)
    );
  };

  createEffect(
    () => ({ inSheet: source.inSheet(), round: sheetResultsRound() }),
    ({ inSheet, round }, previous) => {
      if ((!inSheet && previous?.inSheet === true) || round !== null) {
        setOpenedAt(undefined);
      }
    }
  );

  const reads = createChatLogReads({
    log: source.log,
    playerId: source.playerId,
    shown: () => !source.inSheet() || sheetOpen(),
  });

  return {
    chat: () => (source.playerId() === null ? undefined : source.chat),
    draft: createSignal(""),
    inSheet: source.inSheet,
    players: source.players,
    reads,
    reactions: source.reactions,
    round: source.round,
    setSheetOpen: (next: boolean) => {
      setOpenedAt(next && source.inSheet() ? sheetResultsRound() : undefined);
    },
    sheetOpen,
    typing: source.typing,
  };
};

export type RoomChatLog = ReturnType<typeof createRoomChatLog>;
