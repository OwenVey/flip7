import { isChat } from "../game/engine";
import type { LogEntry } from "../game/engine";
import type { GameEvent, GameEventType } from "../game/game-events";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";

const GAME_CUE_PRIORITY = [
  "flipSeven",
  "bust",
  "freeze",
  "special",
  "bank",
  "join",
] as const;

/** A sound a game event plays, and the colour the Chat & Log gives it. */
export type GameCue = (typeof GAME_CUE_PRIORITY)[number];

const EVENT_CUES = {
  actionAssigned: "special",
  actionDiscarded: null,
  botAdded: "join",
  botSpeedSet: null,
  busted: "bust",
  deckReshuffled: null,
  evicted: null,
  flipSeven: "flipSeven",
  flipThreeStarted: "special",
  frozen: "freeze",
  gameAbandoned: null,
  gameWon: null,
  heldActionsDiscarded: null,
  hostChanged: null,
  joined: "join",
  lockSet: null,
  movedForOffline: null,
  outOfCards: null,
  roundOver: null,
  roundStarted: null,
  secondChanceDiscarded: null,
  secondChanceGiven: "special",
  secondChanceKept: "special",
  secondChanceUsed: "special",
  stayed: "bank",
  targetScoreSet: null,
} as const satisfies Record<GameEventType, GameCue | null>;

/** The cue a game event plays, if any. */
export const eventCue = (event: GameEvent | undefined) =>
  event === undefined ? null : EVENT_CUES[event.type];

export type RoomCue =
  | GameCue
  | "deal"
  | "message"
  | "reveal"
  | "round"
  | "turn"
  | "win";

const isChatFromOthers = (entry: LogEntry, playerId: string | null) =>
  isChat(entry) && entry.from.id !== playerId;

const tableCue = (
  previous: RoomView,
  current: RoomView,
  events: LogEntry[]
) => {
  const gameCue = GAME_CUE_PRIORITY.find((cue) =>
    events.some((entry) => !isChat(entry) && eventCue(entry.event) === cue)
  );

  if (current.phase === "gameOver" && previous.phase !== "gameOver") {
    return "win";
  }

  if (gameCue) {
    return gameCue;
  }

  if (current.phase === "roundOver" && previous.phase !== "roundOver") {
    return "round";
  }

  if (roundStarted(previous, current)) {
    return "deal";
  }

  if (current.drawSeq > previous.drawSeq) {
    return "reveal";
  }

  return null;
};

export const roomCues = (
  previous: RoomView,
  current: RoomView,
  playerId: string | null
) => {
  const lastId = previous.log.at(-1)?.id ?? 0;
  const events = current.log.filter((entry) => entry.id > lastId);
  const cues: RoomCue[] = [];
  const cue = tableCue(previous, current, events);

  if (cue) {
    cues.push(cue);
  }

  if (events.some((entry) => isChatFromOthers(entry, playerId))) {
    cues.push("message");
  }

  return cues;
};
