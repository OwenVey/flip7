import * as v from "valibot";

import { isAvatar } from "../src/game/avatars";
import { ReactionEmojiSchema } from "../src/game/chat-reactions";
import { PHASES } from "../src/game/engine";
import type { GameState } from "../src/game/engine";
import { ROUND_STATUSES } from "../src/game/player";
import {
  ActionCardSchema,
  CardSchema,
  DealEventSchema,
  HeldActionCardSchema,
  LogEntrySchema,
  normalizeCode,
  WinnerSchema,
} from "../src/game/protocol";
import type { StoredRoom } from "../src/game/room";
import { RoomSettingsSchema } from "../src/game/settings";

const integer = v.pipe(v.number(), v.safeInteger());
const nonNegativeInteger = v.pipe(integer, v.minValue(0));
const idList = v.array(v.string());
const nullableId = v.nullable(v.string());
const cards = v.array(CardSchema);

const QueuedActionSchema = v.object({
  card: HeldActionCardSchema,
  ownerId: v.string(),
  targetId: v.string(),
});

const GameStateSchema: v.GenericSchema<unknown, GameState> = v.object({
  actionQueue: v.array(QueuedActionSchema),
  assignment: v.nullable(
    v.object({
      assigned: v.array(QueuedActionSchema),
      cards: v.array(HeldActionCardSchema),
      chooserId: v.string(),
    })
  ),
  atOpeningSlot: v.boolean(),
  chatReactions: v.map(
    v.pipe(integer, v.minValue(1)),
    v.map(v.string(), ReactionEmojiSchema)
  ),
  choice: v.nullable(
    v.object({ card: ActionCardSchema, chooserId: v.string(), options: idList })
  ),
  dealHistory: v.array(DealEventSchema),
  dealSeq: nonNegativeInteger,
  dealerIndex: integer,
  deck: cards,
  discard: cards,
  drawSeq: nonNegativeInteger,
  evictedCards: cards,
  flipSequences: v.array(
    v.object({
      card: ActionCardSchema,
      deferred: v.array(HeldActionCardSchema),
      remaining: nonNegativeInteger,
      targetId: v.string(),
    })
  ),
  flipThreeTargetIds: idList,
  games: nonNegativeInteger,
  hostId: nullableId,
  log: v.array(LogEntrySchema),
  logClearedAt: nonNegativeInteger,
  logSeq: nonNegativeInteger,
  openingSlots: idList,
  outOfCards: v.boolean(),
  phase: v.picklist(PHASES),
  players: v.array(
    v.object({
      avatar: v.nullable(v.custom<number>(isAvatar)),
      bot: v.boolean(),
      bustCard: v.nullable(CardSchema),
      connected: v.boolean(),
      hand: cards,
      id: v.string(),
      lastRound: v.nullable(
        v.object({
          doubled: v.boolean(),
          flipSeven: v.boolean(),
          modifiers: nonNegativeInteger,
          numbers: nonNegativeInteger,
          total: nonNegativeInteger,
        })
      ),
      name: v.string(),
      score: nonNegativeInteger,
      status: v.picklist(ROUND_STATUSES),
    })
  ),
  round: nonNegativeInteger,
  settings: RoomSettingsSchema,
  turnAnchor: integer,
  turnId: nullableId,
  winner: WinnerSchema,
  winnerIds: idList,
});

export const StoredRoomSchema: v.GenericSchema<unknown, StoredRoom> = v.object({
  botTurn: v.nullable(
    v.object({ at: nonNegativeInteger, playerId: v.string() })
  ),
  broadcastSeqs: v.object({
    dealHistory: nonNegativeInteger,
    log: nonNegativeInteger,
  }),
  code: v.pipe(
    v.string(),
    v.check((code) => normalizeCode(code) === code)
  ),
  game: GameStateSchema,
  hostLeftAt: v.nullable(nonNegativeInteger),
  lastActiveAt: nonNegativeInteger,
  lastRequests: v.record(v.string(), v.string()),
  stall: v.nullable(
    v.object({ playerId: v.string(), since: nonNegativeInteger })
  ),
  tokens: v.record(v.string(), v.string()),
});
