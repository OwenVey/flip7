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
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@ui-sdk/solid/scroll-area";
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
import PlayerAvatar from "./player-avatar";
import Tooltip from "./tooltip";

export const CHAT_AND_GAME_LOG_TITLE = "Chat & Log";

export const countChatsAfter = (
  log: LogEntry[],
  playerId: string | null,
  seenId: number
) =>
  log.filter(
    (entry) =>
      entry.id > seenId &&
      entry.from !== undefined &&
      entry.from.id !== playerId
  ).length;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const FILTERS = ["All", "Chat", "Game"] as const;

type LogFilter = (typeof FILTERS)[number];

const EMPTY_MESSAGE = {
  All: "Nothing has happened yet.",
  Chat: "No messages yet.",
  Game: "No game activity yet.",
};

const clockTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const exactTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const secondsFormat = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
});

const minutesFormat = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "minute",
  unitDisplay: "narrow",
});

interface LogGroup {
  id: number;
  heading: string;
  entries: LogEntry[];
}

const groupHeading = (entry: LogEntry) => {
  if (entry.round === 0) {
    return "Before the game";
  }

  const round = `Round ${entry.round}`;

  return entry.game > 1 ? `Game ${entry.game} · ${round}` : round;
};

const groupLog = (entries: LogEntry[]) => {
  const groups: LogGroup[] = [];
  let previous: LogEntry | undefined;

  for (const entry of entries) {
    const group = groups.at(-1);

    const roundChanged =
      previous?.round !== entry.round || previous?.game !== entry.game;

    if (group && !roundChanged) {
      group.entries.push(entry);
    } else {
      groups.push({
        entries: [entry],
        heading: groupHeading(entry),
        id: entry.id,
      });
    }

    previous = entry;
  }

  return groups;
};

type EventIcon = typeof Flame;

const cueIcons = {
  bank: Coins,
  bust: CircleX,
  freeze: Snowflake,
  join: UserPlus,
  special: PlayingCards,
  flipSeven: Flame,
};

const eventCopy = {
  bank: [
    [
      /^(?<player>.+) stayed and banked (?<points>\d+) points?\.$/u,
      "$<player> stayed",
      "+$<points> pts",
    ],
  ],
  bust: [
    [
      /^(?<player>.+) was dealt a duplicate (?<card>\d+) and busted\.$/u,
      "$<player> busted",
      "duplicate $<card>",
    ],
  ],
  freeze: [
    [
      /^(?<player>.+) played Freeze on themselves and banked (?<points>\d+) points?\.$/u,
      "$<player> froze themselves",
      "+$<points> pts",
    ],
    [
      /^(?<player>.+) played Freeze on (?<target>.+), who banked (?<points>\d+) points?\.$/u,
      "$<target> was frozen",
      "+$<points> pts · by $<player>",
    ],
  ],
  special: [
    [
      /^(?<player>.+) discarded Second Chance and a duplicate (?<card>\d+)\.$/u,
      "$<player> used Second Chance",
      "duplicate $<card>",
      Heart,
    ],
    [
      /^(?<player>.+) played Flip Three on (?<target>.+)\.$/u,
      "$<target> must flip three",
      "from $<player>",
      PlayingCardsFan,
    ],
    [
      /^(?<player>.+) assigned (?<card>Flip Three|Freeze) to (?<target>.+)\.$/u,
      "$<player> assigned $<card>",
      "to $<target>",
      ArrowRight,
    ],
    [
      /^(?<player>.+) gave a Second Chance to (?<target>.+)\.$/u,
      "$<target> got Second Chance",
      "from $<player>",
      Heart,
    ],
    [/^.+ must flip three cards\.$/u, "$&", undefined, PlayingCardsFan],
    [
      /^(?<player>.+) is holding a Second Chance\.$/u,
      "$<player> got a Second Chance",
      undefined,
      Heart,
    ],
  ],
  flipSeven: [
    [/^(?<player>.+) earned the Flip 7 bonus!$/u, "$<player> flipped 7!"],
  ],
} satisfies Partial<
  Record<NonNullable<LogEntry["cue"]>, [RegExp, string, string?, EventIcon?][]>
>;

const deckReshuffled = "The discard pile was shuffled into a new deck.";

const roundAnnouncement =
  /^Round \d+ (?:begins\. .+ deals\.|is over\.(?: Tied at \d+, so play continues\.)?)$/u;

const winnerAnnouncement = /^.+ wins with \d+ points!$/u;

const systemCopy = new Map([
  [deckReshuffled, "Deck rebuilt from the discard pile."],
  [
    "No cards are left to draw, so the round ends.",
    "Deck empty · round ended.",
  ],
]);

const eventDetails = (entry: LogEntry, hasRoundHeading: boolean) => {
  const roundPrefix = `Round ${entry.round} begins. `;

  if (hasRoundHeading && entry.text.startsWith(roundPrefix)) {
    return {
      announcement: true,
      detail: undefined,
      icon: PlayingCards,
      outcome: entry.text.slice(roundPrefix.length),
    };
  }

  const rules = entry.cue && entry.cue !== "join" ? eventCopy[entry.cue] : [];
  const cueIcon = entry.cue === undefined ? undefined : cueIcons[entry.cue];

  for (const [pattern, outcome, detail, icon] of rules) {
    if (pattern.test(entry.text)) {
      return {
        announcement: false,
        detail:
          detail === undefined
            ? undefined
            : entry.text.replace(pattern, detail),
        icon: icon ?? cueIcon,
        outcome: entry.text.replace(pattern, outcome),
      };
    }
  }

  let icon = cueIcon;

  if (entry.text === deckReshuffled) {
    icon = Shuffle;
  } else if (winnerAnnouncement.test(entry.text)) {
    icon = Trophy;
  }

  const systemText = systemCopy.get(entry.text);

  return {
    announcement:
      systemText !== undefined || roundAnnouncement.test(entry.text),
    detail: undefined,
    icon,
    outcome: systemText ?? entry.text,
  };
};

type EventDetails = ReturnType<typeof eventDetails>;

const sameDetails = (a: EventDetails, b: EventDetails) =>
  a.announcement === b.announcement &&
  a.detail === b.detail &&
  a.icon === b.icon &&
  a.outcome === b.outcome;

const timeLabel = (at: Date, now: number) => {
  const elapsed = Math.max(0, now - at.getTime());

  if (elapsed < MINUTE_MS) {
    const seconds = Math.floor(elapsed / SECOND_MS);
    const long = relativeTime.format(-seconds, "second");

    return {
      long,
      short: seconds === 0 ? long : secondsFormat.format(seconds),
    };
  }

  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);

    return {
      long: relativeTime.format(-minutes, "minute"),
      short: minutesFormat.format(minutes),
    };
  }

  return { long: exactTime.format(at), short: clockTime.format(at) };
};

const LogTime = (props: { at: number; now: () => number }) => {
  const time = createMemo(() => new Date(props.at));

  const label = createMemo(() => timeLabel(time(), props.now()), {
    equals: (a, b) => a.long === b.long && a.short === b.short,
  });

  return (
    <time
      aria-label={label().long}
      datetime={time().toISOString()}
      title={exactTime.format(time())}
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
          {clockTime.format(time())}
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

  const Icon = dynamic(() => copy().icon);

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
  const [atBottom, setAtBottom] = createSignal(true);

  const newEntries = createMemo(() =>
    atBottom() ? 0 : visible().filter((entry) => entry.id > seenId()).length
  );

  const unreadChats = createMemo(() =>
    filter() === "Game" || !atBottom()
      ? countChatsAfter(props.log, props.playerId, seenChatId())
      : 0
  );

  const hiddenChats = () => (filter() === "Game" ? unreadChats() : 0);

  const scroll = createScrollAreaController();
  let scroller: HTMLDivElement | undefined;

  const markSeen = (id: number, currentFilter: LogFilter) => {
    setSeenId(id);

    if (currentFilter !== "Game") {
      setSeenChatId((previous) => Math.max(previous, id));
    }
  };

  const pinToLatest = () => {
    setAtBottom(true);
    scroll.scrollToEnd({ behavior: "instant" });
    markSeen(latestId(), filter());
  };

  createEffect(
    () => ({ filter: filter(), id: latestId() }),
    ({ filter: currentFilter, id }) => {
      if (scroll.isSticking()) {
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
      <fieldset class="log-filters">
        <legend class="sr-only">Filter activity</legend>
        <For each={FILTERS}>
          {(option) => (
            <Button
              aria-label={
                option === "Chat" && hiddenChats() > 0
                  ? `Chat, ${hiddenChats()} unread`
                  : option
              }
              aria-pressed={filter() === option ? "true" : "false"}
              data-size="sm"
              data-variant={filter() === option ? "solid" : undefined}
              onClick={() => {
                if (filter() !== option) {
                  setAtBottom(true);
                  scroll.scrollToEnd({ behavior: "instant" });
                  setFilter(option);
                }
              }}
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
            </Button>
          )}
        </For>
      </fieldset>
      <ScrollArea class="log-body scroll-fades" stickToEnd controller={scroll}>
        <ScrollAreaViewport
          class="log-scroll"
          role="log"
          aria-label={CHAT_AND_GAME_LOG_TITLE}
          ref={(element) => {
            scroller = element;
          }}
          onScroll={() => {
            const bottom = scroll.isAtEnd();
            setAtBottom(bottom);

            if (bottom) {
              markSeen(latestId(), filter());
            }
          }}
        >
          <ScrollAreaContent class="log-entries">
            <Show
              when={groups().length > 0}
              fallback={<p class="log-empty">{EMPTY_MESSAGE[filter()]}</p>}
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
                      <For each={group().entries} keyed={(entry) => entry.id}>
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
        <Show when={!atBottom()}>
          <div class="log-jump">
            <Button
              data-size="sm"
              data-variant="solid"
              onClick={() => {
                scroller?.focus({ preventScroll: true });
                pinToLatest();
              }}
            >
              <ArrowDown aria-hidden="true" />
              Jump to latest
              <Show when={newEntries() > 0}> · {newEntries()} new</Show>
            </Button>
          </div>
        </Show>
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
