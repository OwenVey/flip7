import { createSheetTable } from "../components/table-common";
import type { RoomView } from "../game/protocol";
import { createRoomChatLog } from "../lib/room-chat-log";
import type { ChatControls } from "../lib/room-connection";

/** Props a screen test passes in place of a Chat & Log the room route would create. */
export interface ChatLogTestProps {
  room: RoomView;
  playerId: string | null;
  chat: ChatControls;
  typing: readonly string[];
  dealing?: boolean;
}

/** The room's Chat & Log for a screen rendered on its own, with the layout read from `matchMedia`. */
export const chatLogFor = (props: ChatLogTestProps) =>
  createRoomChatLog({
    chat: props.chat,
    inSheet: createSheetTable(),
    log: () => props.room.log,
    playerId: () => props.playerId,
    players: () => props.room.players,
    resultsRound: () =>
      props.room.phase === "roundOver" && props.dealing !== true
        ? props.room.round
        : null,
    typing: () => props.typing,
  });
