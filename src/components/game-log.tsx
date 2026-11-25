import ArrowDown from "@lucide/solid/icons/arrow-down";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import ChevronRight from "@lucide/solid/icons/chevron-right";
import CircleX from "@lucide/solid/icons/circle-x";
import Coins from "@lucide/solid/icons/coins";
import Flame from "@lucide/solid/icons/flame";
import Heart from "@lucide/solid/icons/heart";
import Lock from "@lucide/solid/icons/lock";
import LockOpen from "@lucide/solid/icons/lock-open";
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
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";

import { CHAT_MAX_LENGTH } from "../game/engine";
import type { LogEntry } from "../game/engine";
import { sameName } from "../game/names";
import {
  continuesChat,
  countChatsAfter,
  detailText,
  eventDetails,
  groupLog,
  HOUR_MS,
  involves,
  localTime,
  MINUTE_MS,
  nameParts,
  sameDetails,
  SECOND_MS,
  shownTimes,
  summarizeRound,
  timeLabel,
} from "../lib/game-log-entries";
import type {
  EventDetail,
  EventIconKey,
  LogGroup,
} from "../lib/game-log-entries";
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
  lock: Lock,
  "lock-open": LockOpen,
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

interface Spotlight {
  name: string | null;
  toggle: (name: string) => void;
}

const Named = (props: {
  text: string;
  names: readonly string[];
  spotlight: Spotlight;
}) => (
  <For each={nameParts(props.text, props.names)}>
    {(part) =>
      "text" in part ? (
        part.text
      ) : (
        <button
          type="button"
          class="log-name"
          aria-pressed={
            props.spotlight.name !== null &&
            sameName(props.spotlight.name, part.name)
              ? "true"
              : "false"
          }
          onClick={() => {
            props.spotlight.toggle(part.name);
          }}
        >
          {part.name}
        </button>
      )
    }
  </For>
);

const Detail = (props: {
  detail: EventDetail;
  names: readonly string[];
  spotlight: Spotlight;
}) => (
  <Switch
    fallback={
      <Named
        text={detailText(props.detail)}
        names={props.names}
        spotlight={props.spotlight}
      />
    }
  >
    <Match when={props.detail.kind === "card" ? props.detail : undefined}>
      {(card) => (
        <>
          {card().label}{" "}
          <span
            class="log-card"
            style={{ "--chip-color": `var(--number-${card().number})` }}
          >
            {card().number}
          </span>
        </>
      )}
    </Match>
    <Match when={props.detail.kind === "points" ? props.detail : undefined}>
      {(points) => (
        <span class="log-points">
          +{points().points}
          <span class="sr-only">
            {points().points === 1 ? " point" : " points"}
          </span>
        </span>
      )}
    </Match>
  </Switch>
);

const GameEvent = (props: {
  entry: LogEntry;
  hasRoundHeading: boolean;
  previous: LogEntry | undefined;
  showTime: boolean;
  now: () => number;
  spotlight: Spotlight;
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
          <span class="log-outcome">
            <Named
              text={copy().outcome}
              names={copy().players}
              spotlight={props.spotlight}
            />
          </span>
          <For each={copy().details} keyed={(detail) => detailText(detail)}>
            {(detail) => (
              <>
                {" "}
                <span class="log-detail">
                  <Show when={detail().kind !== "points"}>{"·\u00A0"}</Show>
                  <Detail
                    detail={detail()}
                    names={copy().players}
                    spotlight={props.spotlight}
                  />
                </span>
              </>
            )}
          </For>
        </span>
      </span>
      <Show when={minute() === null && props.showTime}>
        <LogTime at={props.entry.at} now={props.now} />
      </Show>
    </>
  );
};

const ChatMessage = (props: {
  author: NonNullable<LogEntry["from"]>;
  entry: LogEntry;
  continuation: boolean;
  now: () => number;
}) => (
  <>
    <Show when={!props.continuation}>
      <div class="log-message-header">
        <span class="log-author-line">
          <PlayerAvatar player={props.author} size="sm" />
          <strong class="log-author">{props.author.name}</strong>
        </span>
        <LogTime at={props.entry.at} now={props.now} />
      </div>
    </Show>
    <span>
      <Show when={props.continuation}>
        <span class="sr-only">{props.author.name}: </span>
      </Show>
      {props.entry.text}
    </span>
  </>
);

const CHAT_COUNT_FROM = CHAT_MAX_LENGTH - 40;

const ChatForm = (props: {
  onSend: (text: string) => boolean;
  onTyping: (() => void) | undefined;
}) => {
  const [text, setText] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  const message = createMemo(() => text().trim());
  const countId = createUniqueId();

  const submit = () => {
    const draft = message();

    if (draft === "") {
      return;
    }

    const sent = props.onSend(draft);
    setFailed(!sent);

    if (sent) {
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

          if (value.trim() !== "") {
            props.onTyping?.();
          }
        }}
        maxlength={CHAT_MAX_LENGTH}
        aria-describedby={countId}
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
            disabled={message() === ""}
            focusableWhenDisabled
          />
        )}
      >
        <Send size={16} aria-hidden="true" />
      </Tooltip>
      <span
        id={countId}
        class="chat-count"
        hidden={text().length < CHAT_COUNT_FROM}
        data-full={text().length >= CHAT_MAX_LENGTH ? "" : undefined}
      >
        {text().length}/{CHAT_MAX_LENGTH}
      </span>
      <output class="chat-send-status form-error">
        {failed() ? "Message not sent. Try again when reconnected." : ""}
      </output>
    </form>
  );
};

const roundKey = (entry: LogEntry | undefined) =>
  entry === undefined ? "" : `${entry.game}:${entry.round}`;

const LogRound = (props: {
  group: LogGroup;
  collapsible: boolean;
  playerId: string | null;
  myName: string | null;
  newFrom: number | undefined;
  spotlight: Spotlight;
  now: () => number;
}) => {
  const [open, setOpen] = createSignal(false);
  const collapsed = () => props.collapsible && !open();

  const shown = createMemo(() =>
    collapsed()
      ? props.group.entries.filter((entry) => entry.from !== undefined)
      : props.group.entries
  );

  const times = createMemo(() => shownTimes(shown()));

  const summary = createMemo(() => {
    if (!props.collapsible) {
      return "";
    }

    const parts = summarizeRound(props.group.entries);

    const events = props.group.entries.filter(
      (entry) => entry.from === undefined
    ).length;

    return parts.length > 0
      ? parts.join(" · ")
      : `${events} ${events === 1 ? "event" : "events"}`;
  });

  return (
    <div class="log-group">
      <Show when={props.group.heading}>
        {(heading) => (
          <div class="log-round-heading">
            <Show when={props.collapsible} fallback={<h3>{heading()}</h3>}>
              <h3>
                <button
                  type="button"
                  class="log-round-toggle"
                  aria-expanded={open() ? "true" : "false"}
                  onClick={() => {
                    setOpen((previous) => !previous);
                  }}
                >
                  <ChevronRight aria-hidden="true" size={12} />
                  {heading()}
                </button>
              </h3>
              <Show when={collapsed()}>
                <span class="log-round-summary">{summary()}</span>
              </Show>
            </Show>
            <ClockMinute
              at={oldGameMinute(props.group.entries[0], props.now)}
            />
          </div>
        )}
      </Show>
      <Show when={shown().length > 0}>
        <ol>
          <For each={shown()} keyed={(entry) => entry.id}>
            {(entry, index) => {
              const previous = () => shown()[index() - 1];

              const continuation = createMemo(() =>
                continuesChat(entry(), previous())
              );

              const mine = createMemo(() => {
                const name = props.myName;

                return (
                  name !== null &&
                  entry().from === undefined &&
                  involves(entry(), name)
                );
              });

              const spotlit = createMemo(() => {
                const { name } = props.spotlight;

                return name !== null && involves(entry(), name);
              });

              return (
                <>
                  <Show when={entry().id === props.newFrom}>
                    <li class="log-new">
                      <span>New</span>
                    </li>
                  </Show>
                  <li
                    data-continuation={continuation() ? "" : undefined}
                    data-cue={entry().cue}
                    data-kind={entry().from ? "chat" : "game"}
                    data-mine={mine() ? "" : undefined}
                    data-own={
                      entry().from?.id === props.playerId ? "" : undefined
                    }
                    data-spotlit={spotlit() ? "" : undefined}
                  >
                    <Show
                      when={entry().from}
                      fallback={
                        <GameEvent
                          entry={entry()}
                          hasRoundHeading={props.group.heading !== ""}
                          previous={previous()}
                          showTime={times().has(entry().id)}
                          now={props.now}
                          spotlight={props.spotlight}
                        />
                      }
                    >
                      {(author) => (
                        <ChatMessage
                          author={author()}
                          entry={entry()}
                          continuation={continuation()}
                          now={props.now}
                        />
                      )}
                    </Show>
                  </li>
                </>
              );
            }}
          </For>
        </ol>
      </Show>
    </div>
  );
};

const typingLabel = (names: readonly string[]) => {
  const [first, second] = names;

  if (first === undefined) {
    return "";
  }

  if (names.length === 1) {
    return `${first} is typing…`;
  }

  return names.length === 2 && second !== undefined
    ? `${first} and ${second} are typing…`
    : "Several people are typing…";
};

export default function GameLog(props: {
  log: LogEntry[];
  playerId: string | null;
  onChat?: ((text: string) => boolean) | undefined;
  inSheet?: boolean;
  players?: readonly { id: string; name: string }[];
  typing?: readonly string[];
  onTyping?: (() => void) | undefined;
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

  const [newFrom, setNewFrom] = createSignal<number | undefined>();

  const firstUnseen = createMemo(() =>
    following() ? undefined : visible().find((entry) => entry.id > seenId())?.id
  );

  createEffect(
    () => firstUnseen(),
    (id) => {
      if (id !== undefined) {
        setNewFrom(id);
      }
    }
  );

  let latestWhileFollowing: number | undefined;

  createEffect(
    () => ({ id: latestId(), isFollowing: following() }),
    ({ id, isFollowing }) => {
      if (
        isFollowing &&
        latestWhileFollowing !== undefined &&
        id !== latestWhileFollowing
      ) {
        setNewFrom(undefined);
      }

      latestWhileFollowing = isFollowing ? id : undefined;
    }
  );

  const [spotlit, setSpotlit] = createSignal<string | null>(null);

  const spotlight: Spotlight = {
    get name() {
      return spotlit();
    },
    toggle: (name) => {
      setSpotlit((current) =>
        current !== null && sameName(current, name) ? null : name
      );
    },
  };

  const myName = createMemo(
    () =>
      props.players?.find((player) => player.id === props.playerId)?.name ??
      null
  );

  const currentRound = createMemo(() => roundKey(props.log.at(-1)));

  const typingNames = createMemo(() =>
    (props.typing ?? []).flatMap((id) => {
      const name = props.players?.find((player) => player.id === id)?.name;

      return name === undefined ? [] : [name];
    })
  );

  return (
    <section class={props.inSheet === true ? "stack" : "panel log"}>
      <Show when={props.inSheet !== true}>
        <h2>
          {CHAT_AND_GAME_LOG_TITLE}
          <Show when={filter() !== "Game" && unreadChats() > 0}>
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
            setNewFrom(undefined);
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
              <Show when={option === "Chat" && hiddenChats() > 0}>
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
                        <LogRound
                          group={group()}
                          collapsible={
                            filter() !== "Chat" &&
                            (group().entries[0]?.round ?? 0) > 0 &&
                            roundKey(group().entries[0]) !== currentRound()
                          }
                          playerId={props.playerId}
                          myName={myName()}
                          newFrom={newFrom()}
                          spotlight={spotlight}
                          now={now}
                        />
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
      <div class="log-compose">
        <Show when={spotlit()}>
          {(name) => (
            <p class="log-spotlight">
              <span>
                Highlighting <strong>{name()}</strong>
              </span>
              <Button
                data-size="sm"
                onClick={() => {
                  setSpotlit(null);
                }}
              >
                Clear
              </Button>
            </p>
          )}
        </Show>
        <p class="log-typing" hidden={typingNames().length === 0}>
          {typingLabel(typingNames())}
        </p>
        <Show
          when={props.onChat}
          fallback={<p class="muted chat-hint">Join as a player to chat.</p>}
        >
          {(onChat) => (
            <ChatForm
              onSend={(message) => {
                const sent = onChat()(message);

                if (sent) {
                  setNewFrom(undefined);
                }

                return sent;
              }}
              onTyping={props.onTyping}
            />
          )}
        </Show>
      </div>
    </section>
  );
}
