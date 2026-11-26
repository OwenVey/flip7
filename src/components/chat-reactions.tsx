import FaceSlightlySmilingPlus from "@lucide/solid/icons/face-slightly-smiling-plus";
import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import {
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

/** Opens the one reaction picker in Chat & Log, for the chat message with this ID. */
export type ReactionPickerController = PopoverController<number>;

const label = (emoji: ReactionEmoji, count: number) =>
  `${LABELS[emoji]}: ${count}`;

type Toggle = (messageId: number, emoji: ReactionEmoji) => Promise<void>;

const ReactionButton = (props: {
  label: string;
  selected: boolean;
  icon?: boolean;
  onClick: () => Promise<void>;
  children: JSX.Element;
}) => (
  <Button
    data-size="sm"
    data-icon={props.icon === true ? "" : undefined}
    data-variant={props.selected ? "solid" : undefined}
    aria-label={props.label}
    aria-pressed={props.selected ? "true" : "false"}
    onClick={async () => {
      await props.onClick();
    }}
  >
    <span aria-hidden="true">{props.children}</span>
  </Button>
);

/**
 * The reactions under one chat message. Players toggle a total or open the
 * picker; Spectators, who get no picker, see the totals.
 */
export const ChatReactions = (props: {
  messageId: number;
  reactions: MessageReactions | undefined;
  mine: ReactionEmoji | undefined;
  picker: ReactionPickerController | undefined;
  toggle: Toggle;
}) => {
  const counts = createMemo(() => countReactions(props.reactions));

  return (
    <Show when={props.picker !== undefined || props.reactions !== undefined}>
      <div class="chat-reactions" aria-live="off">
        <For each={REACTION_EMOJI}>
          {(emoji) => (
            <Show when={counts()[emoji]}>
              {(count) => (
                <Show
                  when={props.picker}
                  fallback={
                    <span class="chat-reaction-tally">
                      <span class="sr-only">{label(emoji, count())}</span>
                      <span aria-hidden="true">
                        {emoji} {count()}
                      </span>
                    </span>
                  }
                >
                  <ReactionButton
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
        <Show when={props.picker}>
          {(picker) => (
            <PopoverTrigger
              controller={picker()}
              payload={props.messageId}
              aria-label="Add reaction"
              title="Add reaction"
              data-size="sm"
              data-icon=""
            >
              <FaceSlightlySmilingPlus size={16} aria-hidden="true" />
            </PopoverTrigger>
          )}
        </Show>
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
  <Popover controller={props.controller}>
    <PopoverContent<number> class="chat-reaction-picker" side="top" align="end">
      {(state) => (
        <>
          <PopoverTitle class="sr-only">Add reaction</PopoverTitle>
          <For each={REACTION_EMOJI}>
            {(emoji) => (
              <ReactionButton
                icon
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
