import {
  buildDeck,
  FLIP_SEVEN_COUNT,
  isActionCard,
  calculateRoundScore,
  shuffle,
  countUniqueNumberCards,
} from "./cards";
import type { ActionCard, Card, NumberCard, Random, RoundScore } from "./cards";

export const TARGET_SCORE = 200;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const FLIP_THREE_COUNT = 3;

/** This status is stored in rooms and sent in WebSocket state messages. */
export const FLIP_SEVEN_STATUS = "streak";
const LOG_LIMIT = 100;
export const CHAT_MAX_LENGTH = 200;
const WHITESPACE = /\s+/gu;

export type Phase = "lobby" | "playing" | "roundOver" | "gameOver";

export type RoundStatus =
  | "out"
  | "active"
  | "stayed"
  | "frozen"
  | "busted"
  | typeof FLIP_SEVEN_STATUS;

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  status: RoundStatus;
  hand: Card[];
  bustCard: Card | null;
  lastRound: RoundScore | null;
}

export interface ActionCardChoice {
  chooserId: string;
  card: ActionCard;
  options: string[];
}

interface FlipThreeSequence {
  targetId: string;
  remaining: number;
  deferred: ActionCard[];
}

interface QueuedAction {
  ownerId: string;
  card: ActionCard;
}

export type GameCue =
  | "bank"
  | "bust"
  | "freeze"
  | "join"
  | "special"
  | "streak";

export interface LogEntry {
  /** Epoch milliseconds. Missing on entries saved before times were recorded. */
  at?: number;
  cue?: GameCue;
  /** Set on chat messages: who sent it, with their name at the time. */
  from?: { id: string; name: string };
  id: number;
  /** Missing on entries saved before rounds were recorded. */
  round?: number;
  text: string;
}

export interface GameState {
  phase: Phase;
  hostId: string | null;
  players: Player[];
  deck: Card[];
  discard: Card[];
  round: number;
  dealerIndex: number;
  turnId: string | null;
  turnAnchor: number;
  dealQueue: string[];
  flipRuns: FlipThreeSequence[];
  actionQueue: QueuedAction[];
  choice: ActionCardChoice | null;
  winnerIds: string[];
  log: LogEntry[];
  logSeq: number;
  drawSeq?: number;
}

export class GameError extends Error {
  override name = "GameError";
}

export const createGame = () => {
  const state: GameState = {
    actionQueue: [],
    choice: null,
    dealQueue: [],
    dealerIndex: -1,
    deck: [],
    discard: [],
    flipRuns: [],
    hostId: null,
    log: [],
    logSeq: 0,
    phase: "lobby",
    players: [],
    round: 0,
    turnAnchor: 0,
    turnId: null,
    winnerIds: [],
  };

  return state;
};

const record = (
  state: GameState,
  entry: Pick<LogEntry, "cue" | "from" | "text">
) => {
  state.logSeq += 1;
  state.log.push({
    ...entry,
    at: Date.now(),
    id: state.logSeq,
    round: state.round,
  });

  if (state.log.length > LOG_LIMIT) {
    state.log.splice(0, state.log.length - LOG_LIMIT);
  }
};

export const say = (state: GameState, text: string, cue?: GameCue) => {
  record(state, { text, ...(cue && { cue }) });
};

export const findPlayer = (state: GameState, id: string) =>
  state.players.find((player) => player.id === id);

const getPlayer = (state: GameState, id: string) => {
  const player = findPlayer(state, id);

  if (player === undefined) {
    throw new GameError("That player isn't in this room.");
  }

  return player;
};

export const chat = (state: GameState, playerId: string, raw: string) => {
  const player = getPlayer(state, playerId);
  const text = raw.replaceAll(WHITESPACE, " ").trim().slice(0, CHAT_MAX_LENGTH);

  if (text === "") {
    throw new GameError("Type a message first.");
  }

  record(state, { from: { id: player.id, name: player.name }, text });
};

const isActive = (state: GameState, id: string) =>
  findPlayer(state, id)?.status === "active";

const activePlayers = (state: GameState) =>
  state.players.filter((player) => player.status === "active");

const hasSecondChance = (player: Player) =>
  player.hand.some((card) => card.kind === "secondChance");

const removeCard = (player: Player, card: Card) => {
  player.hand = player.hand.filter((held) => held.id !== card.id);
};

const draw = (state: GameState, random: Random) => {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffle(state.discard, random);
    state.discard = [];
    say(state, "The discard pile was shuffled into a new deck.");
  }

  const card = state.deck.pop();

  if (card) {
    state.drawSeq = (state.drawSeq ?? 0) + 1;
  }

  return card;
};

const placeNumberCard = (
  state: GameState,
  player: Player,
  card: NumberCard
) => {
  const duplicate = player.hand.some(
    (held) => held.kind === "number" && held.value === card.value
  );

  if (!duplicate) {
    player.hand.push(card);

    if (countUniqueNumberCards(player.hand) >= FLIP_SEVEN_COUNT) {
      player.status = FLIP_SEVEN_STATUS;
      say(state, `${player.name} earned the Flip 7 bonus!`, "streak");
    }

    return;
  }

  const chance = player.hand.find((held) => held.kind === "secondChance");

  if (chance) {
    removeCard(player, chance);
    state.discard.push(chance, card);
    say(
      state,
      `${player.name} discarded Second Chance and a duplicate ${card.value}.`,
      "special"
    );

    return;
  }

  player.status = "busted";
  player.bustCard = card;
  say(
    state,
    `${player.name} was dealt a duplicate ${card.value} and busted.`,
    "bust"
  );
};

const applyAction = (
  state: GameState,
  owner: Player,
  card: ActionCard,
  targetId: string
) => {
  const target = getPlayer(state, targetId);

  if (card.kind === "freeze") {
    target.hand.push(card);
    target.status = "frozen";
    say(
      state,
      target.id === owner.id
        ? `${owner.name} played Freeze on themselves and banked their points.`
        : `${owner.name} played Freeze on ${target.name}, who banked their points.`,
      "freeze"
    );

    return;
  }

  if (card.kind === "flipThree") {
    target.hand.push(card);
    state.flipRuns.push({
      deferred: [],
      remaining: FLIP_THREE_COUNT,
      targetId: target.id,
    });
    say(
      state,
      target.id === owner.id
        ? `${owner.name} must flip three cards.`
        : `${owner.name} played Flip Three on ${target.name}.`,
      "special"
    );

    return;
  }

  target.hand.push(card);
  say(
    state,
    `${owner.name} gave a Second Chance to ${target.name}.`,
    "special"
  );
};

const offerActionCardChoice = (
  state: GameState,
  owner: Player,
  card: ActionCard,
  options: string[]
) => {
  if (options.length === 0) {
    state.discard.push(card);

    return;
  }

  const [only] = options;

  if (options.length === 1 && only !== undefined) {
    applyAction(state, owner, card, only);

    return;
  }

  state.choice = { card, chooserId: owner.id, options };
};

const startAction = (state: GameState, owner: Player, card: ActionCard) => {
  if (card.kind === "secondChance") {
    if (!hasSecondChance(owner)) {
      owner.hand.push(card);
      say(state, `${owner.name} is holding a Second Chance.`, "special");

      return;
    }

    const options: string[] = [];

    for (const player of activePlayers(state)) {
      if (player.id !== owner.id && !hasSecondChance(player)) {
        options.push(player.id);
      }
    }

    if (options.length === 0) {
      say(state, `${owner.name} discarded an extra Second Chance.`);
    }

    offerActionCardChoice(state, owner, card, options);

    return;
  }

  offerActionCardChoice(
    state,
    owner,
    card,
    activePlayers(state).map((player) => player.id)
  );
};

const resolveDealtCard = (
  state: GameState,
  player: Player,
  card: Card,
  sequence: FlipThreeSequence | null
) => {
  if (card.kind === "number") {
    placeNumberCard(state, player, card);

    return;
  }

  if (!isActionCard(card)) {
    player.hand.push(card);

    return;
  }

  if (sequence && card.kind !== "secondChance") {
    sequence.deferred.push(card);

    return;
  }

  startAction(state, player, card);
};

const nextActiveAfter = (state: GameState, index: number) => {
  const count = state.players.length;

  for (let step = 1; step <= count; step += 1) {
    const candidate = state.players[(index + step) % count];

    if (candidate?.status === "active") {
      return candidate;
    }
  }

  return null;
};

const roundIsOver = (state: GameState) =>
  state.players.some((player) => player.status === FLIP_SEVEN_STATUS) ||
  activePlayers(state).length === 0;

const finishRound = (state: GameState) => {
  for (const sequence of state.flipRuns) {
    state.discard.push(...sequence.deferred);
  }

  state.discard.push(...state.actionQueue.map(({ card }) => card));

  if (state.choice) {
    state.discard.push(state.choice.card);
  }

  state.turnId = null;
  state.dealQueue = [];
  state.flipRuns = [];
  state.actionQueue = [];
  state.choice = null;

  for (const player of state.players) {
    if (player.status === "out") {
      player.lastRound = null;
      continue;
    }

    const score: RoundScore =
      player.status === "busted"
        ? { bonus: 0, doubled: false, numbers: 0, streak: false, total: 0 }
        : calculateRoundScore(player.hand);

    player.lastRound = score;
    player.score += score.total;
  }

  const best = Math.max(...state.players.map((player) => player.score));
  const leaders = state.players.filter((player) => player.score === best);
  const [winner] = leaders;

  if (best >= TARGET_SCORE && leaders.length === 1 && winner !== undefined) {
    state.phase = "gameOver";
    state.winnerIds = [winner.id];
    say(state, `${winner.name} wins with ${best} points!`);

    return;
  }

  state.phase = "roundOver";
  say(
    state,
    best >= TARGET_SCORE
      ? `Round ${state.round} is over. Tied at ${best}, so play continues.`
      : `Round ${state.round} is over.`
  );
};

const stepFlipThreeSequence = (state: GameState, random: Random) => {
  const sequence = state.flipRuns.at(-1);

  if (!sequence) {
    return false;
  }

  if (sequence.remaining === 0 || !isActive(state, sequence.targetId)) {
    state.flipRuns.pop();

    if (findPlayer(state, sequence.targetId)?.status === "busted") {
      state.discard.push(...sequence.deferred);
    } else {
      state.actionQueue.unshift(
        ...sequence.deferred.map((card) => ({
          card,
          ownerId: sequence.targetId,
        }))
      );
    }

    return true;
  }

  const card = draw(state, random);

  if (!card) {
    sequence.remaining = 0;

    return true;
  }

  sequence.remaining -= 1;
  resolveDealtCard(state, getPlayer(state, sequence.targetId), card, sequence);

  return true;
};

const stepActionQueue = (state: GameState) => {
  const queued = state.actionQueue.shift();

  if (!queued) {
    return false;
  }

  const owner = findPlayer(state, queued.ownerId);

  if (owner !== undefined && owner.status !== "busted") {
    startAction(state, owner, queued.card);
  } else {
    state.discard.push(queued.card);
  }

  return true;
};

const stepDeal = (state: GameState, random: Random) => {
  const id = state.dealQueue.shift();

  if (id === undefined) {
    return false;
  }

  const player = findPlayer(state, id);

  if (player?.status !== "active") {
    return true;
  }

  const card = draw(state, random);

  if (card) {
    resolveDealtCard(state, player, card, null);
  }

  return true;
};

const advance = (state: GameState, random: Random) => {
  while (state.phase === "playing" && !state.choice) {
    if (roundIsOver(state)) {
      finishRound(state);

      return;
    }

    const moved =
      stepFlipThreeSequence(state, random) ||
      stepActionQueue(state) ||
      stepDeal(state, random);

    if (moved) {
      continue;
    }

    if (state.turnId !== null && isActive(state, state.turnId)) {
      return;
    }

    const next = nextActiveAfter(state, state.turnAnchor);
    state.turnId = next?.id ?? null;

    return;
  }
};

const assertHost = (state: GameState, playerId: string) => {
  if (state.hostId !== playerId) {
    throw new GameError("Only the host can do that.");
  }
};

const startRound = (state: GameState, random: Random) => {
  for (const player of state.players) {
    state.discard.push(...player.hand);
    player.hand = [];
    player.bustCard = null;
    player.status = "active";
  }

  state.round += 1;
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  state.turnAnchor = state.dealerIndex;
  state.turnId = null;
  state.choice = null;
  state.flipRuns = [];
  state.actionQueue = [];
  state.phase = "playing";
  state.dealQueue = state.players.map(
    (_, offset) =>
      state.players[(state.dealerIndex + 1 + offset) % state.players.length]
        ?.id ?? ""
  );
  const dealer = state.players[state.dealerIndex];
  say(
    state,
    `Round ${state.round} begins. ${dealer?.name ?? "Someone"} deals.`
  );
  advance(state, random);
};

export const addPlayer = (state: GameState, id: string, name: string) => {
  if (state.players.length >= MAX_PLAYERS) {
    throw new GameError(`This room is full (${MAX_PLAYERS} players).`);
  }

  const taken = state.players.some(
    (player) => player.name.toLowerCase() === name.toLowerCase()
  );

  if (taken) {
    throw new GameError(`Someone here is already called ${name}.`);
  }

  state.players.push({
    bustCard: null,
    connected: true,
    hand: [],
    id,
    lastRound: null,
    name,
    score: 0,
    status: "out",
  });
  state.hostId ??= id;
  say(
    state,
    state.phase === "lobby"
      ? `${name} joined.`
      : `${name} joined and will play from the next round.`,
    "join"
  );
};

export const startGame = (
  state: GameState,
  playerId: string,
  random: Random
) => {
  assertHost(state, playerId);

  if (state.phase === "playing" || state.phase === "roundOver") {
    throw new GameError("A game is already running.");
  }

  if (state.players.length < MIN_PLAYERS) {
    throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
  }

  for (const player of state.players) {
    player.score = 0;
    player.hand = [];
    player.lastRound = null;
  }

  state.deck = shuffle(buildDeck(), random);
  state.discard = [];
  state.round = 0;
  state.winnerIds = [];
  state.dealerIndex = Math.floor(random() * state.players.length) - 1;
  startRound(state, random);
};

export const nextRound = (
  state: GameState,
  playerId: string,
  random: Random
) => {
  assertHost(state, playerId);

  if (state.phase !== "roundOver") {
    throw new GameError("The round isn't over yet.");
  }

  startRound(state, random);
};

const assertTurn = (state: GameState, playerId: string) => {
  if (state.phase !== "playing") {
    throw new GameError("No round is being played.");
  }

  if (state.choice) {
    throw new GameError("Waiting for a choice to be made.");
  }

  if (state.turnId !== playerId) {
    throw new GameError("It isn't your turn.");
  }
};

const endTurn = (state: GameState, player: Player) => {
  state.turnAnchor = state.players.indexOf(player);
  state.turnId = null;
};

export const hit = (state: GameState, playerId: string, random: Random) => {
  assertTurn(state, playerId);
  const player = getPlayer(state, playerId);
  endTurn(state, player);
  const card = draw(state, random);

  if (card) {
    resolveDealtCard(state, player, card, null);
  }

  advance(state, random);
};

const stayAndBankPoints = (
  state: GameState,
  player: Player,
  random: Random,
  reason = ""
) => {
  player.status = "stayed";
  say(
    state,
    `${player.name}${reason} stayed and banked ${calculateRoundScore(player.hand).total} points.`,
    "bank"
  );
  endTurn(state, player);
  advance(state, random);
};

/** A player may stay only once they have at least one card in front of them. */
export const canStay = (player: { hand: readonly Card[] }) =>
  player.hand.length > 0;

export const stay = (state: GameState, playerId: string, random: Random) => {
  assertTurn(state, playerId);
  const player = getPlayer(state, playerId);

  if (!canStay(player)) {
    throw new GameError("You need a card in front of you before you can stay.");
  }

  stayAndBankPoints(state, player, random);
};

export const choose = (
  state: GameState,
  playerId: string,
  targetId: string,
  random: Random
) => {
  const { choice } = state;

  if (!choice || choice.chooserId !== playerId) {
    throw new GameError("There's nothing for you to choose.");
  }

  if (!choice.options.includes(targetId)) {
    throw new GameError("You can't choose that player.");
  }

  state.choice = null;
  applyAction(state, getPlayer(state, playerId), choice.card, targetId);
  advance(state, random);
};

const shiftIndex = (index: number, removed: number, count: number) => {
  if (count === 0) {
    return -1;
  }

  return index >= removed ? (index - 1 + count) % count : index;
};

export const removePlayer = (
  state: GameState,
  playerId: string,
  random: Random
) => {
  const index = state.players.findIndex((player) => player.id === playerId);
  const player = state.players[index];

  if (player === undefined) {
    return;
  }

  state.players.splice(index, 1);
  state.discard.push(...player.hand);
  const count = state.players.length;
  state.dealerIndex = shiftIndex(state.dealerIndex, index, count);
  state.turnAnchor = shiftIndex(state.turnAnchor, index, count);
  state.dealQueue = state.dealQueue.filter((id) => id !== playerId);
  state.actionQueue = state.actionQueue.filter(({ ownerId, card }) => {
    if (ownerId === playerId) {
      state.discard.push(card);
    }

    return ownerId !== playerId;
  });

  if (state.turnId === playerId) {
    state.turnId = null;
  }

  if (state.hostId === playerId) {
    state.hostId =
      state.players.find((other) => other.connected)?.id ??
      state.players[0]?.id ??
      null;
  }

  const { choice } = state;

  if (choice?.chooserId === playerId) {
    state.discard.push(choice.card);
    state.choice = null;
  } else if (choice) {
    choice.options = choice.options.filter((id) => id !== playerId);

    if (choice.options.length === 0) {
      state.discard.push(choice.card);
      state.choice = null;
    }
  }

  const playing = state.phase === "playing" || state.phase === "roundOver";

  if (playing && count < MIN_PLAYERS) {
    state.phase = "lobby";
    state.turnId = null;
    state.choice = null;
    state.flipRuns = [];
    state.actionQueue = [];
    state.dealQueue = [];

    for (const remaining of state.players) {
      state.discard.push(...remaining.hand);
      remaining.hand = [];
      remaining.status = "out";
    }

    say(state, "Not enough players left, so the game ended.");

    return;
  }

  advance(state, random);
};

export const backToLobby = (state: GameState, playerId: string) => {
  assertHost(state, playerId);

  if (state.phase !== "gameOver") {
    throw new GameError("Finish the game first.");
  }

  state.phase = "lobby";

  for (const player of state.players) {
    state.discard.push(...player.hand);
    player.hand = [];
    player.status = "out";
    player.bustCard = null;
  }
};

export const transferHost = (state: GameState) => {
  const host =
    state.hostId === null ? undefined : findPlayer(state, state.hostId);

  if (host?.connected === true) {
    return false;
  }

  const next = state.players.find((player) => player.connected);

  if (!next || next.id === state.hostId) {
    return false;
  }

  state.hostId = next.id;
  say(state, `${next.name} is now the host.`);

  return true;
};

/** The player the game is waiting on, if any: whoever must choose a target, or whoever's turn it is. */
export const blockingPlayerId = (
  state: Pick<GameState, "phase" | "choice" | "turnId">
) => {
  if (state.phase !== "playing") {
    return null;
  }

  return state.choice?.chooserId ?? state.turnId;
};

/**
 * Moves the game on for a player who went offline while it waited on them:
 * Plays their Action card on another active player when possible.
 * On a regular turn, chooses Stay if they have a card in front of them and Hit otherwise.
 */
export const playForAbsent = (state: GameState, random: Random) => {
  const id = blockingPlayerId(state);
  const player = id === null ? undefined : findPlayer(state, id);

  if (!player || player.connected) {
    return false;
  }

  const { choice } = state;

  if (choice) {
    const others = choice.options.filter((option) => option !== player.id);
    const pool = others.length > 0 ? others : choice.options;
    const target = pool[Math.floor(random() * pool.length)];

    if (target === undefined) {
      return false;
    }

    say(state, `${player.name} is offline, so their card was played for them.`);
    choose(state, player.id, target, random);

    return true;
  }

  if (!canStay(player)) {
    say(state, `${player.name} is offline and has no cards, so they hit.`);
    hit(state, player.id, random);

    return true;
  }

  stayAndBankPoints(state, player, random, " is offline, so they");

  return true;
};
