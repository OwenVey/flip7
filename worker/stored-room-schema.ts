import * as v from "valibot";

import { isAvatar } from "../src/game/avatars";
import { PHASES } from "../src/game/engine";
import type { GameState } from "../src/game/engine";
import {
  ActionCardSchema,
  CardSchema,
  DealEventSchema,
  HeldActionCardSchema,
  LogEntrySchema,
  normalizeCode,
} from "../src/game/protocol";
import type { StoredRoom } from "../src/game/room";
import { BOT_SPEEDS, TARGET_SCORES } from "../src/game/settings";

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
      status: v.picklist([
        "out",
        "active",
        "stayed",
        "frozen",
        "busted",
        "flipSeven",
      ]),
    })
  ),
  round: nonNegativeInteger,
  settings: v.object({
    botSpeed: v.picklist(BOT_SPEEDS),
    locked: v.boolean(),
    targetScore: v.picklist(TARGET_SCORES),
  }),
  turnAnchor: integer,
  turnId: nullableId,
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
