import FaceSlightlySmilingPlus from "@lucide/solid/icons/face-slightly-smiling-plus";
import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

import { countReactions, REACTION_EMOJI } from "../game/chat-reactions";
import type {
  MessageReactions,
  ReactionCounts,
  ReactionEmoji,
} from "../game/chat-reactions";
import type { ChatControls } from "../lib/room-connection";

const LABELS: Record<ReactionEmoji, string> = {
  "❤️": "Heart",
  "👍": "Thumbs up",
  "🎉": "Celebrate",
  "😂": "Laugh",
  "😬": "Grimace",
  "😮": "Surprise",
};

const ERROR_SHOWN_MS = 4000;

const countLabel = (emoji: ReactionEmoji, count: number) =>
  `${LABELS[emoji]}: ${count}`;

const ReactionTallies = (props: { counts: ReactionCounts }) => (
  <div class="chat-reactions" aria-live="off">
    <For each={REACTION_EMOJI}>
      {(emoji) => (
        <Show when={props.counts[emoji]}>
          {(count) => (
            <span class="chat-reaction-tally">
              <span class="sr-only">{countLabel(emoji, count())}</span>
              <span aria-hidden="true">
                {emoji} {count()}
              </span>
            </span>
          )}
        </Show>
      )}
    </For>
  </div>
);

const ReactionButton = (props: {
  label: string;
  selected: boolean;
  disabled: boolean;
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
    disabled={props.disabled}
    focusableWhenDisabled
    onClick={async () => {
      await props.onClick();
    }}
  >
    <span aria-hidden="true">{props.children}</span>
  </Button>
);

const ReactionControls = (props: {
  counts: ReactionCounts;
  mine: ReactionEmoji | undefined;
  react: (emoji: ReactionEmoji | null) => Promise<boolean>;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) => {
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  onSettled(() => () => {
    disposed = true;
    clearTimeout(errorTimer);
  });

  const choose = async (emoji: ReactionEmoji) => {
    if (pending()) {
      return;
    }

    props.setPickerOpen(false);
    clearTimeout(errorTimer);
    setFailed(false);
    setPending(true);
    const accepted = await props.react(props.mine === emoji ? null : emoji);

    if (disposed) {
      return;
    }

    setPending(false);

    if (!accepted) {
      setFailed(true);
      errorTimer = setTimeout(() => {
        setFailed(false);
      }, ERROR_SHOWN_MS);
    }
  };

  return (
    <>
      <div class="chat-reactions" aria-live="off">
        <For each={REACTION_EMOJI}>
          {(emoji) => (
            <Show when={props.counts[emoji]}>
              {(count) => (
                <ReactionButton
                  label={countLabel(emoji, count())}
                  selected={props.mine === emoji}
                  disabled={pending()}
                  onClick={async () => {
                    await choose(emoji);
                  }}
                >
                  {emoji} {count()}
                </ReactionButton>
              )}
            </Show>
          )}
        </For>
        <Popover open={props.pickerOpen} onOpenChange={props.setPickerOpen}>
          <PopoverTrigger
            aria-label="Add reaction"
            title="Add reaction"
            data-size="sm"
            data-icon=""
          >
            <FaceSlightlySmilingPlus size={16} aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent class="chat-reaction-picker" side="top" align="end">
            <PopoverTitle class="sr-only">Add reaction</PopoverTitle>
            <For each={REACTION_EMOJI}>
              {(emoji) => (
                <ReactionButton
                  icon
                  label={LABELS[emoji]}
                  selected={props.mine === emoji}
                  disabled={pending()}
                  onClick={async () => {
                    await choose(emoji);
                  }}
                >
                  {emoji}
                </ReactionButton>
              )}
            </For>
          </PopoverContent>
        </Popover>
      </div>
      <output class="chat-reaction-status form-error">
        {failed() ? "Reaction not saved. Try again." : ""}
      </output>
    </>
  );
};

/**
 * The reactions under one chat message. Players can react; Spectators see
 * the totals. Only one message's picker is open at a time.
 */
export const ChatReactions = (props: {
  messageId: number;
  reactions: MessageReactions | undefined;
  playerId: string | null;
  chat: ChatControls | undefined;
  openPicker: number | null;
  setOpenPicker: (messageId: number | null) => void;
}) => {
  const counts = createMemo(() => countReactions(props.reactions));

  return (
    <Show
      when={props.chat}
      fallback={
        <Show when={props.reactions}>
          <ReactionTallies counts={counts()} />
        </Show>
      }
    >
      {(chat) => (
        <ReactionControls
          counts={counts()}
          mine={
            props.playerId === null
              ? undefined
              : props.reactions?.[props.playerId]
          }
          react={async (emoji) => await chat().react(props.messageId, emoji)}
          pickerOpen={props.openPicker === props.messageId}
          setPickerOpen={(open) => {
            if (open) {
              props.setOpenPicker(props.messageId);
            } else if (props.openPicker === props.messageId) {
              props.setOpenPicker(null);
            }
          }}
        />
      )}
    </Show>
  );
};
