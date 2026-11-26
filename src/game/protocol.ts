import * as v from "valibot";

import { projectActionCards } from "./action-card-resolution";
import { isAvatar } from "./avatars";
import { HELD_ACTION_KINDS, HIGHEST_NUMBER } from "./cards";
import { DEAL_HISTORY_LIMIT, DRAW_OUTCOMES, LOG_LIMIT, PHASES } from "./engine";
import type { DealEvent, GameState, HeldCard, LogEntry } from "./engine";
import { MAX_SPECTATORS } from "./moves";
import { applyListUpdate, listUpdateSince } from "./sequenced-list";
import type { ListSpec, ListUpdate, ReceivedList } from "./sequenced-list";
import { BOT_SPEEDS, TARGET_SCORES } from "./settings";
import { clipText } from "./text";

export const NAME_MAX_LENGTH = 20;
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";

/** How often a client pings the room to show it's still there. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** A socket that hasn't pinged for this long is treated as gone. */
export const HEARTBEAT_STALE_MS = 25_000;

/** The least time between typing starts sent by one browser. */
export const TYPING_SEND_MS = 3000;

/**
 * The least time between typing starts the room relays for one seat.
 * Shorter than `TYPING_SEND_MS`, so network jitter doesn't drop honest pings.
 */
export const TYPING_RELAY_MS = 2000;

/** How long a typing start remains active without another one. */
export const TYPING_SHOWN_MS = 5000;
export const ROOM_REMOVED_CLOSE_CODE = 4001;
export const ROOM_MISSING_CLOSE_CODE = 4002;
export const ROOM_PARTY = "game-room";

export const CODE_LENGTH = 5;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`, "u");

export const normalizeCode = (raw: string) => {
  const code = raw.trim().toUpperCase();

  return CODE_PATTERN.test(code) ? code : null;
};

const INVISIBLE_CHARACTERS = /\p{Cf}|(?!\s)\p{Cc}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const JOINS_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})[\p{L}\p{M}]/u;

const keepsJoiner = (joiner: string, before: string, after: string) =>
  (NON_LATIN_LETTER.test(before) && NON_LATIN_LETTER.test(after)) ||
  (joiner === "\u200D" &&
    JOINS_EMOJI.test(before) &&
    EXTENDED_PICTOGRAPHIC.test(after));

const visibleCharacters = (raw: string) => {
  const characters = raw.match(/./gsu) ?? [];

  return characters
    .filter((character, index) => {
      if (character !== "\u200C" && character !== "\u200D") {
        return !INVISIBLE_CHARACTERS.test(character);
      }

      return keepsJoiner(
        character,
        characters[index - 1] ?? "",
        characters[index + 1] ?? ""
      );
    })
    .join("");
};

/**
 * Strips characters a name can't show, keeping the joiners that hold an emoji
 * sequence or a non-Latin word together, then cuts it to `NAME_MAX_LENGTH`
 * characters as people see them.
 */
export const cleanName = (raw: string) =>
  clipText(
    visibleCharacters(raw).replaceAll(/\s+/gu, " ").trim(),
    NAME_MAX_LENGTH
  ).trim();

export interface RoomView extends Pick<
  GameState,
  | "choice"
  | "dealHistory"
  | "dealSeq"
  | "drawSeq"
  | "hostId"
  | "log"
  | "phase"
  | "players"
  | "round"
  | "settings"
  | "turnId"
  | "winnerIds"
> {
  code: string;
  dealerId: string | null;
  deckCount: number;
  discardCount: number;
  /** Flip Threes still under way, waiting on a choice. */
  flips: { targetId: string; remaining: number }[];
  held: HeldCard[];
  spectatorCount: number;
}

/** A round was dealt between two views of the room: a game started, or the next round began. */
export const roundStarted = (previous: RoomView, current: RoomView) =>
  current.phase !== "lobby" &&
  (previous.phase === "lobby" ||
    (previous.phase === "gameOver" && current.phase !== "gameOver") ||
    current.round !== previous.round);

/** The parts of the room view that are sent as new entries rather than in full. */
export type RoomLists = Pick<RoomView, "dealHistory" | "log">;

export type RoomListName = keyof RoomLists;

type ListEntry<K extends RoomListName> = RoomLists[K][number];

const ROOM_LISTS = {
  dealHistory: { limit: DEAL_HISTORY_LIMIT, seqOf: (event) => event.seq },
  log: { limit: LOG_LIMIT, seqOf: (entry) => entry.id },
} satisfies { [K in RoomListName]: ListSpec<ListEntry<K>> };

/** The room view as sent: everything but the lists, which come as updates. */
export type SentRoomView = Omit<RoomView, RoomListName>;

/** Each list's new entries since the previous state message. */
export type RoomListUpdates = { [K in RoomListName]: ListUpdate<ListEntry<K>> };

/** Each list's sequence number, to remember what a broadcast sent. */
export type ListSeqs = Record<RoomListName, number>;

/** A receiver's copy of each list, or null when it has none it can build on. */
export type ReceivedLists = {
  [K in RoomListName]: ReceivedList<ListEntry<K>> | null;
};

export const NO_LISTS: ReceivedLists = { dealHistory: null, log: null };

const SpectatorCountSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(MAX_SPECTATORS)
);

const RoomPreviewSchema = v.object({
  code: v.string(),
  locked: v.boolean(),
  phase: v.picklist(PHASES),
  players: v.array(
    v.object({
      avatar: v.nullable(v.number()),
      id: v.string(),
      name: v.string(),
    })
  ),
  spectatorCount: SpectatorCountSchema,
});

export type RoomPreview = v.InferOutput<typeof RoomPreviewSchema>;

const ListUpdateSchema = v.looseObject({
  after: v.nullable(v.pipe(v.number(), v.integer())),
  entries: v.array(v.unknown()),
  seq: v.pipe(v.number(), v.integer()),
});

const nonNegativeInteger = v.pipe(v.number(), v.integer(), v.minValue(0));

const cardFields = { id: nonNegativeInteger };

const HeldActionKindSchema = v.picklist(HELD_ACTION_KINDS);

export const HeldActionCardSchema = v.object({
  ...cardFields,
  kind: HeldActionKindSchema,
});

const SecondChanceCardSchema = v.object({
  ...cardFields,
  kind: v.literal("secondChance"),
});

export const ActionCardSchema = v.union([
  HeldActionCardSchema,
  SecondChanceCardSchema,
]);

export const CardSchema = v.union([
  ActionCardSchema,
  v.object({ ...cardFields, kind: v.literal("double") }),
  v.object({
    ...cardFields,
    kind: v.literal("number"),
    value: nonNegativeInteger,
  }),
  v.object({
    ...cardFields,
    kind: v.literal("modifier"),
    value: nonNegativeInteger,
  }),
]);

export const DealEventSchema: v.GenericSchema<unknown, DealEvent> = v.variant(
  "type",
  [
    v.object({
      card: CardSchema,
      flip: v.nullable(
        v.object({ index: nonNegativeInteger, total: nonNegativeInteger })
      ),
      hit: v.optional(v.literal(true)),
      outcome: v.picklist(DRAW_OUTCOMES),
      playerId: v.string(),
      seq: nonNegativeInteger,
      type: v.literal("draw"),
    }),
    v.object({
      card: HeldActionCardSchema,
      outcome: v.picklist(["played", "discarded"]),
      seq: nonNegativeInteger,
      targetId: v.string(),
      type: v.literal("heldAction"),
    }),
  ]
);

const DealHistoryUpdateSchema = v.object({
  ...ListUpdateSchema.entries,
  entries: v.array(DealEventSchema),
});

const LATEST_DATE_MS = 8_640_000_000_000_000;

const logPlayerFields = {
  id: v.pipe(v.string(), v.nonEmpty()),
  name: v.pipe(v.string(), v.nonEmpty(), v.maxGraphemes(NAME_MAX_LENGTH)),
};

const LogPlayerSchema = v.object(logPlayerFields);

const OptionalLogPlayerSchema = v.nullable(LogPlayerSchema);

const LoggedScoresSchema = v.array(
  v.object({ ...logPlayerFields, points: nonNegativeInteger })
);

const NumberCardValueSchema = v.pipe(
  nonNegativeInteger,
  v.maxValue(HIGHEST_NUMBER)
);

const OfflineMoverSchema = v.variant("kind", [
  v.object({ host: LogPlayerSchema, kind: v.literal("host") }),
  v.object({ kind: v.literal("game") }),
]);

const MoverSchema = v.variant("kind", [
  v.object({ kind: v.literal("player") }),
  ...OfflineMoverSchema.options,
]);

const eventOf = <const T extends string, const E extends v.ObjectEntries>(
  type: T,
  entries: E
) => v.object({ ...entries, type: v.literal(type) });

const GameEventSchema = v.variant("type", [
  eventOf("joined", {
    player: LogPlayerSchema,
    waitsFor: v.nullable(v.picklist(["round", "game"])),
  }),
  eventOf("botAdded", { player: LogPlayerSchema }),
  eventOf("evicted", {
    how: v.picklist(["kicked", "left", "leftToWatch"]),
    player: LogPlayerSchema,
  }),
  eventOf("hostChanged", { player: LogPlayerSchema }),
  eventOf("targetScoreSet", { targetScore: v.picklist(TARGET_SCORES) }),
  eventOf("botSpeedSet", { botSpeed: v.picklist(BOT_SPEEDS) }),
  eventOf("lockSet", { locked: v.boolean() }),
  eventOf("gameAbandoned", {}),
  eventOf("roundStarted", { dealer: OptionalLogPlayerSchema }),
  eventOf("deckReshuffled", {}),
  eventOf("outOfCards", {}),
  eventOf("stayed", {
    by: MoverSchema,
    player: LogPlayerSchema,
    points: nonNegativeInteger,
  }),
  eventOf("movedForOffline", {
    by: OfflineMoverSchema,
    move: v.picklist(["hit", "choose"]),
    player: LogPlayerSchema,
  }),
  eventOf("busted", { card: NumberCardValueSchema, player: LogPlayerSchema }),
  eventOf("flipSeven", { player: LogPlayerSchema }),
  eventOf("secondChanceKept", { player: LogPlayerSchema }),
  eventOf("secondChanceUsed", {
    card: NumberCardValueSchema,
    player: LogPlayerSchema,
  }),
  eventOf("secondChanceGiven", {
    by: OptionalLogPlayerSchema,
    target: LogPlayerSchema,
  }),
  eventOf("secondChanceDiscarded", { player: LogPlayerSchema }),
  eventOf("frozen", {
    by: OptionalLogPlayerSchema,
    points: nonNegativeInteger,
    target: LogPlayerSchema,
  }),
  eventOf("flipThreeStarted", {
    by: OptionalLogPlayerSchema,
    target: LogPlayerSchema,
  }),
  eventOf("actionAssigned", {
    by: OptionalLogPlayerSchema,
    card: HeldActionKindSchema,
    target: OptionalLogPlayerSchema,
  }),
  eventOf("heldActionsDiscarded", {
    cards: v.pipe(v.array(HeldActionKindSchema), v.nonEmpty()),
  }),
  eventOf("actionDiscarded", {
    card: HeldActionKindSchema,
    target: OptionalLogPlayerSchema,
  }),
  eventOf("roundOver", {
    scores: LoggedScoresSchema,
    tiedAt: v.nullable(nonNegativeInteger),
  }),
  eventOf("gameWon", {
    player: LogPlayerSchema,
    points: nonNegativeInteger,
    scores: LoggedScoresSchema,
  }),
]);

const logEntryFields = {
  at: v.pipe(nonNegativeInteger, v.maxValue(LATEST_DATE_MS)),
  game: nonNegativeInteger,
  id: nonNegativeInteger,
  round: nonNegativeInteger,
};

export const LogEntrySchema: v.GenericSchema<unknown, LogEntry> = v.union([
  v.object({
    ...logEntryFields,
    from: v.object({
      ...logPlayerFields,
      avatar: v.nullable(v.custom<number>(isAvatar)),
    }),
    text: v.string(),
  }),
  v.object({ ...logEntryFields, event: GameEventSchema }),
]);

const LogUpdateSchema = v.object({
  ...ListUpdateSchema.entries,
  entries: v.array(LogEntrySchema),
});

const StateMessageSchema = v.looseObject({
  lists: v.looseObject({
    dealHistory: DealHistoryUpdateSchema,
    log: LogUpdateSchema,
  }),
  room: v.looseObject({
    code: v.string(),
    dealSeq: nonNegativeInteger,
    drawSeq: nonNegativeInteger,
    hostId: v.nullable(v.string()),
    phase: v.picklist(PHASES),
    players: v.array(
      v.looseObject({
        bot: v.boolean(),
        connected: v.boolean(),
        hand: v.array(v.unknown()),
        id: v.string(),
        name: v.string(),
        score: v.number(),
      })
    ),
    round: v.pipe(v.number(), v.integer()),
    settings: v.looseObject({
      botSpeed: v.picklist(BOT_SPEEDS),
      locked: v.boolean(),
      targetScore: v.picklist(TARGET_SCORES),
    }),
    spectatorCount: SpectatorCountSchema,
  }),
});

export interface PreviewMessage {
  type: "preview";
  room: RoomPreview;
}

export const toRoomPreview = (
  code: string,
  state: GameState,
  spectatorCount: number
) =>
  ({
    room: {
      code,
      locked: state.settings.locked,
      phase: state.phase,
      players: state.players.map(({ avatar, id, name }) => ({
        avatar,
        id,
        name,
      })),
      spectatorCount,
    },
    type: "preview",
  }) satisfies PreviewMessage;

export type ServerMessage =
  | {
      lastRequestId?: string;
      playerId: string;
      token: string;
      type: "welcome";
    }
  | PreviewMessage
  | { type: "watching" }
  | { message: string; type: "watchError" }
  | { requestId: string; type: "accepted" }
  | { message: string; requestId: string; type: "rejected" }
  | { lists: RoomListUpdates; room: SentRoomView; type: "state" }
  | { active: boolean; playerId: string; type: "typing" }
  | { message: string; type: "error" };

export type StateMessage = Extract<ServerMessage, { type: "state" }>;

export const toRoomView = (
  code: string,
  state: GameState,
  spectatorCount = 0
) => {
  const { choice, flips, held } = projectActionCards(state);

  const view: RoomView = {
    choice,
    code,
    dealerId:
      state.phase === "lobby"
        ? null
        : (state.players[state.dealerIndex]?.id ?? null),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    dealHistory: state.dealHistory,
    dealSeq: state.dealSeq,
    drawSeq: state.drawSeq,
    flips,
    held,
    hostId: state.hostId,
    log: state.log,
    phase: state.phase,
    players: state.players.map((player) => ({ ...player })),
    round: state.round,
    settings: state.settings,
    spectatorCount,
    turnId: state.turnId,
    winnerIds: state.winnerIds,
  };

  return view;
};

/** The lists' sequence numbers now, to remember what a broadcast sent. */
export const listSeqsOf = (state: GameState) => {
  const seqs: ListSeqs = {
    dealHistory: state.dealSeq,
    log: state.logSeq,
  };

  return seqs;
};

/** A state message with each list sent since `since`, or in full where `since` doesn't say. */
export const toStateMessage = (
  code: string,
  state: GameState,
  since: Partial<ListSeqs> = {},
  spectatorCount = 0
) => {
  const { dealHistory, log, ...room } = toRoomView(code, state, spectatorCount);

  const message: ServerMessage = {
    lists: {
      dealHistory: listUpdateSince(
        { clearedAt: 0, entries: dealHistory, seq: state.dealSeq },
        since.dealHistory,
        ROOM_LISTS.dealHistory
      ),
      log: listUpdateSince(
        { clearedAt: state.logClearedAt, entries: log, seq: state.logSeq },
        since.log,
        ROOM_LISTS.log
      ),
    },
    room,
    type: "state",
  };

  return message;
};

/**
 * Rebuilds the full room view from a state message and the lists received so
 * far. A list whose update doesn't follow on from what was received keeps its
 * old entries and is named in `gaps`; ask the room for the full lists.
 */
export const receiveState = (
  received: ReceivedLists,
  message: StateMessage
) => {
  const gaps: RoomListName[] = [];

  const history = applyListUpdate(
    received.dealHistory,
    message.lists.dealHistory,
    ROOM_LISTS.dealHistory
  );

  const log = applyListUpdate(received.log, message.lists.log, ROOM_LISTS.log);

  if (!history) {
    gaps.push("dealHistory");
  }

  if (!log) {
    gaps.push("log");
  }

  const lists: ReceivedLists = {
    dealHistory: history ?? received.dealHistory,
    log: log ?? received.log,
  };

  const room: RoomView = {
    ...message.room,
    dealHistory: lists.dealHistory?.entries ?? [],
    log: lists.log?.entries ?? [],
  };

  return { gaps, lists, room };
};

export const parseServerMessage = (raw: string) => {
  try {
    // SAFETY: The room Worker serializes only typed ServerMessage values.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The Worker and browser share the wire type.
    const message = JSON.parse(raw) as ServerMessage | null;

    if (!message) {
      return null;
    }

    switch (message.type) {
      case "preview": {
        const result = v.safeParse(RoomPreviewSchema, message.room);

        return result.success
          ? { room: result.output, type: message.type }
          : null;
      }

      case "state": {
        return v.is(StateMessageSchema, message) ? message : null;
      }

      case "watchError": {
        return v.is(v.string(), message.message) ? message : null;
      }

      case "typing": {
        return v.is(v.string(), message.playerId) &&
          v.is(v.boolean(), message.active)
          ? message
          : null;
      }

      case "accepted":
      case "error":
      case "rejected":
      case "watching":
      case "welcome": {
        return message;
      }

      default: {
        return null;
      }
    }
  } catch {
    return null;
  }
};
