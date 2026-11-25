import type { HeldActionKind } from "../game/cards";
import { isChat } from "../game/engine";
import type { EventEntry, LogEntry } from "../game/engine";
import { eventPlayers } from "../game/game-events";
import type { GameEvent, LogPlayer } from "../game/game-events";

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export const continuesChat = (entry: LogEntry, previous?: LogEntry) =>
  isChat(entry) &&
  previous !== undefined &&
  isChat(previous) &&
  previous.from.id === entry.from.id &&
  previous.game === entry.game &&
  previous.round === entry.round &&
  entry.at - previous.at < MINUTE_MS;

export const countChatsAfter = (
  log: LogEntry[],
  playerId: string | null,
  seenId: number
) =>
  log.filter(
    (entry) => entry.id > seenId && isChat(entry) && entry.from.id !== playerId
  ).length;

export interface LogGroup {
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

export const groupLog = (entries: LogEntry[]) => {
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

/** Names an icon; the Chat & Log maps each one to its component. */
export type EventIconKey =
  | "arrow-right"
  | "circle-x"
  | "coins"
  | "flame"
  | "heart"
  | "lock"
  | "lock-open"
  | "playing-cards"
  | "playing-cards-fan"
  | "shuffle"
  | "snowflake"
  | "trophy"
  | "user-plus";

/** Words, or a player named by them, as an event's copy shows them. */
export type NamePart = { text: string } | { player: LogPlayer };

const phrase = (
  strings: TemplateStringsArray,
  ...values: (LogPlayer | string | number)[]
) => {
  const parts: NamePart[] = [];

  const addText = (text: string) => {
    const last = parts.at(-1);

    if (text === "") {
      return;
    }

    if (last !== undefined && "text" in last) {
      parts[parts.length - 1] = { text: last.text + text };
    } else {
      parts.push({ text });
    }
  };

  for (const [index, value] of values.entries()) {
    addText(strings[index] ?? "");

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Players become names; anything else is text.
    if (typeof value === "object") {
      parts.push({ player: value });
    } else {
      addText(String(value));
    }
  }

  addText(strings.at(-1) ?? "");

  return parts;
};

/** The words in some name parts, as a screen reader reads them. */
export const partsText = (parts: readonly NamePart[]) =>
  parts.map((part) => ("text" in part ? part.text : part.player.name)).join("");

const samePart = (a: NamePart, b: NamePart) =>
  "text" in a
    ? "text" in b && a.text === b.text
    : "player" in b &&
      a.player.id === b.player.id &&
      a.player.name === b.player.name;

const sameList = <T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean
) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];

    return other !== undefined && same(item, other);
  });

const sameParts = (a: readonly NamePart[], b: readonly NamePart[]) =>
  sameList(a, b, samePart);

/** A detail after an event's outcome: words, a number card with a label, or banked points. */
export type EventDetail =
  | { kind: "text"; parts: NamePart[] }
  | { kind: "card"; label: string; number: number }
  | { kind: "points"; points: number };

/** A detail as plain words, for a summary or a screen reader. */
export const detailText = (detail: EventDetail) => {
  switch (detail.kind) {
    case "card": {
      return `${detail.label} ${detail.number}`;
    }

    case "points": {
      return `+${detail.points} ${detail.points === 1 ? "pt" : "pts"}`;
    }

    case "text": {
      return partsText(detail.parts);
    }

    default: {
      return detail satisfies never;
    }
  }
};

const sameDetail = (a: EventDetail, b: EventDetail) =>
  a.kind === "text" && b.kind === "text"
    ? sameParts(a.parts, b.parts)
    : detailText(a) === detailText(b);

/** How the Chat & Log shows a game event. */
export interface EventCopy {
  /** Set on events about the table rather than a player, which the log sets apart. */
  announcement: boolean;
  details: EventDetail[];
  icon: EventIconKey | undefined;
  outcome: NamePart[];
}

export const sameCopy = (a: EventCopy, b: EventCopy) =>
  a.announcement === b.announcement &&
  sameList(a.details, b.details, sameDetail) &&
  a.icon === b.icon &&
  sameParts(a.outcome, b.outcome);

const points = (scored: number) =>
  ({ kind: "points", points: scored }) satisfies EventDetail;

const duplicate = (number: number) =>
  ({ kind: "card", label: "duplicate", number }) satisfies EventDetail;

const words = (parts: NamePart[]) =>
  ({ kind: "text", parts }) satisfies EventDetail;

const happened = (
  outcome: NamePart[],
  icon?: EventIconKey,
  details: EventDetail[] = []
) => ({ announcement: false, details, icon, outcome }) satisfies EventCopy;

const announced = (outcome: NamePart[], icon?: EventIconKey) =>
  ({ announcement: true, details: [], icon, outcome }) satisfies EventCopy;

const CARD_NAMES = {
  flipThree: "Flip Three",
  freeze: "Freeze",
} as const satisfies Record<HeldActionKind, string>;

const someone = (player: LogPlayer | null) => player ?? "Someone";

const stayCopy = (event: Extract<GameEvent, { type: "stayed" }>) => {
  const { by, player } = event;

  switch (by.kind) {
    case "player": {
      return happened(phrase`${player} stayed`, "coins", [
        points(event.points),
      ]);
    }

    case "host": {
      return happened(phrase`${by.host} stayed for ${player}`, "coins", [
        points(event.points),
        words(phrase`${player} is offline`),
      ]);
    }

    case "game": {
      return happened(phrase`The game stayed for ${player}`, "coins", [
        points(event.points),
        words(phrase`${player} is offline`),
      ]);
    }

    default: {
      return by satisfies never;
    }
  }
};

const movedForOfflineCopy = (
  event: Extract<GameEvent, { type: "movedForOffline" }>
) => {
  const { by, player } = event;

  if (by.kind === "game") {
    return happened(
      event.move === "hit"
        ? phrase`${player} is offline and has no cards, so the game hit for them.`
        : phrase`${player} is offline, so the game played their card.`
    );
  }

  return happened(
    event.move === "hit"
      ? phrase`${by.host} hit for ${player}, who is offline.`
      : phrase`${by.host} chose for ${player}, who is offline.`
  );
};

const actionAssignedCopy = (
  event: Extract<GameEvent, { type: "actionAssigned" }>
) => {
  const { by, target } = event;
  const toSelf = by !== null && by.id === target?.id;

  return happened(
    phrase`${someone(by)} assigned ${CARD_NAMES[event.card]}`,
    "arrow-right",
    [words(toSelf ? phrase`to themselves` : phrase`to ${target ?? "someone"}`)]
  );
};

const heldActionsDiscardedCopy = (cards: HeldActionKind[]) => {
  const names = cards.map((card) => CARD_NAMES[card]).join(" and ");
  const verb = cards.length === 1 ? "was" : "were";

  return happened(
    phrase`${names} set aside during the Flip Three ${verb} discarded.`
  );
};

/**
 * How the Chat & Log words and shows a game event. Under a round heading, a
 * round's first event leaves out the round it begins.
 */
// oxlint-disable-next-line eslint/complexity -- One case per game event keeps each event's wording in one place.
export const eventCopy = (entry: EventEntry, hasRoundHeading: boolean) => {
  const { event } = entry;

  switch (event.type) {
    case "joined": {
      return happened(
        event.waitsFor === null
          ? phrase`${event.player} joined.`
          : phrase`${event.player} joined and will play in the next ${event.waitsFor}.`,
        "user-plus"
      );
    }

    case "botAdded": {
      return happened(
        phrase`The host added ${event.player}, a bot.`,
        "user-plus"
      );
    }

    case "evicted": {
      const how = {
        kicked: " was removed by the host.",
        left: " left.",
        leftToWatch: " left to watch.",
      }[event.how];

      return happened(phrase`${event.player}${how}`);
    }

    case "hostChanged": {
      return happened(phrase`${event.player} is now the host.`);
    }

    case "targetScoreSet": {
      return happened(
        phrase`The host set the winning score to ${event.targetScore}.`
      );
    }

    case "botSpeedSet": {
      return happened(
        event.botSpeed === "fast"
          ? phrase`The host sped up the bots.`
          : phrase`The host set the bots back to normal speed.`
      );
    }

    case "lockSet": {
      return event.locked
        ? happened(phrase`Room locked.`, "lock")
        : happened(phrase`Room unlocked.`, "lock-open");
    }

    case "gameAbandoned": {
      return happened(phrase`Not enough players left, so the game ended.`);
    }

    case "roundStarted": {
      const dealer = someone(event.dealer);

      return hasRoundHeading
        ? announced(phrase`${dealer} deals.`, "playing-cards")
        : announced(phrase`Round ${entry.round} begins. ${dealer} deals.`);
    }

    case "deckReshuffled": {
      return announced(phrase`Deck rebuilt from the discard pile.`, "shuffle");
    }

    case "outOfCards": {
      return announced(phrase`Deck empty · round ended.`);
    }

    case "stayed": {
      return stayCopy(event);
    }

    case "movedForOffline": {
      return movedForOfflineCopy(event);
    }

    case "busted": {
      return happened(phrase`${event.player} busted`, "circle-x", [
        duplicate(event.card),
      ]);
    }

    case "flipSeven": {
      return happened(phrase`${event.player} flipped 7!`, "flame");
    }

    case "secondChanceKept": {
      return happened(phrase`${event.player} got a Second Chance`, "heart");
    }

    case "secondChanceUsed": {
      return happened(phrase`${event.player} used Second Chance`, "heart", [
        duplicate(event.card),
      ]);
    }

    case "secondChanceGiven": {
      return happened(phrase`${event.target} got Second Chance`, "heart", [
        words(phrase`from ${someone(event.by)}`),
      ]);
    }

    case "secondChanceDiscarded": {
      return happened(
        phrase`${event.player} discarded an extra Second Chance.`
      );
    }

    case "frozen": {
      return event.by?.id === event.target.id
        ? happened(phrase`${event.target} froze themselves`, "snowflake", [
            points(event.points),
          ])
        : happened(phrase`${event.target} was frozen`, "snowflake", [
            points(event.points),
            words(phrase`by ${someone(event.by)}`),
          ]);
    }

    case "flipThreeStarted": {
      return event.by?.id === event.target.id
        ? happened(
            phrase`${event.target} must flip three cards.`,
            "playing-cards-fan"
          )
        : happened(
            phrase`${event.target} must flip three`,
            "playing-cards-fan",
            [words(phrase`from ${someone(event.by)}`)]
          );
    }

    case "actionAssigned": {
      return actionAssignedCopy(event);
    }

    case "heldActionsDiscarded": {
      return heldActionsDiscardedCopy(event.cards);
    }

    case "actionDiscarded": {
      return happened(
        phrase`${CARD_NAMES[event.card]} for ${event.target ?? "a player who left"} was discarded, since they're out of the round.`
      );
    }

    case "roundOver": {
      return announced(
        event.tiedAt === null
          ? phrase`Round ${entry.round} is over.`
          : phrase`Round ${entry.round} is over. Tied at ${event.tiedAt}, so play continues.`
      );
    }

    case "gameWon": {
      return happened(
        phrase`${event.player} wins with ${event.points} points!`,
        "trophy"
      );
    }

    default: {
      return event satisfies never;
    }
  }
};

/** The players an entry is about: who sent a chat, or whom an event names. */
export const involvedIds = (entry: LogEntry) =>
  isChat(entry)
    ? [entry.from.id]
    : eventPlayers(entry.event).map((player) => player.id);

/** Whether an entry is about this player. */
export const involves = (entry: LogEntry, playerId: string) =>
  involvedIds(entry).includes(playerId);

/**
 * The entries that show their time. A chat run shows it once in its header;
 * game events show it when a minute has passed since the last time shown, or
 * after a chat.
 */
export const shownTimes = (entries: readonly LogEntry[]) => {
  const shown = new Set<number>();
  let lastShown: number | undefined;
  let previous: LogEntry | undefined;

  for (const entry of entries) {
    if (isChat(entry)) {
      if (!continuesChat(entry, previous)) {
        shown.add(entry.id);
      }

      lastShown = undefined;
    } else if (lastShown === undefined || entry.at - lastShown >= MINUTE_MS) {
      shown.add(entry.id);
      lastShown = entry.at;
    }

    previous = entry;
  }

  return shown;
};

export const timeFormats = (locale?: string) =>
  ({
    clock: new Intl.DateTimeFormat(locale, { timeStyle: "short" }),
    exact: new Intl.DateTimeFormat(locale, { timeStyle: "medium" }),
    minutes: new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "minute",
      unitDisplay: "narrow",
    }),
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    seconds: new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
    }),
  }) satisfies Record<
    string,
    Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat
  >;

/** The viewer's own locale. */
export const localTime = timeFormats();

export const timeLabel = (at: Date, now: number, formats = localTime) => {
  const elapsed = Math.max(0, now - at.getTime());

  if (elapsed < MINUTE_MS) {
    const seconds = Math.floor(elapsed / SECOND_MS);
    const long = formats.relative.format(-seconds, "second");

    return {
      long,
      short: seconds === 0 ? long : formats.seconds.format(seconds),
    };
  }

  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);

    return {
      long: formats.relative.format(-minutes, "minute"),
      short: formats.minutes.format(minutes),
    };
  }

  return { long: formats.exact.format(at), short: formats.clock.format(at) };
};
