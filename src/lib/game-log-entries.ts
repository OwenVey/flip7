import type { LogEntry } from "../game/engine";

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

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

export const groupHeading = (entry: LogEntry) => {
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

export type EventRule = [RegExp, string, string?, EventIconKey?];

export const eventCopy = {
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
  flipSeven: [
    [/^(?<player>.+) earned the Flip 7 bonus!$/u, "$<player> flipped 7!"],
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
      "heart",
    ],
    [
      /^(?<player>.+) played Flip Three on (?<target>.+)\.$/u,
      "$<target> must flip three",
      "from $<player>",
      "playing-cards-fan",
    ],
    [
      /^(?<player>.+) assigned (?<card>Flip Three|Freeze) to (?<target>.+)\.$/u,
      "$<player> assigned $<card>",
      "to $<target>",
      "arrow-right",
    ],
    [
      /^(?<player>.+) gave a Second Chance to (?<target>.+)\.$/u,
      "$<target> got Second Chance",
      "from $<player>",
      "heart",
    ],
    [/^.+ must flip three cards\.$/u, "$&", undefined, "playing-cards-fan"],
    [
      /^(?<player>.+) is holding a Second Chance\.$/u,
      "$<player> got a Second Chance",
      undefined,
      "heart",
    ],
  ],
} satisfies Partial<Record<Cue, EventRule[]>>;

export const deckReshuffled = "The discard pile was shuffled into a new deck.";

export const roundAnnouncement =
  /^Round \d+ (?:begins\. .+ deals\.|is over\.(?: Tied at \d+, so play continues\.)?)$/u;

export const winnerAnnouncement = /^.+ wins with \d+ points!$/u;

export const systemCopy = new Map([
  [deckReshuffled, "Deck rebuilt from the discard pile."],
  [
    "No cards are left to draw, so the round ends.",
    "Deck empty · round ended.",
  ],
]);

interface LogEventCopy {
  announcement: boolean;
  detail: string | undefined;
  icon: EventIconKey | undefined;
  outcome: string;
}

export const eventDetails = (entry: LogEntry, hasRoundHeading: boolean) => {
  const roundPrefix = `Round ${entry.round} begins. `;

  if (hasRoundHeading && entry.text.startsWith(roundPrefix)) {
    return {
      announcement: true,
      detail: undefined,
      icon: "playing-cards",
      outcome: entry.text.slice(roundPrefix.length),
    } satisfies LogEventCopy;
  }

  const rules: EventRule[] =
    entry.cue && entry.cue !== "join" ? eventCopy[entry.cue] : [];

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
      } satisfies LogEventCopy;
    }
  }

  let icon: EventIconKey | undefined = cueIcon;

  if (entry.text === deckReshuffled) {
    icon = "shuffle";
  } else if (winnerAnnouncement.test(entry.text)) {
    icon = "trophy";
  }

  const systemText = systemCopy.get(entry.text);

  return {
    announcement:
      systemText !== undefined || roundAnnouncement.test(entry.text),
    detail: undefined,
    icon,
    outcome: systemText ?? entry.text,
  } satisfies LogEventCopy;
};

export type EventDetails = ReturnType<typeof eventDetails>;

export const sameDetails = (a: EventDetails, b: EventDetails) =>
  a.announcement === b.announcement &&
  a.detail === b.detail &&
  a.icon === b.icon &&
  a.outcome === b.outcome;

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
