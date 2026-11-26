import { cardLabel } from "../game/cards";
import type { Card } from "../game/cards";
import { FLIP_THREE_COUNT, isChat } from "../game/engine";
import type { Player } from "../game/engine";
import { availableMoves } from "../game/moves";
import type { AvailableMoves } from "../game/moves";
import type { RoomView } from "../game/protocol";
import type { PlaybackMoment } from "./deal-beats";
import { stepPlayerId } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { pointsOf } from "./deal-playback";
import type { DealPlaybackView } from "./deal-playback";
import { hostName } from "./host";
import { nameOf } from "./player-name";
import { rankPlayers, winnerNames, winnersHeadline } from "./standings";

/**
 * Which controls the action bar offers alongside the Table prompt: Hit and
 * Stay (for an offline player when `for` is set), Start next round, Back to
 * lobby with Play again when `canStart`, or a line saying who the room is
 * waiting for in place of the host's buttons.
 */
export type PromptControls =
  | { kind: "none" }
  | {
      kind: "turn";
      for?: { id: string; name: string };
      canStay: boolean;
      roundPoints: number;
    }
  | { kind: "nextRound" }
  | { kind: "gameOver"; canStart: boolean }
  | { kind: "waitForHost"; text: string };

/** What the action bar tells this viewer right now. */
export interface BarPrompt {
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

/** The parts of Deal playback the Table prompt reads. A whole `DealPlaybackView` fits. */
export type PromptPlayback = Pick<
  DealPlaybackView,
  "dealing" | "moment" | "step" | "roundPoints"
>;

/** What one player's panel offers and shows this viewer. */
export interface PlayerPrompt {
  /** The game is waiting on this player, shown once no moment is settling. */
  waitingOn: boolean;
  /** The viewer can give this player the action card, choosing for `forId` when set. */
  pick: { kind: ActionCardKind; forId?: string } | null;
  /** The viewer is choosing and this player can't receive the card. */
  unpickable: boolean;
  /** The player won the game, shown once Deal playback has finished. */
  winner: boolean;
}

/**
 * Everything the table offers this viewer right now: the action bar, each
 * player, and which results Deal playback lets them see. See GLOSSARY.md.
 */
export interface TablePrompt {
  bar: BarPrompt;
  /** Each player's prompt, by player ID. */
  players: ReadonlyMap<string, PlayerPrompt>;
  /** The round whose results may show, or null while play or playback goes on. */
  resultsRound: number | null;
  /** The game is over and Deal playback has finished, so the result may show. */
  gameOver: boolean;
}

type ActionCardKind = NonNullable<RoomView["choice"]>["card"]["kind"];

const NONE: PromptControls = { kind: "none" };
const RECONNECT_NOTE = "Play resumes when a player reconnects.";

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

type Prompt = Omit<BarPrompt, "yours">;

type PromptLines = Pick<BarPrompt, "headline" | "note">;

const gameOverPrompt = (room: RoomView, moves: AvailableMoves) =>
  ({
    controls: moves.host.lobby
      ? { canStart: moves.host.start, kind: "gameOver" }
      : {
          kind: "waitForHost",
          text: `Waiting for ${hostName(room)} to play again or head back to the lobby.`,
        },
    headline: winnersHeadline(winnerNames(room)),
    winner: true,
  }) satisfies Prompt;

const ownRoundNote = (room: RoomView, playerId: string | null) => {
  const me = room.players.find((player) => player.id === playerId);

  if (me === undefined || me.lastRound === null) {
    return null;
  }

  if (me.status === "busted") {
    return "You busted — no points";
  }

  const { total } = me.lastRound;

  return `You banked ${total} ${total === 1 ? "point" : "points"}`;
};

const roundOverPrompt = (
  room: RoomView,
  playerId: string | null,
  moves: AvailableMoves
) => {
  const over = room.log
    .flatMap((entry) =>
      isChat(entry) || entry.round !== room.round ? [] : [entry.event]
    )
    .findLast((event) => event.type === "roundOver");

  const tiedAt = over?.tiedAt ?? null;

  const note =
    tiedAt === null
      ? ownRoundNote(room, playerId)
      : `Tied at ${tiedAt} — play another round`;

  return {
    controls: moves.host.nextRound
      ? { kind: "nextRound" }
      : {
          kind: "waitForHost",
          text: `Waiting for ${hostName(room)} to start the next round.`,
        },
    headline: roundEndHeadline(room),
    ...(note !== null && { note }),
  } satisfies Prompt;
};

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
        for: { id: turn.forId, name: forName },
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

const stayNote = (points: number) =>
  `+${points} ${points === 1 ? "point" : "points"}`;

const momentPrompt = (
  room: RoomView,
  playerId: string | null,
  moment: PlaybackMoment
) => {
  if (moment.kind === "reshuffle") {
    return { headline: "Shuffling the discard pile…" } satisfies PromptLines;
  }

  if (moment.kind === "outOfCards") {
    return { headline: "Deck empty", note: "Round over" } satisfies PromptLines;
  }

  const isMe = moment.playerId === playerId;
  const name = nameOf(room, moment.playerId);

  switch (moment.kind) {
    case "flipSeven": {
      return {
        headline: isMe ? "You Flipped 7!" : `${name} Flipped 7!`,
      } satisfies PromptLines;
    }

    case "bust": {
      return {
        headline: isMe ? "You busted!" : `${name} busted!`,
      } satisfies PromptLines;
    }

    case "freeze": {
      if (moment.byId === moment.playerId) {
        return {
          headline: isMe ? "You froze yourself!" : `${name} froze themselves!`,
        } satisfies PromptLines;
      }

      return {
        headline: isMe ? "You were frozen!" : `${name} was frozen!`,
      } satisfies PromptLines;
    }

    case "stay": {
      return {
        headline: isMe ? "You stayed" : `${name} stayed`,
        note: stayNote(moment.points),
      } satisfies PromptLines;
    }

    case "saved": {
      return {
        headline: isMe
          ? "Second Chance saves you!"
          : `Second Chance saves ${name}!`,
      } satisfies PromptLines;
    }

    case "secondChanceGiven": {
      return {
        headline: isMe
          ? "You got a Second Chance!"
          : `${name} got a Second Chance`,
      } satisfies PromptLines;
    }

    default: {
      return moment satisfies never;
    }
  }
};

const promptFor = (
  room: RoomView,
  playerId: string | null,
  moves: AvailableMoves,
  { dealing, moment, roundPoints, step }: PromptPlayback
) => {
  if (dealing && moment) {
    return { controls: NONE, ...momentPrompt(room, playerId, moment) };
  }

  if (room.phase === "gameOver") {
    return gameOverPrompt(room, moves);
  }

  if (room.phase === "roundOver") {
    return roundOverPrompt(room, playerId, moves);
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
 * The Move this viewer owes right now, as a key that changes with each new
 * Move, or null. Null during Deal playback, for a Spectator, and for a host who
 * could move for an offline player. The action bar says "Your move" exactly
 * when this is set, and the Move alert keys on it.
 */
export const yourMove = (
  room: RoomView,
  playerId: string | null,
  playback: Pick<PromptPlayback, "dealing">
) => {
  if (playback.dealing) {
    return null;
  }

  const { choice, turn } = availableMoves(room, playerId);

  if (choice !== null && choice.forId === undefined && room.choice) {
    return `${room.round}:choice:${room.choice.card.id}`;
  }

  return turn !== null && turn.forId === undefined
    ? `${room.round}:turn:${room.drawSeq}`
    : null;
};

/** The round whose results may show, once Deal playback has dealt them. */
export const resultsRound = (
  room: RoomView,
  playback: Pick<PromptPlayback, "dealing">
) => (room.phase === "roundOver" && !playback.dealing ? room.round : null);

const playerPrompt = (
  room: RoomView,
  moves: AvailableMoves,
  playback: PromptPlayback,
  gameOver: boolean,
  id: string
) => {
  const { choice } = moves;
  const choosing = choice !== null && !playback.dealing;

  const pick =
    choosing && room.choice !== null && choice.targets.includes(id)
      ? {
          kind: room.choice.card.kind,
          ...(choice.forId !== undefined && { forId: choice.forId }),
        }
      : null;

  return {
    pick,
    unpickable: choosing && pick === null,
    waitingOn: playback.moment === null && moves.waitingOn?.playerId === id,
    winner: gameOver && room.winnerIds.includes(id),
  } satisfies PlayerPrompt;
};

/**
 * What the table offers `playerId` (null for a Spectator): one action bar
 * prompt, chosen from the phase, the Move being waited on and Deal playback,
 * plus what each player panel offers and whether results may show yet.
 */
export const tablePrompt = (
  room: RoomView,
  playerId: string | null,
  playback: PromptPlayback
) => {
  const moves = availableMoves(room, playerId);
  const gameOver = room.phase === "gameOver" && !playback.dealing;

  const prompt: TablePrompt = {
    bar: {
      ...promptFor(room, playerId, moves, playback),
      yours: yourMove(room, playerId, playback) !== null,
    },
    gameOver,
    resultsRound: resultsRound(room, playback),
    players: new Map(
      room.players.map(({ id }) => [
        id,
        playerPrompt(room, moves, playback, gameOver, id),
      ])
    ),
  };

  return prompt;
};

/** Equal prompts render the same, so a memo can skip unchanged updates. */
export const samePrompt = (a: BarPrompt, b: BarPrompt) =>
  a.headline === b.headline &&
  a.note === b.note &&
  a.card?.id === b.card?.id &&
  a.winner === b.winner &&
  a.yours === b.yours &&
  JSON.stringify(a.controls) === JSON.stringify(b.controls);
