import type { ActionCard, Card } from "./cards";
import type { GameEvent, LogPlayer } from "./game-events";

export const FLIP_THREE_COUNT = 3;

type HeldActionCard = Exclude<ActionCard, { kind: "secondChance" }>;

export interface ActionCardChoice {
  chooserId: string;
  card: ActionCard;
  options: string[];
}

export interface HeldCard {
  card: ActionCard;
  ownerId: string;
}

interface FlipThreeSequence {
  /** The Flip Three card being resolved. It goes to the discard pile once its draws end. */
  card: ActionCard;
  targetId: string;
  remaining: number;
  deferred: HeldActionCard[];
}

interface QueuedAction {
  ownerId: string;
  card: HeldActionCard;
  targetId: string;
}

export interface HeldActionResolution {
  card: HeldActionCard;
  targetId: string;
  outcome: "played" | "discarded";
}

/**
 * The Freeze and Flip Three cards a finished Flip Three set aside. Its target
 * assigns every one, in reveal order, before any of them takes effect.
 */
interface DeferredAssignment {
  chooserId: string;
  cards: HeldActionCard[];
  assigned: QueuedAction[];
}

export interface ActionCardState {
  actionQueue: QueuedAction[];
  assignment: DeferredAssignment | null;
  choice: ActionCardChoice | null;
  flipSequences: FlipThreeSequence[];
}

export interface FlipDraw {
  held: boolean;
  progress: { index: number; total: number };
}

interface CardOwner {
  id: string;
  name: string;
}

interface ResolutionState extends ActionCardState {
  discard: Card[];
  players: readonly (CardOwner & { status: string })[];
}

/** Records a game event in the log. */
type Say = (event: GameEvent) => void;

interface ResolutionEffects {
  /** `owner` is null when the player who played the card has left. */
  apply: (owner: LogPlayer | null, card: ActionCard, targetId: string) => void;
  draw: () => Card | undefined;
  flip: (playerId: string, card: Card, flip: FlipDraw) => void;
  resolveHeld: (resolution: HeldActionResolution) => void;
  say: Say;
}

const findPlayer = (state: ResolutionState, playerId: string) =>
  state.players.find((player) => player.id === playerId);

const logPlayer = (player: CardOwner | undefined) =>
  player === undefined ? null : { id: player.id, name: player.name };

const discardAssignment = (
  state: ResolutionState,
  assignment: DeferredAssignment
) => {
  state.discard.push(
    ...assignment.cards,
    ...assignment.assigned.map(({ card }) => card)
  );
  state.assignment = null;
};

export const initialActionCards = () =>
  ({
    actionQueue: [],
    assignment: null,
    choice: null,
    flipSequences: [],
  }) satisfies ActionCardState;

export const resetActionCards = (state: ActionCardState) => {
  Object.assign(state, initialActionCards());
};

export const discardActionCards = (state: ResolutionState) => {
  for (const sequence of state.flipSequences) {
    state.discard.push(sequence.card, ...sequence.deferred);
  }

  state.discard.push(...state.actionQueue.map(({ card }) => card));

  if (state.assignment) {
    discardAssignment(state, state.assignment);
  } else if (state.choice) {
    state.discard.push(state.choice.card);
  }

  resetActionCards(state);
};

export const startFlipThree = (
  state: ActionCardState,
  targetId: string,
  card: ActionCard
) => {
  state.flipSequences.push({
    card,
    deferred: [],
    remaining: FLIP_THREE_COUNT,
    targetId,
  });
};

export const offerActionCardChoice = (
  state: ResolutionState,
  chooserId: string,
  card: ActionCard,
  options: string[]
) => {
  if (options.length === 0) {
    state.discard.push(card);

    return null;
  }

  const [only] = options;

  if (options.length === 1 && only !== undefined) {
    return only;
  }

  state.choice = { card, chooserId, options };

  return null;
};

const finishFlipThree = (
  state: ResolutionState,
  sequence: FlipThreeSequence,
  say: Say
) => {
  if (sequence.deferred.length === 0) {
    return;
  }

  const target = findPlayer(state, sequence.targetId);

  if (target?.status !== "active") {
    state.discard.push(...sequence.deferred);
    say({
      cards: sequence.deferred.map((card) => card.kind),
      type: "heldActionsDiscarded",
    });

    return;
  }

  state.assignment = {
    assigned: [],
    cards: [...sequence.deferred],
    chooserId: target.id,
  };
};

const assignDeferred = (
  state: ResolutionState,
  assignment: DeferredAssignment,
  targetId: string,
  say: Say
) => {
  const card = assignment.cards.shift();
  const chooser = findPlayer(state, assignment.chooserId);
  const target = findPlayer(state, targetId);

  if (!card) {
    return;
  }

  assignment.assigned.push({ card, ownerId: assignment.chooserId, targetId });
  say({
    by: logPlayer(chooser),
    card: card.kind,
    target: logPlayer(target),
    type: "actionAssigned",
  });
};

const stepAssignment = (state: ResolutionState, say: Say) => {
  const { assignment } = state;

  if (!assignment) {
    return false;
  }

  const [card] = assignment.cards;

  if (card === undefined) {
    state.actionQueue = [...state.actionQueue, ...assignment.assigned];
    state.assignment = null;

    return true;
  }

  const options = state.players.flatMap((player) =>
    player.status === "active" ? [player.id] : []
  );

  const [only] = options;

  if (options.length === 0) {
    discardAssignment(state, assignment);
  } else if (options.length === 1 && only !== undefined) {
    assignDeferred(state, assignment, only, say);
  } else {
    state.choice = { card, chooserId: assignment.chooserId, options };
  }

  return true;
};

const stepFlipThree = (state: ResolutionState, effects: ResolutionEffects) => {
  const sequence = state.flipSequences.at(-1);

  if (!sequence) {
    return false;
  }

  const target = findPlayer(state, sequence.targetId);

  if (sequence.remaining === 0 || target?.status !== "active") {
    state.flipSequences.pop();
    state.discard.push(sequence.card);

    finishFlipThree(state, sequence, effects.say);

    return true;
  }

  const card = effects.draw();

  if (!card) {
    sequence.remaining = 0;

    return true;
  }

  sequence.remaining -= 1;
  const held = card.kind === "freeze" || card.kind === "flipThree";

  if (held) {
    sequence.deferred.push(card);
  }

  effects.flip(target.id, card, {
    held,
    progress: {
      index: FLIP_THREE_COUNT - sequence.remaining,
      total: FLIP_THREE_COUNT,
    },
  });

  return true;
};

const stepActionQueue = (
  state: ResolutionState,
  effects: ResolutionEffects
) => {
  const queued = state.actionQueue.shift();

  if (!queued) {
    return false;
  }

  const owner = findPlayer(state, queued.ownerId);

  const target = findPlayer(state, queued.targetId);
  effects.resolveHeld({
    card: queued.card,
    outcome: target?.status === "active" ? "played" : "discarded",
    targetId: queued.targetId,
  });

  if (target?.status !== "active") {
    state.discard.push(queued.card);
    effects.say({
      card: queued.card.kind,
      target: logPlayer(target),
      type: "actionDiscarded",
    });

    return true;
  }

  effects.apply(logPlayer(owner), queued.card, target.id);

  return true;
};

export const chooseActionCard = (
  state: ResolutionState,
  targetId: string,
  say: Say
) => {
  const { assignment, choice } = state;
  state.choice = null;

  if (!choice) {
    return null;
  }

  if (assignment?.cards[0]?.id === choice.card.id) {
    assignDeferred(state, assignment, targetId, say);

    return null;
  }

  return choice.card;
};

export const advanceActionCards = (
  state: ResolutionState,
  effects: ResolutionEffects
) =>
  stepFlipThree(state, effects) ||
  stepAssignment(state, effects.say) ||
  stepActionQueue(state, effects);

export const evictFromActionCards = (
  state: ResolutionState,
  playerId: string
) => {
  const { assignment, choice } = state;

  if (assignment?.chooserId === playerId) {
    discardAssignment(state, assignment);
    state.choice = null;
  } else if (assignment) {
    state.choice = null;
  } else if (choice?.chooserId === playerId) {
    state.discard.push(choice.card);
    state.choice = null;
  } else if (choice) {
    choice.options = choice.options.filter((id) => id !== playerId);

    if (choice.options.length === 0) {
      state.discard.push(choice.card);
      state.choice = null;
    }
  }
};

const heldCards = (state: ActionCardState) => {
  const { assignment } = state;

  const held: HeldCard[] = state.flipSequences.flatMap((sequence) =>
    sequence.deferred.map((card) => ({ card, ownerId: sequence.targetId }))
  );

  if (assignment) {
    for (const card of assignment.cards) {
      if (card.id !== state.choice?.card.id) {
        held.push({ card, ownerId: assignment.chooserId });
      }
    }

    for (const { card, targetId } of assignment.assigned) {
      held.push({ card, ownerId: targetId });
    }
  }

  for (const { card, targetId } of state.actionQueue) {
    held.push({ card, ownerId: targetId });
  }

  return held;
};

export const projectActionCards = (state: ActionCardState) => ({
  choice: state.choice,
  flips: state.flipSequences.map(({ remaining, targetId }) => ({
    remaining,
    targetId,
  })),
  held: heldCards(state),
});
