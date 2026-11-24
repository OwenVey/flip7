import ArrowDown from "@lucide/solid/icons/arrow-down";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import CircleX from "@lucide/solid/icons/circle-x";
import Coins from "@lucide/solid/icons/coins";
import Flame from "@lucide/solid/icons/flame";
import Heart from "@lucide/solid/icons/heart";
import PlayingCards from "@lucide/solid/icons/playing-cards";
import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import Send from "@lucide/solid/icons/send";
import Shuffle from "@lucide/solid/icons/shuffle";
import Snowflake from "@lucide/solid/icons/snowflake";
import Trophy from "@lucide/solid/icons/trophy";
import UserPlus from "@lucide/solid/icons/user-plus";
import { createPolled } from "@solid-primitives/timer";
import { dynamic } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import { Input } from "@ui-sdk/solid/input";
import {
  createScrollAreaController,
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaScrollToEnd,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@ui-sdk/solid/scroll-area";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/solid/segmented-control";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";

import { CHAT_MAX_LENGTH } from "../game/engine";
import type { LogEntry } from "../game/engine";
import {
  countChatsAfter,
  eventDetails,
  groupLog,
  HOUR_MS,
  localTime,
  MINUTE_MS,
  sameDetails,
  SECOND_MS,
  timeLabel,
} from "../lib/game-log-entries";
import type { EventIconKey } from "../lib/game-log-entries";
import PlayerAvatar from "./player-avatar";
import Tooltip from "./tooltip";

export const CHAT_AND_GAME_LOG_TITLE = "Chat & Log";

const FILTERS = ["All", "Chat", "Game"] as const;

type LogFilter = (typeof FILTERS)[number];

const EMPTY_MESSAGE = {
  All: "Nothing has happened yet.",
  Chat: "No messages yet.",
  Game: "No game activity yet.",
};

const eventIcons = {
  "arrow-right": ArrowRight,
  "circle-x": CircleX,
  coins: Coins,
  flame: Flame,
  heart: Heart,
  "playing-cards": PlayingCards,
  "playing-cards-fan": PlayingCardsFan,
  shuffle: Shuffle,
  snowflake: Snowflake,
  trophy: Trophy,
  "user-plus": UserPlus,
} satisfies Record<EventIconKey, typeof Flame>;

const LogTime = (props: { at: number; now: () => number }) => {
  const time = createMemo(() => new Date(props.at));

  const label = createMemo(() => timeLabel(time(), props.now()), {
    equals: (a, b) => a.long === b.long && a.short === b.short,
  });

  return (
    <time
      aria-label={label().long}
      datetime={time().toISOString()}
      title={localTime.exact.format(time())}
    >
      {label().short}
    </time>
  );
};

const oldGameMinute = (entry: LogEntry | undefined, now: () => number) => {
  if (
    entry === undefined ||
    entry.from !== undefined ||
    entry.at > now() - HOUR_MS
  ) {
    return null;
  }

  return Math.floor(entry.at / MINUTE_MS) * MINUTE_MS;
};

const ClockMinute = (props: { at: number | null; class?: string }) => {
  const at = createMemo(() => props.at);

  const date = createMemo(() => {
    const minute = at();

    return minute === null ? undefined : new Date(minute);
  });

  return (
    <Show when={date()}>
      {(time) => (
        <time class={props.class} datetime={time().toISOString()}>
          {localTime.clock.format(time())}
        </time>
      )}
    </Show>
  );
};

const GameEvent = (props: {
  entry: LogEntry;
  hasRoundHeading: boolean;
  previous: LogEntry | undefined;
  now: () => number;
}) => {
  const copy = createMemo(
    () => eventDetails(props.entry, props.hasRoundHeading),
    { equals: sameDetails }
  );

  const Icon = dynamic(() => {
    const key = copy().icon;

    return key === undefined ? undefined : eventIcons[key];
  });

  const minute = createMemo(() => oldGameMinute(props.entry, props.now));

  const heading = createMemo(() => {
    const at = minute();
    const { previous } = props;

    if (
      at === null ||
      (props.hasRoundHeading && previous === undefined) ||
      oldGameMinute(previous, props.now) === at
    ) {
      return null;
    }

    return at;
  });

  return (
    <>
      <ClockMinute class="log-time-heading" at={heading()} />
      <span
        class="log-event"
        data-announcement={copy().announcement ? "" : undefined}
      >
        <Icon class="log-event-icon" aria-hidden="true" size={13} />
        <span class="log-event-text">
          <span class="log-outcome">{copy().outcome}</span>
          <Show when={copy().detail}>{(detail) => <> · {detail()}</>}</Show>
        </span>
      </span>
      <Show when={minute() === null}>
        <LogTime at={props.entry.at} now={props.now} />
      </Show>
    </>
  );
};

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
        data-size="sm"
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
      <Tooltip
        content="Send"
        type="label"
        trigger={(hint) => (
          <Button
            {...hint}
            type="submit"
            aria-label="Send"
            data-size="sm"
            data-variant="solid"
            data-icon=""
          />
        )}
      >
        <Send size={16} aria-hidden="true" />
      </Tooltip>
    </form>
  );
};

export default function GameLog(props: {
  log: LogEntry[];
  playerId: string | null;
  onChat?: ((text: string) => boolean) | undefined;
  inSheet?: boolean;
}) {
  const [filter, setFilter] = createSignal<LogFilter>("All");
  const now = createPolled(Date.now, SECOND_MS);

  const visible = createMemo(() => {
    const currentFilter = filter();

    if (currentFilter === "All") {
      return props.log;
    }

    return props.log.filter(
      (entry) => (entry.from !== undefined) === (currentFilter === "Chat")
    );
  });

  const groups = createMemo(() => groupLog(visible()));
  const latestId = createMemo(() => visible().at(-1)?.id ?? 0);

  const [seenId, setSeenId] = createSignal(0);
  const [seenChatId, setSeenChatId] = createSignal(untrack(latestId));
  const [following, setFollowing] = createSignal(true);

  const newEntries = createMemo(() =>
    following() ? 0 : visible().filter((entry) => entry.id > seenId()).length
  );

  const unreadChats = createMemo(() =>
    filter() === "Game" || !following()
      ? countChatsAfter(props.log, props.playerId, seenChatId())
      : 0
  );

  const hiddenChats = () => (filter() === "Game" ? unreadChats() : 0);

  const scroll = createScrollAreaController();

  const markSeen = (id: number, currentFilter: LogFilter) => {
    setSeenId(id);

    if (currentFilter !== "Game") {
      setSeenChatId((previous) => Math.max(previous, id));
    }
  };

  createEffect(
    () => ({ filter: filter(), id: latestId(), isFollowing: following() }),
    ({ filter: currentFilter, id, isFollowing }) => {
      if (isFollowing) {
        markSeen(id, currentFilter);
      }
    }
  );

  return (
    <section class={props.inSheet === true ? "stack" : "panel log"}>
      <Show when={props.inSheet !== true}>
        <h2>
          {CHAT_AND_GAME_LOG_TITLE}
          <Show when={unreadChats() > 0}>
            <span class="log-unread" aria-hidden="true">
              {unreadChats()}
            </span>
          </Show>
        </h2>
        <output class="sr-only" aria-label="Unread chat messages">
          <Show when={unreadChats() > 0}>
            {unreadChats()} unread{" "}
            {unreadChats() === 1 ? "message" : "messages"}
          </Show>
        </output>
      </Show>
      <SegmentedControl
        class="log-filters"
        aria-label="Filter activity"
        value={filter()}
        onValueChange={(next) => {
          const option = FILTERS.find((candidate) => candidate === next);

          if (option !== undefined) {
            scroll.scrollToEnd({ behavior: "instant" });
            setFilter(option);
          }
        }}
      >
        <SegmentedControlIndicator />
        <For each={FILTERS}>
          {(option) => (
            <SegmentedControlItem
              value={option}
              aria-label={
                option === "Chat" && hiddenChats() > 0
                  ? `Chat, ${hiddenChats()} unread`
                  : undefined
              }
            >
              {option}
              <Show
                when={
                  props.inSheet === true &&
                  option === "Chat" &&
                  hiddenChats() > 0
                }
              >
                <span class="log-unread" aria-hidden="true">
                  {hiddenChats()}
                </span>
              </Show>
            </SegmentedControlItem>
          )}
        </For>
      </SegmentedControl>
      <ScrollArea
        class="log-body scroll-fades"
        type="auto"
        stickToEnd
        controller={scroll}
      >
        {(state) => {
          createEffect(
            () => state.sticking,
            (sticking) => {
              setFollowing(sticking);
            }
          );

          return (
            <>
              <ScrollAreaViewport
                class="log-scroll"
                role="log"
                aria-label={CHAT_AND_GAME_LOG_TITLE}
              >
                <ScrollAreaContent class="log-entries">
                  <Show
                    when={groups().length > 0}
                    fallback={
                      <p class="log-empty">{EMPTY_MESSAGE[filter()]}</p>
                    }
                  >
                    <For each={groups()} keyed={(group) => group.id}>
                      {(group) => (
                        <div class="log-group">
                          <Show when={group().heading}>
                            {(heading) => (
                              <div class="log-round-heading">
                                <h3>{heading()}</h3>
                                <ClockMinute
                                  at={oldGameMinute(group().entries[0], now)}
                                />
                              </div>
                            )}
                          </Show>
                          <ol>
                            <For
                              each={group().entries}
                              keyed={(entry) => entry.id}
                            >
                              {(entry, index) => (
                                <li
                                  data-cue={entry().cue}
                                  data-kind={entry().from ? "chat" : "game"}
                                  data-own={
                                    entry().from?.id === props.playerId
                                      ? ""
                                      : undefined
                                  }
                                >
                                  <Show
                                    when={entry().from}
                                    fallback={
                                      <GameEvent
                                        entry={entry()}
                                        hasRoundHeading={group().heading !== ""}
                                        previous={group().entries[index() - 1]}
                                        now={now}
                                      />
                                    }
                                  >
                                    {(author) => (
                                      <>
                                        <div class="log-message-header">
                                          <span class="log-author-line">
                                            <PlayerAvatar
                                              player={author()}
                                              size="sm"
                                            />
                                            <strong class="log-author">
                                              {author().name}
                                            </strong>
                                          </span>
                                          <LogTime at={entry().at} now={now} />
                                        </div>
                                        {entry().text}
                                      </>
                                    )}
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ol>
                        </div>
                      )}
                    </For>
                  </Show>
                </ScrollAreaContent>
              </ScrollAreaViewport>
              <ScrollAreaScrollbar>
                <ScrollAreaThumb />
              </ScrollAreaScrollbar>
              <div class="log-jump">
                <ScrollAreaScrollToEnd
                  render={(jump) => (
                    <Button {...jump} data-size="sm" data-variant="solid" />
                  )}
                >
                  <ArrowDown aria-hidden="true" />
                  Jump to latest
                  <Show when={newEntries() > 0}> · {newEntries()} new</Show>
                </ScrollAreaScrollToEnd>
              </div>
            </>
          );
        }}
      </ScrollArea>
      <Show
        when={props.onChat}
        fallback={<p class="muted chat-hint">Join as a player to chat.</p>}
      >
        {(onChat) => <ChatForm onSend={(message) => onChat()(message)} />}
      </Show>
    </section>
  );
}
