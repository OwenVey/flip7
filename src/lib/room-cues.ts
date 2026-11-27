import { isChat } from "../game/engine";
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

const gameOverCue = (
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

const tableCue = (
  previous: RoomView,
  current: RoomView,
  events: readonly GameEvent[]
) => {
  const gameCue = GAME_CUE_PRIORITY.find((cue) =>
    events.some((event) => eventCue(event) === cue)
  );

  if (gameCue) {
    return gameCue === "special" ? ("reveal" as const) : gameCue;
  }

  if (current.phase === "roundOver" && previous.phase !== "roundOver") {
    return "round" as const;
  }

  if (roundStarted(previous, current)) {
    return "deal" as const;
  }

  if (current.drawSeq > previous.drawSeq) {
    return "reveal" as const;
  }

  return null;
};

export const readRoomFeedback = (
  previous: RoomView,
  current: RoomView,
  playerId: string | null
) => {
  const lastId = previous.log.at(-1)?.id ?? 0;
  const events: GameEvent[] = [];
  let chat: "message" | null = null;

  for (const entry of current.log) {
    if (entry.id <= lastId) {
      continue;
    }

    if (!isChat(entry)) {
      events.push(entry.event);
    } else if (entry.from.id !== playerId) {
      chat = "message";
    }
  }

  const finale = gameOverCue(previous, current, playerId);

  return {
    chat,
    events,
    finale,
    table: finale === null ? tableCue(previous, current, events) : null,
  };
};
