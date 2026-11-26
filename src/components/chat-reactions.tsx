import FaceSlightlySmilingPlus from "@lucide/solid/icons/face-slightly-smiling-plus";
import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import {
  createPopoverController,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import type { PopoverController } from "@ui-sdk/solid/popover";
import { createMemo, For, Show } from "solid-js";

import { countReactions, REACTION_EMOJI } from "../game/chat-reactions";
import type { MessageReactions, ReactionEmoji } from "../game/chat-reactions";

const LABELS: Record<ReactionEmoji, string> = {
  "❤️": "Heart",
  "👍": "Thumbs up",
  "🎉": "Celebrate",
  "😂": "Laugh",
  "😬": "Grimace",
  "😮": "Surprise",
};

const TRIGGER_PRESS_TIMEOUT_MS = 400;

/** Opens the one reaction picker in Chat & Log, for the chat message with this ID. */
export interface ReactionPickerController {
  popover: PopoverController<number>;
  close: () => void;
  markTriggerPress: () => void;
  clearTriggerPress: () => void;
  isTriggerPressing: () => boolean;
}

export const createReactionPicker = () => {
  const popover = createPopoverController<number>();
  let pressing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTriggerPress = () => {
    pressing = false;
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    clearTriggerPress,
    close: () => {
      clearTriggerPress();
      popover.close();
    },
    isTriggerPressing: () => pressing,
    markTriggerPress: () => {
      pressing = true;
      clearTimeout(timer);
      timer = setTimeout(clearTriggerPress, TRIGGER_PRESS_TIMEOUT_MS);
    },
    popover,
  } satisfies ReactionPickerController;
};

const label = (emoji: ReactionEmoji, count: number) =>
  `${LABELS[emoji]}: ${count}`;

type Toggle = (messageId: number, emoji: ReactionEmoji) => Promise<void>;

const ReactionButton = (props: {
  class: string;
  label: string;
  selected: boolean;
  onClick: () => Promise<void>;
  children: JSX.Element;
}) => (
  <Button
    class={props.class}
    aria-label={props.label}
    aria-pressed={props.selected ? "true" : "false"}
    onClick={async () => {
      await props.onClick();
    }}
  >
    <span aria-hidden="true">{props.children}</span>
  </Button>
);

/** The sidecar button beside a chat bubble that opens the shared reaction picker. */
export const ReactionTrigger = (props: {
  messageId: number;
  picker: ReactionPickerController;
}) => (
  <PopoverTrigger
    class="chat-react-trigger"
    controller={props.picker.popover}
    payload={props.messageId}
    aria-label="Add reaction"
    title="Add reaction"
    onPointerDown={() => {
      props.picker.markTriggerPress();
    }}
    onClick={() => {
      props.picker.clearTriggerPress();
    }}
  >
    <FaceSlightlySmilingPlus size={14} aria-hidden="true" />
  </PopoverTrigger>
);

/**
 * The reaction chips straddling the bottom edge of a chat bubble. Players
 * toggle a total; Spectators see read-only tallies.
 */
export const ChatReactions = (props: {
  messageId: number;
  reactions: MessageReactions | undefined;
  mine: ReactionEmoji | undefined;
  interactive: boolean;
  toggle: Toggle;
}) => {
  const counts = createMemo(() => countReactions(props.reactions));

  const hasReactions = createMemo(() =>
    REACTION_EMOJI.some((emoji) => counts()[emoji] !== undefined)
  );

  return (
    <Show when={hasReactions()}>
      <div class="chat-reactions" aria-live="off">
        <For each={REACTION_EMOJI}>
          {(emoji) => (
            <Show when={counts()[emoji]}>
              {(count) => (
                <Show
                  when={props.interactive}
                  fallback={
                    <span class="chat-reaction-chip chat-reaction-tally">
                      <span class="sr-only">{label(emoji, count())}</span>
                      <span aria-hidden="true">
                        {emoji} {count()}
                      </span>
                    </span>
                  }
                >
                  <ReactionButton
                    class="chat-reaction-chip"
                    label={label(emoji, count())}
                    selected={props.mine === emoji}
                    onClick={async () => {
                      await props.toggle(props.messageId, emoji);
                    }}
                  >
                    {emoji} {count()}
                  </ReactionButton>
                </Show>
              )}
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
};

/** The one reaction picker in Chat & Log, opened by each chat message's Add reaction. */
export const ReactionPicker = (props: {
  controller: ReactionPickerController;
  mine: (messageId: number) => ReactionEmoji | undefined;
  toggle: Toggle;
}) => (
  <Popover
    controller={props.controller.popover}
    onOpenChange={(open, details) => {
      if (
        !open &&
        details.reason === "focus-out" &&
        props.controller.isTriggerPressing()
      ) {
        details.cancel();
      }
    }}
  >
    <PopoverContent<number>
      class="chat-reaction-picker"
      side="top"
      align="center"
    >
      {(state) => (
        <>
          <PopoverTitle class="sr-only">Add reaction</PopoverTitle>
          <For each={REACTION_EMOJI}>
            {(emoji) => (
              <ReactionButton
                class="chat-reaction-option"
                label={LABELS[emoji]}
                selected={
                  state.payload !== undefined &&
                  props.mine(state.payload) === emoji
                }
                onClick={async () => {
                  const messageId = state.payload;

                  if (messageId === undefined) {
                    return;
                  }

                  props.controller.close();
                  await props.toggle(messageId, emoji);
                }}
              >
                {emoji}
              </ReactionButton>
            )}
          </For>
        </>
      )}
    </PopoverContent>
  </Popover>
);
