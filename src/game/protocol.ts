import * as v from "valibot";

import { projectActionCards } from "./action-card-resolution";
import { DRAW_LIMIT, LOG_LIMIT } from "./engine";
import type { DrawEvent, GameState, HeldCard, LogEntry } from "./engine";
import { MAX_SPECTATORS } from "./moves";
import { applyListUpdate, listUpdateSince } from "./sequenced-list";
import type { ListSpec, ListUpdate, ReceivedList } from "./sequenced-list";
import { BOT_SPEEDS, TARGET_SCORES } from "./settings";

export const NAME_MAX_LENGTH = 20;
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";

/** How often a client pings the room to show it's still there. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** A socket that hasn't pinged for this long is treated as gone. */
export const HEARTBEAT_STALE_MS = 25_000;
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

export const cleanName = (raw: string) =>
  raw.replaceAll(/\s+/gu, " ").trim().slice(0, NAME_MAX_LENGTH);

export interface RoomView extends Pick<
  GameState,
  | "choice"
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
  draws: DrawEvent[];
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
export interface RoomLists {
  draws: DrawEvent[];
  log: LogEntry[];
}

export type RoomListName = keyof RoomLists;

type ListEntry<K extends RoomListName> = RoomLists[K][number];

const ROOM_LISTS = {
  draws: { limit: DRAW_LIMIT, seqOf: (draw) => draw.seq },
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

export const NO_LISTS: ReceivedLists = { draws: null, log: null };

const SpectatorCountSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(MAX_SPECTATORS)
);

const RoomPreviewSchema = v.object({
  code: v.string(),
  locked: v.boolean(),
  phase: v.picklist(["lobby", "playing", "roundOver", "gameOver"]),
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

const StateMessageSchema = v.looseObject({
  lists: v.looseObject({ draws: ListUpdateSchema, log: ListUpdateSchema }),
  room: v.looseObject({
    code: v.string(),
    hostId: v.nullable(v.string()),
    phase: v.picklist(["lobby", "playing", "roundOver", "gameOver"]),
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
  | { message: string; type: "error" };

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
    draws: state.draws,
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
    draws: state.drawSeq,
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
  const { draws, log, ...room } = toRoomView(code, state, spectatorCount);

  const message: ServerMessage = {
    lists: {
      draws: listUpdateSince(
        { clearedAt: 0, entries: draws, seq: state.drawSeq },
        since.draws,
        ROOM_LISTS.draws
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
  message: Extract<ServerMessage, { type: "state" }>
) => {
  const gaps: RoomListName[] = [];

  const draws = applyListUpdate(
    received.draws,
    message.lists.draws,
    ROOM_LISTS.draws
  );

  const log = applyListUpdate(received.log, message.lists.log, ROOM_LISTS.log);

  if (!draws) {
    gaps.push("draws");
  }

  if (!log) {
    gaps.push("log");
  }

  const lists: ReceivedLists = {
    draws: draws ?? received.draws,
    log: log ?? received.log,
  };

  const room: RoomView = {
    ...message.room,
    draws: lists.draws?.entries ?? [],
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
