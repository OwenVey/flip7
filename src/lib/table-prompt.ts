import { cardLabel } from "../game/cards";
import type { Card } from "../game/cards";
import { FLIP_THREE_COUNT } from "../game/engine";
import type { Player } from "../game/engine";
import { availableMoves } from "../game/moves";
import type { AvailableMoves } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { stepPlayerId } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import type { DealPlaybackView } from "./deal-playback";
import { hostName } from "./host";
import { rankPlayers } from "./standings";

/**
 * Which controls the action bar offers alongside the Table prompt: Hit and
 * Stay (for an offline player when `forId` is set), Start next round, Back to
 * lobby with Play again when `canStart`, or a line saying who the room is
 * waiting for in place of the host's buttons.
 */
export type PromptControls =
  | { kind: "none" }
  | {
      kind: "turn";
      forId?: string;
      forName?: string;
      canStay: boolean;
      roundPoints: number;
    }
  | { kind: "nextRound" }
  | { kind: "gameOver"; canStart: boolean }
  | { kind: "waitForHost"; text: string };

/** What the action bar tells this viewer right now. See GLOSSARY.md. */
export interface TablePrompt {
  /** Missing only in the gap between turns, when nothing is waiting. */
  headline?: string;
  /** Secondary text after the headline. */
  note?: string;
  /** The action card being given out. */
  card?: Card;
  /** The headline announces the game's winners. */
  winner?: true;
  /** The prompt asks this viewer for a Move. */
  yours: boolean;
  controls: PromptControls;
}

export type PromptPlayback = Pick<
  DealPlaybackView,
  "dealing" | "step" | "roundPoints"
>;

const NONE: PromptControls = { kind: "none" };
const RECONNECT_NOTE = "Play resumes when a player reconnects.";

const nameOf = (room: RoomView, id: string | null) =>
  room.players.find((player) => player.id === id)?.name ?? "Someone";

const pointsOf = (
  roundPoints: PromptPlayback["roundPoints"],
  playerId: string | null
) => (playerId === null ? 0 : (roundPoints.get(playerId) ?? 0));

const playPaused = (room: RoomView) =>
  !room.players.some((player) => player.connected && !player.bot);

const flipLabel = (
  flip: NonNullable<DealStep["flip"]>,
  isMe: boolean,
  name: string
) => {
  if (flip.index === 0) {
    return isMe ? "Flip Three on you!" : `Flip Three on ${name}!`;
  }

  return `Flip Three · ${isMe ? "you flip" : `${name} flips`} ${flip.index} of ${flip.total}`;
};

const discardLabel = (step: DealStep, isMe: boolean, name: string) => {
  if (step.partnerId !== null) {
    return isMe ? "Second Chance saves you!" : `Second Chance saves ${name}!`;
  }

  return `${cardLabel(step.card)} is discarded`;
};

const dealingLabel = (
  room: RoomView,
  playerId: string | null,
  step: DealStep | null
) => {
  if (step === null) {
    return "Dealing…";
  }

  const target =
    step.to.kind === "choice"
      ? (room.choice?.chooserId ?? null)
      : stepPlayerId(step);

  if (target === null) {
    return "Dealing…";
  }

  const isMe = target === playerId;
  const name = nameOf(room, target);

  if (step.flip) {
    return flipLabel(step.flip, isMe, name);
  }

  if (step.to.kind === "played") {
    return flipLabel({ index: 0, total: FLIP_THREE_COUNT }, isMe, name);
  }

  if (step.to.kind === "discard") {
    return discardLabel(step, isMe, name);
  }

  if (step.from === "held") {
    return `${cardLabel(step.card)} comes into play…`;
  }

  if (step.from === "choice") {
    return `${cardLabel(step.card)} goes to ${isMe ? "you" : name}…`;
  }

  if (step.hit) {
    return isMe ? "You hit…" : `${name} hits…`;
  }

  return isMe ? "Dealing to you…" : `Dealing to ${name}…`;
};

const previousScore = (player: Player) =>
  player.score - (player.lastRound?.total ?? 0);

const roundEndHeadline = (room: RoomView) => {
  const flippedSeven = room.players.find(
    (player) => player.status === "flipSeven"
  );

  if (flippedSeven) {
    return `${flippedSeven.name} Flipped 7! +${flippedSeven.lastRound?.total ?? 0}`;
  }

  const [first, second] = rankPlayers(room.players);

  if (
    first !== undefined &&
    second !== undefined &&
    first.player.score > second.player.score
  ) {
    const tookLead = room.players.some(
      (player) =>
        player.id !== first.player.id &&
        previousScore(player) >= previousScore(first.player)
    );

    if (tookLead) {
      return `${first.player.name} takes the lead`;
    }
  }

  return `End of round ${room.round}`;
};

type Prompt = Omit<TablePrompt, "yours">;

const gameOverPrompt = (room: RoomView, moves: AvailableMoves) =>
  ({
    controls: moves.host.lobby
      ? { canStart: moves.host.start, kind: "gameOver" }
      : {
          kind: "waitForHost",
          text: `Waiting for ${hostName(room)} to play again or head back to the lobby.`,
        },
    headline: `${room.winnerIds.map((id) => nameOf(room, id)).join(" and ")} wins!`,
    winner: true,
  }) satisfies Prompt;

const roundOverPrompt = (room: RoomView, moves: AvailableMoves) =>
  ({
    controls: moves.host.nextRound
      ? { kind: "nextRound" }
      : {
          kind: "waitForHost",
          text: `Waiting for ${hostName(room)} to start the next round.`,
        },
    headline: roundEndHeadline(room),
  }) satisfies Prompt;

const choicePrompt = (
  room: RoomView,
  moves: AvailableMoves,
  choice: NonNullable<RoomView["choice"]>
) => {
  const { card } = choice;
  const chooser = nameOf(room, choice.chooserId);
  const label = cardLabel(card);

  if (moves.choice === null) {
    if (moves.waitingOn?.offline !== true) {
      return {
        card,
        controls: NONE,
        headline: `${chooser} is choosing who receives ${label}.`,
      };
    }

    return {
      card,
      controls: NONE,
      headline: `${chooser} is offline.`,
      note: playPaused(room)
        ? RECONNECT_NOTE
        : `The game will play ${label} for them soon.`,
    };
  }

  if (moves.choice.forId === undefined) {
    return {
      card,
      controls: NONE,
      headline: `Who gets your ${label}?`,
      note: "Tap a player",
    };
  }

  return {
    card,
    controls: NONE,
    headline: `${chooser} is offline.`,
    note: `Pick who gets their ${label}, or the game will play it for them soon.`,
  };
};

const turnPrompt = (
  room: RoomView,
  playerId: string | null,
  moves: AvailableMoves,
  roundPoints: PromptPlayback["roundPoints"]
) => {
  const { turn, waitingOn } = moves;

  if (turn !== null && turn.forId === undefined) {
    const points = pointsOf(roundPoints, playerId);

    return {
      controls: { canStay: turn.canStay, kind: "turn", roundPoints: points },
      headline: "Your turn",
      note: turn.canStay
        ? `${points} points this round`
        : "Hit for a card before you can stay",
    } satisfies Prompt;
  }

  if (turn !== null && turn.forId !== undefined) {
    const forName = nameOf(room, turn.forId);

    return {
      controls: {
        canStay: turn.canStay,
        forId: turn.forId,
        forName,
        kind: "turn",
        roundPoints: pointsOf(roundPoints, turn.forId),
      },
      headline: `${forName} is offline`,
      note: `Play for them, or the game will ${turn.canStay ? "Stay" : "Hit"} soon`,
    } satisfies Prompt;
  }

  if (playPaused(room) && waitingOn !== null) {
    return {
      controls: NONE,
      headline: `Waiting on ${nameOf(room, waitingOn.playerId)}`,
      note: RECONNECT_NOTE,
    };
  }

  if (room.turnId === null) {
    return { controls: NONE };
  }

  const name = nameOf(room, room.turnId);

  if (waitingOn?.offline !== true) {
    return { controls: NONE, headline: `${name} is deciding…` };
  }

  return {
    controls: NONE,
    headline: `${name} is offline.`,
    note: `The game will ${waitingOn.canStay ? "Stay" : "Hit"} for them soon.`,
  };
};

const promptFor = (
  room: RoomView,
  playerId: string | null,
  moves: AvailableMoves,
  { dealing, roundPoints, step }: PromptPlayback
) => {
  if (room.phase === "gameOver") {
    return gameOverPrompt(room, moves);
  }

  if (room.phase === "roundOver") {
    return roundOverPrompt(room, moves);
  }

  if (room.choice) {
    return dealing
      ? {
          card: room.choice.card,
          controls: NONE,
          headline: dealingLabel(room, playerId, step),
        }
      : choicePrompt(room, moves, room.choice);
  }

  if (dealing) {
    return { controls: NONE, headline: dealingLabel(room, playerId, step) };
  }

  return turnPrompt(room, playerId, moves, roundPoints);
};

/**
 * What the action bar shows `playerId` (null for a Spectator): one prompt,
 * chosen from the phase, the Move being waited on and Deal playback.
 */
export const tablePrompt = (
  room: RoomView,
  playerId: string | null,
  playback: PromptPlayback
) => {
  const moves = availableMoves(room, playerId);

  const asked = (move: { forId?: string } | null) =>
    move !== null && move.forId === undefined && !playback.dealing;

  const prompt: TablePrompt = {
    ...promptFor(room, playerId, moves, playback),
    yours: asked(moves.turn) || asked(moves.choice),
  };

  return prompt;
};

/** Equal prompts render the same, so a memo can skip unchanged updates. */
export const samePrompt = (a: TablePrompt, b: TablePrompt) =>
  a.headline === b.headline &&
  a.note === b.note &&
  a.card?.id === b.card?.id &&
  a.winner === b.winner &&
  a.yours === b.yours &&
  JSON.stringify(a.controls) === JSON.stringify(b.controls);
