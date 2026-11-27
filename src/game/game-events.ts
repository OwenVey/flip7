import type { HeldActionKind } from "./cards";
import type { BotSpeed, TargetScore } from "./settings";

/** A player as the log names them, with their name at the time. */
export interface LogPlayer {
  id: string;
  name: string;
}

/** A player's recorded score, at round end or when they win the game. */
export interface LoggedScore extends LogPlayer {
  points: number;
}

/** Who made a move: the player, or the host or the game for an offline player. */
export type Mover =
  | { kind: "player" }
  | { kind: "host"; host: LogPlayer }
  | { kind: "game" };

/** Who made a move for an offline player. */
export type OfflineMover = Exclude<Mover, { kind: "player" }>;

/**
 * Something that happened in the room, as the facts the engine knew when it
 * happened. The Chat & Log decides how to word and show it.
 *
 * `by` is null when the player who played a card has left the room.
 */
export type GameEvent =
  | {
      type: "joined";
      player: LogPlayer;
      /** What a player who joins mid-game waits for before they play. */
      waitsFor: "round" | "game" | null;
    }
  | { type: "botAdded"; player: LogPlayer }
  | {
      type: "evicted";
      player: LogPlayer;
      how: "kicked" | "left" | "leftToWatch";
    }
  | {
      type: "hostChanged";
      player: LogPlayer;
      /** The room handed hosting over after the host went offline. */
      how: "auto";
    }
  | {
      type: "hostChanged";
      player: LogPlayer;
      /** The former host who handed hosting over. */
      by: LogPlayer;
      how: "given";
    }
  | { type: "targetScoreSet"; targetScore: TargetScore }
  | { type: "botSpeedSet"; botSpeed: BotSpeed }
  | { type: "lockSet"; locked: boolean }
  | { type: "gameAbandoned" }
  | { type: "roundStarted"; dealer: LogPlayer | null }
  | { type: "deckReshuffled" }
  | { type: "outOfCards" }
  | {
      type: "stayed";
      player: LogPlayer;
      /** What the player's hand scored when they stayed. */
      points: number;
      by: Mover;
    }
  | {
      type: "movedForOffline";
      player: LogPlayer;
      move: "hit" | "choose";
      by: OfflineMover;
    }
  | { type: "busted"; player: LogPlayer; card: number }
  | { type: "flipSeven"; player: LogPlayer }
  | { type: "secondChanceKept"; player: LogPlayer }
  | { type: "secondChanceUsed"; player: LogPlayer; card: number }
  | {
      type: "secondChanceGiven";
      by: LogPlayer | null;
      target: LogPlayer;
    }
  | { type: "secondChanceDiscarded"; player: LogPlayer }
  | {
      type: "frozen";
      by: LogPlayer | null;
      target: LogPlayer;
      /** What the target's hand scored when they were frozen. */
      points: number;
    }
  | { type: "flipThreeStarted"; by: LogPlayer | null; target: LogPlayer }
  | {
      type: "actionAssigned";
      by: LogPlayer | null;
      card: HeldActionKind;
      /** Null when the target has left the room. */
      target: LogPlayer | null;
    }
  | { type: "heldActionsDiscarded"; cards: HeldActionKind[] }
  | {
      type: "actionDiscarded";
      card: HeldActionKind;
      /** Null when the target has left the room. */
      target: LogPlayer | null;
    }
  | {
      type: "roundOver";
      /** The score the leaders tied at when the round would otherwise have won the game. */
      tiedAt: number | null;
      scores: LoggedScore[];
    }
  | {
      type: "gameWon";
      player: LogPlayer;
      points: number;
      scores: LoggedScore[];
    };

export type GameEventType = GameEvent["type"];

const moverPlayer = (by: Mover | LogPlayer | null) => {
  if (by === null || !("kind" in by)) {
    return by;
  }

  return by.kind === "host" ? by.host : null;
};

/** The players an event is about: whoever moved or played a card first, then whom it happened to. */
export const eventPlayers = (event: GameEvent) => {
  const named = [
    "by" in event ? moverPlayer(event.by) : null,
    "player" in event ? event.player : null,
    "target" in event ? event.target : null,
    "dealer" in event ? event.dealer : null,
  ].filter((player) => player !== null);

  return named.filter(
    (player, index) =>
      named.findIndex((other) => other.id === player.id) === index
  );
};

/** Whether an event ends a round, settling what each player scored. */
export const settlesRound = (event: GameEvent) =>
  event.type === "roundOver" || event.type === "gameWon";
