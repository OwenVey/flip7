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
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/solid/collapsible";
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
  createContext,
  createEffect,
  createMemo,
  createProjection,
  createSignal,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
  useContext,
} from "solid-js";

import { CHAT_MAX_LENGTH } from "../game/engine";
import type { LogEntry, LogPlayer } from "../game/engine";
import { createChatLogReads, LOG_FILTERS } from "../lib/chat-log-reads";
import type { ChatLogReads } from "../lib/chat-log-reads";
import {
  continuesChat,
  detailText,
  eventDetailsWithMentions,
  groupLog,
  HOUR_MS,
  involvedIds,
  involves,
  localTime,
  MINUTE_MS,
  nameParts,
  sameDetails,
  SECOND_MS,
  shownTimes,
  timeLabel,
} from "../lib/game-log-entries";
import type {
  EventDetail,
  EventIconKey,
  LogGroup,
  NamePart,
} from "../lib/game-log-entries";
import type { ChatControls } from "../lib/room-connection";
import PlayerAvatar from "./player-avatar";
import Tooltip from "./tooltip";

export const CHAT_AND_GAME_LOG_TITLE = "Chat & Log";

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

const LogTime = (props: { at: number; now: number }) => {
  const time = createMemo(() => new Date(props.at));

  const label = createMemo(() => timeLabel(time(), props.now), {
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

const oldGameMinute = (entry: LogEntry | undefined, now: number) => {
  if (
    entry === undefined ||
    entry.from !== undefined ||
    entry.at > now - HOUR_MS
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
  has: (playerId: string) => boolean;
  toggle: (player: LogPlayer) => void;
}

const SpotlightContext = createContext<Spotlight>();

const PlayerName = (props: { player: LogPlayer; class?: string }) => {
  const spotlight = useContext(SpotlightContext);

  return (
    <button
      type="button"
      class={["log-name", props.class]}
      aria-pressed={spotlight.has(props.player.id) ? "true" : "false"}
      onClick={() => {
        spotlight.toggle(props.player);
      }}
    >
      {props.player.name}
    </button>
  );
};

const samePart = (a: NamePart, b: NamePart) =>
  "text" in a
    ? "text" in b && a.text === b.text
    : "player" in b && a.player.id === b.player.id;

const Named = (props: { text: string; players: readonly LogPlayer[] }) => {
  const parts = createMemo(() => nameParts(props.text, props.players), {
    equals: (a, b) =>
      a.length === b.length &&
      a.every((part, index) => {
        const other = b[index];

        return other !== undefined && samePart(part, other);
      }),
  });

  return (
    <For each={parts()}>
      {(part) =>
        "text" in part ? part.text : <PlayerName player={part.player} />
      }
    </For>
  );
};

const Detail = (props: {
  detail: EventDetail;
  players: readonly LogPlayer[];
}) => (
  <Switch
    fallback={<Named text={detailText(props.detail)} players={props.players} />}
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
  now: number;
}) => {
  const copy = createMemo(
    () => eventDetailsWithMentions(props.entry, props.hasRoundHeading),
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
            <Named text={copy().outcome} players={props.entry.about} />
          </span>
          <For each={copy().details} keyed={(detail) => detailText(detail)}>
            {(detail) => (
              <>
                {" "}
                <span class="log-detail">
                  <Show when={detail().kind !== "points"}>{"·\u00A0"}</Show>
                  <Detail detail={detail()} players={props.entry.about} />
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
  now: number;
}) => (
  <>
    <Show when={!props.continuation}>
      <div class="log-message-header">
        <span class="log-author-line">
          <PlayerAvatar player={props.author} size="sm" />
          <PlayerName player={props.author} class="log-author" />
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

const ChatForm = (props: { chat: ChatControls; onSent: () => void }) => {
  const [text, setText] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  const message = createMemo(() => text().trim());
  const countId = createUniqueId();

  const submit = () => {
    const draft = message();

    if (draft === "") {
      return;
    }

    const sent = props.chat.send(draft);
    setFailed(!sent);

    if (sent) {
      setText("");
      props.onSent();
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
          props.chat.typing(value.trim() !== "");
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

const LogRound = (props: {
  group: LogGroup;
  continuations: ReadonlySet<number>;
  collapsible: boolean;
  playerId: string | null;
  newFrom: number | undefined;
  now: number;
}) => {
  const spotlight = useContext(SpotlightContext);
  const [open, setOpen] = createSignal(false);
  const collapsed = () => props.collapsible && !open();

  const shown = createMemo(() =>
    collapsed()
      ? props.group.entries.filter((entry) => entry.from !== undefined)
      : props.group.entries
  );

  const times = createMemo(() => shownTimes(shown()));

  const newInSummary = () =>
    collapsed() &&
    props.newFrom !== undefined &&
    props.group.entries.some(
      (entry) => entry.id === props.newFrom && entry.from === undefined
    );

  const rows = () => (
    <For each={shown()} keyed={(entry) => entry.id}>
      {(entry, index) => {
        const previous = () => shown()[index() - 1];

        const continuation = () => props.continuations.has(entry().id);

        const mine = createMemo(() => {
          const { playerId } = props;

          return (
            playerId !== null &&
            entry().from === undefined &&
            involves(entry(), playerId)
          );
        });

        const spotlit = createMemo(() =>
          involvedIds(entry()).some((id) => spotlight.has(id))
        );

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
              data-own={entry().from?.id === props.playerId ? "" : undefined}
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
  );

  return (
    <Collapsible
      class="log-group"
      open={!collapsed()}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <Show when={newInSummary()}>
        <div class="log-new">
          <span>New</span>
        </div>
      </Show>
      <Show when={props.group.heading}>
        {(heading) => (
          <div class="log-round-heading">
            <Show when={props.collapsible} fallback={<h3>{heading()}</h3>}>
              <h3>
                <CollapsibleTrigger
                  class="log-round-toggle"
                  data-variant="disclosure"
                >
                  <ChevronRight aria-hidden="true" size={12} />
                  {heading()}
                </CollapsibleTrigger>
              </h3>
            </Show>
            <ClockMinute
              at={oldGameMinute(props.group.entries[0], props.now)}
            />
          </div>
        )}
      </Show>
      <CollapsiblePanel keepMounted={props.collapsible}>
        <Show when={!collapsed() && shown().length > 0}>
          <ol>{rows()}</ol>
        </Show>
      </CollapsiblePanel>
      <Show when={collapsed() && shown().length > 0}>
        <ol>{rows()}</ol>
      </Show>
    </Collapsible>
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

interface ChatLogContentProps {
  /** Missing for a spectator, who can read the chat but not send to it. */
  chat?: ChatControls | undefined;
  players: readonly LogPlayer[];
  /** Other players typing a chat message, by player ID. */
  typing: readonly string[];
}

export interface ChatLogProps extends ChatLogContentProps {
  log: LogEntry[];
  playerId: string | null;
}

export const ChatLog = (
  props: ChatLogContentProps & { reads: ChatLogReads; inSheet?: boolean }
) => {
  const now = createPolled(Date.now, SECOND_MS);

  const continuations = createMemo(() => {
    const log = props.reads.log();
    const ids = new Set<number>();

    for (const [index, entry] of log.entries()) {
      if (continuesChat(entry, log[index - 1])) {
        ids.add(entry.id);
      }
    }

    return ids;
  });

  const groups = createMemo(() => groupLog(props.reads.visible()));

  const filterChats = () =>
    props.inSheet === true || props.reads.filter() === "Game"
      ? props.reads.unreadChats()
      : 0;

  const scroll = createScrollAreaController();

  const [spotlit, setSpotlit] = createSignal<LogPlayer | null>(null);

  const spotlitIds = createProjection<Record<string, true>>(() => {
    const id = spotlit()?.id;

    return id === undefined ? {} : { [id]: true };
  }, {});

  const spotlight: Spotlight = {
    has: (playerId) => spotlitIds[playerId],
    toggle: (player) => {
      setSpotlit((current) => (current?.id === player.id ? null : player));
    },
  };

  const typingNames = createMemo(
    () => {
      const typing = new Set(props.typing);

      return props.players.flatMap((player) =>
        typing.has(player.id) ? [player.name] : []
      );
    },
    {
      equals: (a, b) =>
        a.length === b.length && a.every((name, index) => name === b[index]),
    }
  );

  return (
    <SpotlightContext value={spotlight}>
      <section class={props.inSheet === true ? "stack" : "panel log"}>
        <Show when={props.inSheet !== true}>
          <h2>
            {CHAT_AND_GAME_LOG_TITLE}
            <Show
              when={
                props.reads.filter() !== "Game" && props.reads.unreadChats() > 0
              }
            >
              <span class="log-unread" aria-hidden="true">
                {props.reads.unreadChats()}
              </span>
            </Show>
          </h2>
          <output class="sr-only" aria-label="Unread chat messages">
            <Show when={props.reads.unreadChats() > 0}>
              {props.reads.unreadChats()} unread{" "}
              {props.reads.unreadChats() === 1 ? "message" : "messages"}
            </Show>
          </output>
        </Show>
        <SegmentedControl
          class="log-filters"
          aria-label="Filter activity"
          value={props.reads.filter()}
          onValueChange={(next) => {
            const option = LOG_FILTERS.find((candidate) => candidate === next);

            if (option !== undefined) {
              scroll.scrollToEnd({ behavior: "instant" });
              props.reads.setFilter(option);
            }
          }}
        >
          <SegmentedControlIndicator />
          <For each={LOG_FILTERS}>
            {(option) => (
              <SegmentedControlItem
                value={option}
                aria-label={
                  option === "Chat" && filterChats() > 0
                    ? `Chat, ${filterChats()} unread`
                    : undefined
                }
              >
                {option}
                <Show when={option === "Chat" && filterChats() > 0}>
                  <span class="log-unread" aria-hidden="true">
                    {filterChats()}
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
              () => ({ atEnd: state.atEnd, following: state.sticking }),
              (position) => {
                props.reads.setScrollPosition(position);
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
                        <p class="log-empty">
                          {EMPTY_MESSAGE[props.reads.filter()]}
                        </p>
                      }
                    >
                      <For each={groups()} keyed={(group) => group.id}>
                        {(group) => (
                          <LogRound
                            group={group()}
                            continuations={continuations()}
                            collapsible={
                              props.reads.filter() !== "Chat" &&
                              group().entries.some(
                                (entry) => entry.scores !== undefined
                              )
                            }
                            playerId={props.reads.playerId()}
                            newFrom={props.reads.newFrom()}
                            now={now()}
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
                    <Show when={props.reads.newEntries() > 0}>
                      {" "}
                      · {props.reads.newEntries()} new
                    </Show>
                  </ScrollAreaScrollToEnd>
                </div>
              </>
            );
          }}
        </ScrollArea>
        <div class="log-compose">
          <Show when={spotlit()}>
            {(player) => (
              <p class="log-spotlight">
                <span>
                  Highlighting <strong>{player().name}</strong>
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
            when={props.chat}
            fallback={<p class="muted chat-hint">Join as a player to chat.</p>}
          >
            {(chat) => (
              <ChatForm
                chat={chat()}
                onSent={() => {
                  props.reads.clearNewFrom();
                }}
              />
            )}
          </Show>
        </div>
      </section>
    </SpotlightContext>
  );
};

export default function GameLog(props: ChatLogProps) {
  const reads = createChatLogReads({
    log: () => props.log,
    playerId: () => props.playerId,
    shown: () => true,
  });

  return (
    <ChatLog
      reads={reads}
      chat={props.chat}
      players={props.players}
      typing={props.typing}
    />
  );
}
