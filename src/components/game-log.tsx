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
import type { Signal } from "solid-js";

import { CHAT_MAX_LENGTH, isChat } from "../game/engine";
import type {
  ChatEntry,
  EventEntry,
  LogEntry,
  LogPlayer,
} from "../game/engine";
import { CHAT_TEXT_LIMIT, clipText, textLength } from "../game/text";
import type { ChatLogRound } from "../lib/chat-log-projection";
import { LOG_FILTERS } from "../lib/chat-log-reads";
import {
  detailText,
  eventCopy,
  HOUR_MS,
  involvedIds,
  involves,
  localTime,
  MINUTE_MS,
  sameCopy,
  SECOND_MS,
  timeLabel,
} from "../lib/game-log-entries";
import type {
  EventDetail,
  EventIconKey,
  NamePart,
} from "../lib/game-log-entries";
import type { RoomChatLog } from "../lib/room-chat-log";
import type { ChatControls } from "../lib/room-connection";
import { eventCue } from "../lib/room-cues";
import {
  ChatReactions,
  createReactionPicker,
  ReactionPicker,
  ReactionTrigger,
} from "./chat-reactions";
import type { ReactionPickerController } from "./chat-reactions";
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
  if (entry === undefined || isChat(entry) || entry.at > now - HOUR_MS) {
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
      dir="auto"
      title={props.player.name}
      aria-pressed={spotlight.has(props.player.id) ? "true" : "false"}
      onClick={() => {
        spotlight.toggle(props.player);
      }}
    >
      {props.player.name}
    </button>
  );
};

const Named = (props: { parts: readonly NamePart[] }) => (
  <For each={props.parts}>
    {(part) =>
      "text" in part ? part.text : <PlayerName player={part.player} />
    }
  </For>
);

const Detail = (props: { detail: EventDetail }) => (
  <Switch
    fallback={
      <Show when={props.detail.kind === "text" ? props.detail : undefined}>
        {(text) => <Named parts={text().parts} />}
      </Show>
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
  entry: EventEntry;
  hasRoundHeading: boolean;
  previous: LogEntry | undefined;
  showTime: boolean;
  now: number;
}) => {
  const copy = createMemo(() => eventCopy(props.entry, props.hasRoundHeading), {
    equals: sameCopy,
  });

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
            <Named parts={copy().outcome} />
          </span>
          <For each={copy().details} keyed={(detail) => detailText(detail)}>
            {(detail) => (
              <>
                {" "}
                <span class="log-detail">
                  <Show when={detail().kind !== "points"}>{"·\u00A0"}</Show>
                  <Detail detail={detail()} />
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
  entry: ChatEntry;
  continuation: boolean;
  now: number;
}) => (
  <>
    <Show when={!props.continuation}>
      <div class="log-message-header">
        <span class="log-author-line">
          <PlayerAvatar player={props.entry.from} size="sm" />
          <PlayerName player={props.entry.from} class="log-author" />
        </span>
        <LogTime at={props.entry.at} now={props.now} />
      </div>
    </Show>
    <span>
      <Show when={props.continuation}>
        <span class="sr-only">{props.entry.from.name}: </span>
      </Show>
      {props.entry.text}
    </span>
  </>
);

const CHAT_COUNT_FROM = CHAT_MAX_LENGTH - 40;

const ChatForm = (props: {
  chat: ChatControls;
  draft: Signal<string>;
  onSent: () => void;
}) => {
  const text = () => props.draft[0]();
  const [failed, setFailed] = createSignal(false);
  const message = createMemo(() => text().trim());
  const length = createMemo(() => textLength(text()));
  const countId = createUniqueId();

  const submit = () => {
    const draft = message();

    if (draft === "") {
      return;
    }

    const sent = props.chat.send(draft);
    setFailed(!sent);

    if (sent) {
      props.draft[1]("");
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
        onValueChange={(value, details) => {
          const next = clipText(value, CHAT_TEXT_LIMIT);

          if (next !== value && next === text()) {
            details.cancel();

            return;
          }

          props.draft[1](next);
          props.chat.typing(next.trim() !== "");
        }}
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
        hidden={length() < CHAT_COUNT_FROM}
        data-full={length() >= CHAT_MAX_LENGTH ? "" : undefined}
      >
        {length()}/{CHAT_MAX_LENGTH}
      </span>
      <output class="chat-send-status form-error">
        {failed() ? "Message not sent. Try again when reconnected." : ""}
      </output>
    </form>
  );
};

const LogRound = (props: {
  round: ChatLogRound;
  playerId: string | null;
  now: number;
  onUnfold: () => void;
  chatLog: RoomChatLog;
  picker: ReactionPickerController;
}) => {
  const spotlight = useContext(SpotlightContext);
  const [chosen, setChosen] = createSignal<boolean>();
  const view = createMemo(() => props.round.view(chosen()));

  const rows = () => (
    <For each={view().rows} keyed={(row) => row.entry.id}>
      {(row) => {
        const entry = () => row().entry;

        const message = () => {
          const current = entry();

          return isChat(current) ? current : undefined;
        };

        const happened = () => {
          const current = entry();

          return isChat(current) ? undefined : current;
        };

        const mine = createMemo(() => {
          const { playerId } = props;

          return (
            playerId !== null && !isChat(entry()) && involves(entry(), playerId)
          );
        });

        const spotlit = createMemo(() =>
          involvedIds(entry()).some((id) => spotlight.has(id))
        );

        return (
          <>
            <Show when={entry().id === view().newBeforeRow}>
              <li class="log-new">
                <span>New</span>
              </li>
            </Show>
            <li
              data-continuation={row().continuation ? "" : undefined}
              data-cue={eventCue(happened()?.event) ?? undefined}
              data-kind={message() ? "chat" : "game"}
              data-mine={mine() ? "" : undefined}
              data-own={message()?.from.id === props.playerId ? "" : undefined}
              data-spotlit={spotlit() ? "" : undefined}
            >
              <Switch>
                <Match when={message()}>
                  {(chat) => {
                    let trigger: HTMLButtonElement | undefined;

                    const picker = () =>
                      props.chatLog.chat() === undefined
                        ? undefined
                        : props.picker;

                    return (
                      <>
                        <div class="chat-bubble-row">
                          <div class="chat-bubble">
                            <ChatMessage
                              entry={chat()}
                              continuation={row().continuation}
                              now={props.now}
                            />
                          </div>
                          <Show when={picker()}>
                            {(controller) => (
                              <ReactionTrigger
                                messageId={chat().id}
                                picker={controller()}
                                triggerRef={(element) => {
                                  trigger = element;
                                }}
                              />
                            )}
                          </Show>
                        </div>
                        <ChatReactions
                          messageId={chat().id}
                          reactions={props.chatLog.reactions.of(chat().id)}
                          mine={props.chatLog.reactions.mine(chat().id)}
                          interactive={picker() !== undefined}
                          focusTrigger={() => {
                            trigger?.focus({ preventScroll: true });
                          }}
                          toggle={props.chatLog.reactions.toggle}
                        />
                      </>
                    );
                  }}
                </Match>
                <Match when={happened()}>
                  {(event) => (
                    <GameEvent
                      entry={event()}
                      hasRoundHeading={props.round.heading !== ""}
                      previous={row().previous}
                      showTime={row().showTime}
                      now={props.now}
                    />
                  )}
                </Match>
              </Switch>
            </li>
          </>
        );
      }}
    </For>
  );

  return (
    <Collapsible
      class="log-group"
      open={!view().collapsed}
      onOpenChange={(next) => {
        if (next) {
          props.onUnfold();
        }

        setChosen(next);
      }}
    >
      <Show when={view().newAboveHeading}>
        <div class="log-new">
          <span>New</span>
        </div>
      </Show>
      <Show when={props.round.heading}>
        {(heading) => (
          <div class="log-round-heading">
            <Show
              when={props.round.collapsible}
              fallback={<h3>{heading()}</h3>}
            >
              <h3>
                <CollapsibleTrigger
                  class="log-round-toggle"
                  data-size="sm"
                  data-variant="disclosure"
                >
                  <ChevronRight aria-hidden="true" size={12} />
                  {heading()}
                </CollapsibleTrigger>
              </h3>
            </Show>
            <ClockMinute at={oldGameMinute(props.round.first, props.now)} />
          </div>
        )}
      </Show>
      <CollapsiblePanel keepMounted={props.round.collapsible}>
        <Show when={!view().collapsed && view().rows.length > 0}>
          <ol>{rows()}</ol>
        </Show>
      </CollapsiblePanel>
      <Show when={view().collapsed && view().rows.length > 0}>
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

export const ChatLog = (props: { chatLog: RoomChatLog; inSheet?: boolean }) => {
  const now = createPolled(Date.now, SECOND_MS);
  const reads = () => props.chatLog.reads;
  const picker = createReactionPicker();

  createEffect(
    () =>
      reads().filter() !== "Game" &&
      (props.inSheet !== true || props.chatLog.sheetOpen()),
    (visible) => {
      if (!visible) {
        picker.close();
      }
    }
  );

  const rounds = () => props.chatLog.rounds();

  const filterChats = () =>
    props.inSheet === true || reads().filter() === "Game"
      ? reads().unreadChats()
      : 0;

  const scroll = createScrollAreaController();

  const [followsEnd, setFollowsEnd] = createSignal(true);

  const stayAboveUnfoldedRound = () => {
    if (!scroll.isSticking()) {
      return;
    }

    setFollowsEnd(false);
    requestAnimationFrame(() => {
      if (scroll.isAtEnd()) {
        setFollowsEnd(true);
      }
    });
  };

  const [spotlit, setSpotlit] = createSignal<LogPlayer | null>(null);

  const spotlitIds = createProjection<Partial<Record<string, true>>>(() => {
    const id = spotlit()?.id;

    return id === undefined ? {} : { [id]: true };
  }, {});

  const spotlight: Spotlight = {
    has: (playerId) => spotlitIds[playerId] === true,
    toggle: (player) => {
      setSpotlit((current) => (current?.id === player.id ? null : player));
    },
  };

  const typingNames = createMemo(
    () => {
      const typing = new Set(props.chatLog.typing());

      return props.chatLog
        .players()
        .flatMap((player) => (typing.has(player.id) ? [player.name] : []));
    },
    {
      equals: (a, b) =>
        a.length === b.length && a.every((name, index) => name === b[index]),
    }
  );

  return (
    <SpotlightContext value={spotlight}>
      <section
        class={["chat-log", props.inSheet === true ? "stack" : "panel log"]}
      >
        <Show when={props.inSheet !== true}>
          <h2>
            {CHAT_AND_GAME_LOG_TITLE}
            <Show
              when={reads().filter() !== "Game" && reads().unreadChats() > 0}
            >
              <span class="log-unread" aria-hidden="true">
                {reads().unreadChats()}
              </span>
            </Show>
          </h2>
          <output class="sr-only" aria-label="Unread chat messages">
            <Show when={reads().unreadChats() > 0}>
              {reads().unreadChats()} unread{" "}
              {reads().unreadChats() === 1 ? "message" : "messages"}
            </Show>
          </output>
        </Show>
        <SegmentedControl
          class="log-filters"
          aria-label="Filter activity"
          value={reads().filter()}
          onValueChange={(next) => {
            const option = LOG_FILTERS.find((candidate) => candidate === next);

            if (option !== undefined) {
              setFollowsEnd(true);
              scroll.scrollToEnd({ behavior: "instant" });
              reads().setFilter(option);
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
          stickToEnd={followsEnd()}
          controller={scroll}
        >
          {(state) => {
            createEffect(
              () => state.atEnd,
              (atEnd) => {
                if (atEnd) {
                  setFollowsEnd(true);
                }
              }
            );

            createEffect(
              () => ({ atEnd: state.atEnd, following: state.sticking }),
              (position) => {
                reads().setScrollPosition(position);
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
                      when={rounds().length > 0}
                      fallback={
                        <p class="log-empty">
                          {EMPTY_MESSAGE[reads().filter()]}
                        </p>
                      }
                    >
                      <For each={rounds()} keyed={(round) => round.id}>
                        {(round) => (
                          <LogRound
                            round={round()}
                            chatLog={props.chatLog}
                            picker={picker}
                            playerId={reads().playerId()}
                            now={now()}
                            onUnfold={stayAboveUnfoldedRound}
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
                    <Show when={reads().newEntries() > 0}>
                      {" "}
                      · {reads().newEntries()} new
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
                <span title={player().name}>
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
            when={props.chatLog.chat()}
            fallback={<p class="muted chat-hint">Join as a player to chat.</p>}
          >
            {(chat) => (
              <>
                <ChatForm
                  chat={chat()}
                  draft={props.chatLog.draft}
                  onSent={() => {
                    reads().clearNewFrom();
                  }}
                />
                <ReactionPicker
                  controller={picker}
                  mine={props.chatLog.reactions.mine}
                  toggle={props.chatLog.reactions.toggle}
                />
              </>
            )}
          </Show>
        </div>
      </section>
    </SpotlightContext>
  );
};

/** Chat & Log beside the page, when the layout leaves room for it. */
export default function ChatLogPanel(props: { chatLog: RoomChatLog }) {
  return (
    <Show when={!props.chatLog.inSheet()}>
      <ChatLog chatLog={props.chatLog} />
    </Show>
  );
}
