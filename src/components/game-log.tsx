import ArrowDown from "@lucide/solid/icons/arrow-down";
import Send from "@lucide/solid/icons/send";
import { createPolled } from "@solid-primitives/timer";
import { Button } from "@ui-sdk/solid/button";
import { Input } from "@ui-sdk/solid/input";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  Show,
} from "solid-js";

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
  game: number | undefined;
  round: number | undefined;
  entries: LogEntry[];
}

const groupLogByRound = (entries: LogEntry[]) => {
  const groups: LogGroup[] = [];

  for (const entry of entries) {
    const group = groups.at(-1);

    if (group && group.round === entry.round && group.game === entry.game) {
      group.entries.push(entry);
    } else {
      groups.push({
        entries: [entry],
        game: entry.game,
        id: entry.id,
        round: entry.round,
      });
    }
  }

  return groups;
};

const groupHeading = (group: LogGroup) => {
  if (group.round === 0) {
    return "Lobby";
  }

  const round = `Round ${group.round}`;

  return group.game !== undefined && group.game > 1
    ? `Game ${group.game} · ${round}`
    : round;
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

const LogTime = (props: {
  at: number;
  everySecond: () => number;
  everyMinute: () => number;
}) => {
  const label = createMemo(() => {
    const coarse = props.everyMinute();
    const isFresh = coarse - props.at < MINUTE;
    const now = isFresh ? props.everySecond() : coarse;

    return logTimeLabel(props.at, now);
  });

  return (
    <time
      datetime={new Date(props.at).toISOString()}
      title={clockTime.format(props.at)}
    >
      {label()}
    </time>
  );
};

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
      <Button
        type="submit"
        aria-label="Send"
        data-size="sm"
        data-variant="solid"
        data-icon=""
      >
        <Send size={16} aria-hidden="true" />
      </Button>
    </form>
  );
};

export default function GameLog(props: {
  log: LogEntry[];
  playerId: string;
  onChat: (text: string) => boolean;
  inSheet?: boolean;
}) {
  const groups = createMemo(() => groupLogByRound(props.log));
  const latestId = createMemo(() => props.log.at(-1)?.id ?? 0);

  const everySecond = createPolled(Date.now, SECOND);
  const everyMinute = createPolled(Date.now, MINUTE);

  const [atBottom, setAtBottom] = createSignal(true);
  const [seenId, setSeenId] = createSignal(0);
  const hasUnseen = () => !atBottom() && latestId() > seenId();

  let scroller: HTMLDivElement | undefined;
  let entries: HTMLDivElement | undefined;
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

  // WARNING: the log also resizes without a new entry (text rewraps as the table reflows), so re-pin on every resize.
  onSettled(() => {
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (pinned) {
              scrollToLatest();
            }
          });

    for (const element of [scroller, entries]) {
      if (element) {
        observer?.observe(element);
      }
    }

    return () => {
      observer?.disconnect();
    };
  });

  return (
    <section class={props.inSheet === true ? "stack" : "panel log"}>
      <Show when={props.inSheet !== true}>
        <h2>Game log</h2>
      </Show>
      <div class="log-body">
        <div
          class="log-scroll"
          role="log"
          aria-label="Game log"
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
          <div
            class="log-entries"
            ref={(element) => {
              entries = element;
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
                      <h3>{groupHeading(group())}</h3>
                    </Show>
                    <ol>
                      <For each={group().entries} keyed={(entry) => entry.id}>
                        {(entry) => (
                          <li
                            data-cue={entry().cue}
                            data-kind={entry().from ? "chat" : undefined}
                            data-own={
                              entry().from?.id === props.playerId
                                ? ""
                                : undefined
                            }
                          >
                            <span class="log-text">
                              <Show when={entry().from?.name}>
                                {(name) => (
                                  <strong class="log-author">{name()}</strong>
                                )}
                              </Show>
                              {entry().text}
                            </span>
                            <Show when={entry().at}>
                              {(at) => (
                                <LogTime
                                  at={at()}
                                  everySecond={everySecond}
                                  everyMinute={everyMinute}
                                />
                              )}
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
