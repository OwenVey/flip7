import MessageCircle from "@lucide/solid/icons/message-circle";
import X from "@lucide/solid/icons/x";
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/solid/drawer";
import type { SnapPoint } from "@ui-sdk/solid/drawer";
import { createSignal, Show, untrack } from "solid-js";

import type { LogEntry, LogPlayer, Phase } from "../game/engine";
import { countChatsAfter } from "../lib/game-log-entries";
import type { ChatControls } from "../lib/room-connection";
import GameLog, { CHAT_AND_GAME_LOG_TITLE } from "./game-log";
import Tooltip from "./tooltip";

const HALF = 0.5;
const SNAP_POINTS: SnapPoint[] = [HALF, "content"];

/**
 * Chat & Log as a drawer from the header, with an unread count, for screens
 * without room for the log beside the page. It opens full height; dragged
 * down to half, the table above stays usable, so players can chat while they
 * watch.
 */
export default function ChatSheet(props: {
  log: LogEntry[];
  phase: Phase;
  playerId: string | null;
  /** Missing for a spectator, who can read the chat but not send to it. */
  chat?: ChatControls | undefined;
  players: readonly LogPlayer[];
  /** Other players typing a chat message, by player ID. */
  typing: readonly string[];
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
    <Drawer
      open={open()}
      onOpenChange={(next) => {
        setSeenLogId(latestLogId());
        setOwnOpen(next);
        props.onOpenChange?.(next);
      }}
      snapPoints={SNAP_POINTS}
      defaultSnapPoint="content"
      modalAbove={HALF}
    >
      <Tooltip
        content={triggerLabel()}
        type="label"
        side="bottom"
        compactOnly
        trigger={(hint) => (
          <DrawerTrigger
            {...hint}
            data-table-sheet-trigger=""
            aria-label={triggerLabel()}
          />
        )}
      >
        <MessageCircle size={16} aria-hidden="true" />
        <Show when={unreadChats() > 0}>
          <span class="unread-count" aria-hidden="true">
            {unreadChats()}
          </span>
        </Show>
        <span class="button-label" aria-hidden="true">
          Chat
        </span>
      </Tooltip>
      <DrawerBackdrop />
      <DrawerContent
        class="chat-sheet"
        keepMounted
        style={{ "--chat-sheet-lower-snap": String(HALF) }}
      >
        <DrawerHandle aria-label="Resize" />
        <header class="table-sheet-header">
          <DrawerTitle>{CHAT_AND_GAME_LOG_TITLE}</DrawerTitle>
          <Tooltip
            content="Close"
            type="label"
            trigger={(hint) => (
              <DrawerClose
                {...hint}
                aria-label="Close"
                data-size="sm"
                data-icon=""
              />
            )}
          >
            <X size={16} aria-hidden="true" />
          </Tooltip>
        </header>
        <div
          class="chat-sheet-body"
          data-agent-hidden={open() ? undefined : ""}
        >
          <GameLog
            inSheet
            log={props.log}
            phase={props.phase}
            playerId={props.playerId}
            chat={props.chat}
            players={props.players}
            typing={props.typing}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
