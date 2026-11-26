import FaceSlightlySmilingPlus from "@lucide/solid/icons/face-slightly-smiling-plus";
import { Button } from "@ui-sdk/solid/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { createSignal, For, onSettled, Show } from "solid-js";

import { REACTION_EMOJI } from "../game/chat-reactions";
import type { ReactionCounts, ReactionEmoji } from "../game/chat-reactions";

const LABELS: Record<ReactionEmoji, string> = {
  "❤️": "Heart",
  "👍": "Thumbs up",
  "🎉": "Celebrate",
  "😂": "Laugh",
  "😬": "Grimace",
  "😮": "Surprise",
};

const ERROR_SHOWN_MS = 4000;

export const ChatReactions = (props: {
  counts: ReactionCounts | undefined;
  mine: ReactionEmoji | undefined;
  send: ((emoji: ReactionEmoji | null) => Promise<boolean>) | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
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
    if (!props.send || pending()) {
      return;
    }

    props.setOpen(false);
    clearTimeout(errorTimer);
    setFailed(false);
    setPending(true);
    const accepted = await props.send(props.mine === emoji ? null : emoji);

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
    <Show when={Boolean(props.send ?? props.counts)}>
      <div class="chat-reactions" aria-live="off">
        <For each={REACTION_EMOJI}>
          {(emoji) => (
            <Show when={props.counts?.[emoji]}>
              {(count) => {
                const label = () => `${LABELS[emoji]}: ${count()}`;

                return (
                  <Show
                    when={props.send}
                    fallback={
                      <span class="chat-reaction-tally">
                        <span class="sr-only">{label()}</span>
                        <span aria-hidden="true">
                          {emoji} {count()}
                        </span>
                      </span>
                    }
                  >
                    <Button
                      data-size="sm"
                      data-variant={props.mine === emoji ? "solid" : undefined}
                      aria-label={label()}
                      aria-pressed={props.mine === emoji ? "true" : "false"}
                      disabled={pending()}
                      focusableWhenDisabled
                      onClick={async () => {
                        await choose(emoji);
                      }}
                    >
                      <span aria-hidden="true">
                        {emoji} {count()}
                      </span>
                    </Button>
                  </Show>
                );
              }}
            </Show>
          )}
        </For>
        <Show when={props.send}>
          <Popover open={props.open} onOpenChange={props.setOpen}>
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
                  <Button
                    data-size="sm"
                    data-icon=""
                    data-variant={props.mine === emoji ? "solid" : undefined}
                    aria-label={LABELS[emoji]}
                    aria-pressed={props.mine === emoji ? "true" : "false"}
                    disabled={pending()}
                    focusableWhenDisabled
                    onClick={async () => {
                      await choose(emoji);
                    }}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </Button>
                )}
              </For>
            </PopoverContent>
          </Popover>
        </Show>
      </div>
      <Show when={props.send}>
        <output class="chat-reaction-status form-error">
          {failed() ? "Reaction not saved. Try again." : ""}
        </output>
      </Show>
    </Show>
  );
};
