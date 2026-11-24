import MessageCircle from "@lucide/solid/icons/message-circle";
import { createSignal, Show, untrack } from "solid-js";

import type { LogEntry } from "../game/engine";
import { countChatsAfter } from "../lib/game-log-entries";
import GameLog, { CHAT_AND_GAME_LOG_TITLE } from "./game-log";
import TableSheet from "./table-sheet";

/** Chat & Log as a sheet from the header, with an unread count, for screens without room for the log beside the page. */
export default function ChatSheet(props: {
  log: LogEntry[];
  playerId: string | null;
  onChat?: ((text: string) => boolean) | undefined;
  /** Set with `onOpenChange` when the page also needs to close the sheet. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = createSignal(false);
  const open = () => props.open ?? ownOpen();
  const latestLogId = () => props.log.at(-1)?.id ?? 0;
  const [seenLogId, setSeenLogId] = createSignal(untrack(latestLogId));

  const unreadChats = () =>
    open() ? 0 : countChatsAfter(props.log, props.playerId, seenLogId());

  const triggerLabel = () => {
    const unread = unreadChats();

    return unread > 0
      ? `${CHAT_AND_GAME_LOG_TITLE}, ${unread} new ${unread === 1 ? "message" : "messages"}`
      : CHAT_AND_GAME_LOG_TITLE;
  };

  return (
    <TableSheet
      title={CHAT_AND_GAME_LOG_TITLE}
      triggerLabel={triggerLabel()}
      shortLabel="Chat"
      keepMounted
      open={open()}
      onOpenChange={(next) => {
        setSeenLogId(latestLogId());
        setOwnOpen(next);
        props.onOpenChange?.(next);
      }}
      trigger={
        <>
          <MessageCircle size={16} aria-hidden="true" />
          <Show when={unreadChats() > 0}>
            <span class="unread-count" aria-hidden="true">
              {unreadChats()}
            </span>
          </Show>
        </>
      }
    >
      <GameLog
        inSheet
        log={props.log}
        playerId={props.playerId}
        onChat={props.onChat}
      />
    </TableSheet>
  );
}
