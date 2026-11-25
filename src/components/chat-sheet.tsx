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
import { createSignal, Show } from "solid-js";

import { createChatLogReads } from "../lib/chat-log-reads";
import { CHAT_AND_GAME_LOG_TITLE, ChatLog } from "./game-log";
import type { ChatLogProps } from "./game-log";
import Tooltip from "./tooltip";

const HALF = 0.5;
const SNAP_POINTS: SnapPoint[] = [HALF, "content"];

/**
 * Chat & Log as a drawer from the header, with an unread count, for screens
 * without room for the log beside the page. It opens full height; dragged
 * down to half, the table above stays usable, so players can chat while they
 * watch.
 */
export default function ChatSheet(
  props: ChatLogProps & {
    /** Set with `onOpenChange` when the page also needs to close the sheet. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * False while the page shows the log elsewhere, so a long log isn't
     * rendered twice. The sheet still mounts it whenever it is open.
     */
    logInSheet?: boolean;
  }
) {
  const [ownOpen, setOwnOpen] = createSignal(false);
  const open = () => props.open ?? ownOpen();

  const reads = createChatLogReads({
    log: () => props.log,
    playerId: () => props.playerId,
    shown: open,
  });

  const triggerLabel = () => {
    const unread = reads.unreadChats();

    return unread > 0
      ? `${CHAT_AND_GAME_LOG_TITLE}, ${unread} new ${unread === 1 ? "message" : "messages"}`
      : CHAT_AND_GAME_LOG_TITLE;
  };

  return (
    <Drawer
      open={open()}
      onOpenChange={(next) => {
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
        <Show when={reads.unreadChats() > 0}>
          <span class="unread-count" aria-hidden="true">
            {reads.unreadChats()}
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
          <Show when={props.logInSheet !== false || open()}>
            <ChatLog
              reads={reads}
              inSheet
              chat={props.chat}
              players={props.players}
              typing={props.typing}
            />
          </Show>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
