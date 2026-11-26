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
import { Show } from "solid-js";

import type { RoomChatLog } from "../lib/room-chat-log";
import { CHAT_AND_GAME_LOG_TITLE, ChatLog } from "./game-log";
import Tooltip from "./tooltip";

const HALF = 0.5;
const SNAP_POINTS: SnapPoint[] = [HALF, "content"];

/**
 * Chat & Log as a drawer from the header, with an unread count, for screens
 * without room for the log beside the page. It opens full height; dragged
 * down to half, the table above stays usable, so players can chat while they
 * watch.
 */
export default function ChatSheet(props: { chatLog: RoomChatLog }) {
  const reads = () => props.chatLog.reads;

  const triggerLabel = () => {
    const unread = reads().unreadChats();

    return unread > 0
      ? `${CHAT_AND_GAME_LOG_TITLE}, ${unread} new ${unread === 1 ? "message" : "messages"}`
      : CHAT_AND_GAME_LOG_TITLE;
  };

  return (
    <Drawer
      open={props.chatLog.sheetOpen()}
      onOpenChange={(next, details) => {
        if (next && !props.chatLog.inSheet()) {
          details.cancel();

          return;
        }

        props.chatLog.setSheetOpen(next);
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
        <Show when={reads().unreadChats() > 0}>
          <span class="unread-count" aria-hidden="true">
            {reads().unreadChats()}
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
          data-agent-hidden={props.chatLog.sheetOpen() ? undefined : ""}
        >
          <Show when={props.chatLog.inSheet()}>
            <ChatLog chatLog={props.chatLog} inSheet />
          </Show>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
