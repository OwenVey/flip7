import { LOG_TEXT } from "../game/engine";
import type { LogEntry, LogPlayer } from "../game/engine";

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export const continuesChat = (entry: LogEntry, previous?: LogEntry) =>
  entry.from !== undefined &&
  previous?.from?.id === entry.from.id &&
  previous.game === entry.game &&
  previous.round === entry.round &&
  entry.at - previous.at < MINUTE_MS;

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

type Cue = NonNullable<LogEntry["cue"]>;

const cueIcons = {
  bank: "coins",
  bust: "circle-x",
  flipSeven: "flame",
  freeze: "snowflake",
  join: "user-plus",
  special: "playing-cards",
} satisfies Record<Cue, EventIconKey>;

/** A detail template: plain text, a number card with a label, or banked points. */
type DetailSpec =
  | { text: string }
  | { card: string; label: string }
  | { points: string };

type EventRule = [RegExp, string, (readonly DetailSpec[])?, EventIconKey?];

export type EventDetail =
  | { kind: "text"; text: string }
  | { kind: "card"; label: string; number: number }
  | { kind: "points"; points: number };

export const eventCopy = {
  bank: [
    [
      /^(?<player>.+) stayed and banked (?<points>\d+) points?\.$/u,
      "$<player> stayed",
      [{ points: "$<points>" }],
    ],
    [
      /^(?<host>.+) stayed for (?<player>.+), who is offline, and banked (?<points>\d+) points?\.$/u,
      "$<host> stayed for $<player>",
      [{ points: "$<points>" }, { text: "$<player> is offline" }],
    ],
    [
      /^(?<player>.+) is offline, so the game stayed for them and banked (?<points>\d+) points?\.$/u,
      "The game stayed for $<player>",
      [{ points: "$<points>" }, { text: "$<player> is offline" }],
    ],
  ],
  bust: [
    [
      /^(?<player>.+) was dealt a duplicate (?<card>\d+) and busted\.$/u,
      "$<player> busted",
      [{ card: "$<card>", label: "duplicate" }],
    ],
  ],
  flipSeven: [
    [/^(?<player>.+) earned the Flip 7 bonus!$/u, "$<player> flipped 7!"],
  ],
  freeze: [
    [
      /^(?<player>.+) played Freeze on themselves and banked (?<points>\d+) points?\.$/u,
      "$<player> froze themselves",
      [{ points: "$<points>" }],
    ],
    [
      /^(?<player>.+) played Freeze on (?<target>.+), who banked (?<points>\d+) points?\.$/u,
      "$<target> was frozen",
      [{ points: "$<points>" }, { text: "by $<player>" }],
    ],
  ],
  special: [
    [
      /^(?<player>.+) discarded Second Chance and a duplicate (?<card>\d+)\.$/u,
      "$<player> used Second Chance",
      [{ card: "$<card>", label: "duplicate" }],
      "heart",
    ],
    [
      /^(?<player>.+) played Flip Three on (?<target>.+)\.$/u,
      "$<target> must flip three",
      [{ text: "from $<player>" }],
      "playing-cards-fan",
    ],
    [
      /^(?<player>.+) assigned (?<card>Flip Three|Freeze) to (?<target>.+)\.$/u,
      "$<player> assigned $<card>",
      [{ text: "to $<target>" }],
      "arrow-right",
    ],
    [
      /^(?<player>.+) gave a Second Chance to (?<target>.+)\.$/u,
      "$<target> got Second Chance",
      [{ text: "from $<player>" }],
      "heart",
    ],
    [
      /^(?<player>.+) must flip three cards\.$/u,
      "$&",
      undefined,
      "playing-cards-fan",
    ],
    [
      /^(?<player>.+) is holding a Second Chance\.$/u,
      "$<player> got a Second Chance",
      undefined,
      "heart",
    ],
  ],
} satisfies Partial<Record<Cue, EventRule[]>>;

const fillDetail = (text: string, pattern: RegExp, spec: DetailSpec) => {
  const fill = (template: string) => text.replace(pattern, template);

  if ("points" in spec) {
    return {
      kind: "points",
      points: Number(fill(spec.points)),
    } satisfies EventDetail;
  }

  if ("card" in spec) {
    return {
      kind: "card",
      label: spec.label,
      number: Number(fill(spec.card)),
    } satisfies EventDetail;
  }

  return { kind: "text", text: fill(spec.text) } satisfies EventDetail;
};

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
      return detail.text;
    }

    default: {
      return detail satisfies never;
    }
  }
};

const systemIcons = new Map<string, EventIconKey>([
  [LOG_TEXT.deckReshuffled, "shuffle"],
  [LOG_TEXT.roomLocked, "lock"],
  [LOG_TEXT.roomUnlocked, "lock-open"],
]);

export const roundAnnouncement =
  /^Round \d+ (?:begins\. .+ deals\.|is over\.(?: Tied at \d+, so play continues\.)?)$/u;

export const winnerAnnouncement = /^.+ wins with \d+ points!$/u;

export const systemCopy = new Map<string, string>([
  [LOG_TEXT.deckReshuffled, "Deck rebuilt from the discard pile."],
  [LOG_TEXT.outOfCards, "Deck empty · round ended."],
]);

interface LogEventCopy {
  announcement: boolean;
  details: EventDetail[];
  icon: EventIconKey | undefined;
  outcome: string;
}

export const eventDetails = (
  entry: LogEntry,
  hasRoundHeading: boolean,
  text = entry.text
) => {
  const roundPrefix = `Round ${entry.round} begins. `;

  if (hasRoundHeading && text.startsWith(roundPrefix)) {
    return {
      announcement: true,
      details: [],
      icon: "playing-cards",
      outcome: text.slice(roundPrefix.length),
    } satisfies LogEventCopy;
  }

  const rules: EventRule[] =
    entry.cue && entry.cue !== "join" ? eventCopy[entry.cue] : [];

  const cueIcon = entry.cue === undefined ? undefined : cueIcons[entry.cue];

  for (const [pattern, outcome, details = [], icon] of rules) {
    if (pattern.test(text)) {
      return {
        announcement: false,
        details: details.map((detail) => fillDetail(text, pattern, detail)),
        icon: icon ?? cueIcon,
        outcome: text.replace(pattern, outcome),
      } satisfies LogEventCopy;
    }
  }

  const icon = winnerAnnouncement.test(text)
    ? "trophy"
    : (systemIcons.get(text) ?? cueIcon);

  const systemText = systemCopy.get(text);

  return {
    announcement: systemText !== undefined || roundAnnouncement.test(text),
    details: [],
    icon,
    outcome: systemText ?? text,
  } satisfies LogEventCopy;
};

type EventDetails = ReturnType<typeof eventDetails>;

const sameList = <T>(a: T[], b: T[], same: (x: T, y: T) => boolean) =>
  a.length === b.length && a.every((item, index) => same(item, b[index]));

export const sameDetails = (a: EventDetails, b: EventDetails) =>
  a.announcement === b.announcement &&
  sameList(a.details, b.details, (x, y) => detailText(x) === detailText(y)) &&
  a.icon === b.icon &&
  a.outcome === b.outcome;

/** The players an entry is about: who sent a chat, or whom an event names. */
export const involvedIds = (entry: LogEntry) => [
  ...(entry.from === undefined ? [] : [entry.from.id]),
  ...entry.about.map((player) => player.id),
];

/** Whether an entry is about this player. */
export const involves = (entry: LogEntry, playerId: string) =>
  involvedIds(entry).includes(playerId);

export type NamePart = { text: string } | { player: LogPlayer };

const mentionToken = /\uE000(?<index>\d+)\uE000/gu;

/** Keeps name positions through copy rules that can move mentions into a detail. */
export const eventDetailsWithMentions = (
  entry: LogEntry,
  hasRoundHeading: boolean
) => {
  let text = "";
  let offset = 0;

  for (const [index, mention] of entry.about.entries()) {
    text += entry.text.slice(offset, mention.offset);
    text += `\uE000${index}\uE000`;
    offset = mention.offset + mention.name.length;
  }

  return eventDetails(entry, hasRoundHeading, text + entry.text.slice(offset));
};

export const nameParts = (text: string, players: readonly LogPlayer[]) => {
  const parts: NamePart[] = [];
  let offset = 0;

  for (const match of text.matchAll(mentionToken)) {
    const player = players[Number(match.groups?.index)];

    if (player === undefined) {
      continue;
    }

    if (match.index > offset) {
      parts.push({ text: text.slice(offset, match.index) });
    }

    parts.push({ player });
    offset = match.index + match[0].length;
  }

  if (offset < text.length) {
    parts.push({ text: text.slice(offset) });
  }

  return parts;
};

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
    if (entry.from !== undefined) {
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
