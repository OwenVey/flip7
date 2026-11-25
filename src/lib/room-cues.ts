import { isChat } from "../game/engine";
import type { LogEntry } from "../game/engine";
import type { GameEvent, GameEventType } from "../game/game-events";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";

const GAME_CUE_PRIORITY = [
  "flipSeven",
  "bust",
  "freeze",
  "secondChance",
  "flipThree",
  "special",
  "bank",
  "shuffle",
  "join",
  "leave",
] as const;

/** A game event category that the Chat & Log uses for colour. */
export type GameCue = (typeof GAME_CUE_PRIORITY)[number];

const EVENT_CUES = {
  actionAssigned: "special",
  actionDiscarded: null,
  botAdded: "join",
  botSpeedSet: null,
  busted: "bust",
  deckReshuffled: "shuffle",
  evicted: "leave",
  flipSeven: "flipSeven",
  flipThreeStarted: "flipThree",
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
  secondChanceUsed: "secondChance",
  stayed: "bank",
  targetScoreSet: null,
} as const satisfies Record<GameEventType, GameCue | null>;

/** The category of a game event, if any. */
export const eventCue = (event: GameEvent | undefined) =>
  event === undefined ? null : EVENT_CUES[event.type];

export type RoomCue =
  | Exclude<GameCue, "special">
  | "deal"
  | "lose"
  | "message"
  | "reveal"
  | "round"
  | "turn"
  | "win";

const isChatFromOthers = (entry: LogEntry, playerId: string | null) =>
  isChat(entry) && entry.from.id !== playerId;

export const newLogEntries = (previous: RoomView, current: RoomView) => {
  const lastId = previous.log.at(-1)?.id ?? 0;

  return current.log.filter((entry) => entry.id > lastId);
};

export const gameOverCue = (
  previous: RoomView,
  current: RoomView,
  playerId: string | null
) => {
  if (current.phase !== "gameOver" || previous.phase === "gameOver") {
    return null;
  }

  const seated = current.players.some(({ id }) => id === playerId);

  return seated && playerId !== null && !current.winnerIds.includes(playerId)
    ? ("lose" as const)
    : ("win" as const);
};

export const chatCue = (events: readonly LogEntry[], playerId: string | null) =>
  events.some((entry) => isChatFromOthers(entry, playerId))
    ? ("message" as const)
    : null;

const tableCue = (
  previous: RoomView,
  current: RoomView,
  events: LogEntry[],
  playerId: string | null
) => {
  const gameCue = GAME_CUE_PRIORITY.find((cue) =>
    events.some((entry) => !isChat(entry) && eventCue(entry.event) === cue)
  );

  const finale = gameOverCue(previous, current, playerId);

  if (finale) {
    return finale;
  }

  if (gameCue) {
    return gameCue === "special" ? "reveal" : gameCue;
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
  const events = newLogEntries(previous, current);
  const cues: RoomCue[] = [];
  const cue = tableCue(previous, current, events, playerId);

  if (cue) {
    cues.push(cue);
  }

  const chat = chatCue(events, playerId);

  if (chat) {
    cues.push(chat);
  }

  return cues;
};
