import ArrowDown from "@lucide/solid/icons/arrow-down";
import { createPolled } from "@solid-primitives/timer";
import { Button } from "@ui-sdk/solid/button";
import { Input } from "@ui-sdk/solid/input";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { CHAT_MAX_LENGTH } from "../game/engine";
import type { LogEntry } from "../game/engine";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PINNED_SLACK_PX = 24;

const clockTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

interface LogGroup {
  id: number;
  round: number | undefined;
  entries: LogEntry[];
}

const groupLogByRound = (entries: LogEntry[]) => {
  const groups: LogGroup[] = [];

  for (const entry of entries) {
    const group = groups.at(-1);

    if (group && group.round === entry.round) {
      group.entries.push(entry);
    } else {
      groups.push({ entries: [entry], id: entry.id, round: entry.round });
    }
  }

  return groups;
};

const logTimeLabel = (at: number, now: number) => {
  const elapsed = Math.max(0, now - at);

  if (elapsed < MINUTE) {
    return relativeTime.format(-Math.floor(elapsed / SECOND), "second");
  }

  if (elapsed < HOUR) {
    return relativeTime.format(-Math.floor(elapsed / MINUTE), "minute");
  }

  return clockTime.format(at);
};

const LogTime = (props: { at: number; now: number }) => (
  <time
    datetime={new Date(props.at).toISOString()}
    title={clockTime.format(props.at)}
  >
    {logTimeLabel(props.at, props.now)}
  </time>
);

const isScrolledToBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <=
  PINNED_SLACK_PX;

const ChatForm = (props: { onSend: (text: string) => boolean }) => {
  const [text, setText] = createSignal("");

  const submit = () => {
    const message = text().trim();

    if (message !== "" && props.onSend(message)) {
      setText("");
    }
  };

  return (
    <form
      class="chat-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        aria-label="Chat message"
        placeholder="Say something…"
        value={text()}
        onValueChange={(value) => {
          setText(value);
        }}
        maxlength={CHAT_MAX_LENGTH}
        autocomplete="off"
        enterkeyhint="send"
      />
      <Button type="submit" data-size="sm" data-variant="solid">
        Send
      </Button>
    </form>
  );
};

export default function GameLog(props: {
  log: LogEntry[];
  playerId: string;
  onChat: (text: string) => boolean;
}) {
  const groups = createMemo(() => groupLogByRound(props.log));
  const latestId = createMemo(() => props.log.at(-1)?.id ?? 0);

  const now = createPolled(Date.now, SECOND);
  const [atBottom, setAtBottom] = createSignal(true);
  const [seenId, setSeenId] = createSignal(0);
  const hasUnseen = () => !atBottom() && latestId() > seenId();

  let scroller: HTMLDivElement | undefined;
  let pinned = true;

  const scrollToLatest = () => {
    pinned = true;

    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  };

  createEffect(
    () => latestId(),
    () => {
      if (pinned) {
        scrollToLatest();
      }
    }
  );

  return (
    <section class="panel log" aria-labelledby="game-log-title">
      <h2 id="game-log-title">Game log</h2>
      <div class="log-body">
        <div
          class="log-scroll"
          role="log"
          aria-labelledby="game-log-title"
          ref={(element) => {
            scroller = element;
          }}
          onScroll={(event) => {
            const bottom = isScrolledToBottom(event.currentTarget);
            pinned = bottom;
            setAtBottom(bottom);

            if (bottom) {
              setSeenId(latestId());
            }
          }}
        >
          <Show
            when={groups().length > 0}
            fallback={<p class="log-empty">Nothing has happened yet.</p>}
          >
            <For each={groups()} keyed={(group) => group.id}>
              {(group) => (
                <section class="log-group">
                  <Show when={group().round !== undefined}>
                    <h3>
                      {group().round === 0 ? "Lobby" : `Round ${group().round}`}
                    </h3>
                  </Show>
                  <ol>
                    <For each={group().entries} keyed={(entry) => entry.id}>
                      {(entry) => (
                        <li
                          data-cue={entry().cue}
                          data-kind={entry().from ? "chat" : undefined}
                          data-own={
                            entry().from?.id === props.playerId ? "" : undefined
                          }
                        >
                          <span class="log-text">
                            <Show when={entry().from}>
                              {(from) => (
                                <strong class="log-author">
                                  {from().name}
                                </strong>
                              )}
                            </Show>
                            {entry().text}
                          </span>
                          <Show when={entry().at}>
                            {(at) => <LogTime at={at()} now={now()} />}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ol>
                </section>
              )}
            </For>
          </Show>
        </div>
        <Show when={hasUnseen()}>
          <div class="log-jump">
            <Button
              data-size="sm"
              data-variant="solid"
              onClick={scrollToLatest}
            >
              <ArrowDown aria-hidden="true" />
              New activity
            </Button>
          </div>
        </Show>
      </div>
      <ChatForm
        onSend={(text) => {
          pinned = true;

          return props.onChat(text);
        }}
      />
    </section>
  );
}
