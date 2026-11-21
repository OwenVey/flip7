import {
  advanceActionCards,
  chooseActionCard,
  discardActionCards,
  evictFromActionCards,
  initialActionCards,
  offerActionCardChoice,
  resetActionCards,
  startFlipThree,
} from "./action-card-resolution";
import type { ActionCardState, FlipDraw } from "./action-card-resolution";
import {
  buildDeck,
  FLIP_SEVEN_COUNT,
  isActionCard,
  calculateRoundScore,
  shuffle,
  countUniqueNumberCards,
} from "./cards";
import type { ActionCard, Card, NumberCard, Random, RoundScore } from "./cards";
import { MIN_PLAYERS, rejectMove, waitingOn } from "./moves";
import type { Move } from "./moves";

export const TARGET_SCORE = 200;
export const MAX_PLAYERS = 12;

export { FLIP_THREE_COUNT } from "./action-card-resolution";

export type { ActionCardChoice, HeldCard } from "./action-card-resolution";

/** This status is stored in rooms and sent in WebSocket state messages. */
export const FLIP_SEVEN_STATUS = "streak";
const LOG_LIMIT = 100;
const DRAW_LIMIT = 40;
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
  /**
   * Flip Three cards played on this player. They aren't part of the hand, but
   * stay out of the deck until the round ends. Missing on rooms saved earlier.
   */
  played?: ActionCard[];
}

/**
 * What became of a drawn card: kept in the hand, busted the player, cancelled
 * by Second Chance, held until a Flip Three ends, or played as an action.
 */
export type DrawOutcome = "kept" | "bust" | "saved" | "held" | "action";

/** One card leaving the deck. These are sent in WebSocket state messages. */
export interface DrawEvent {
  seq: number;
  card: Card;
  playerId: string;
  /** Set when the card is one of the flips of a Flip Three. */
  flip: FlipDraw["progress"] | null;
  outcome: DrawOutcome;
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
  /** Which game in this room, counting from 1; 0 before the first game starts. Missing on entries saved before games were counted. */
  game?: number;
  id: number;
  /** Missing on entries saved before rounds were recorded. */
  round?: number;
  text: string;
}

export interface GameState extends ActionCardState {
  phase: Phase;
  hostId: string | null;
  players: Player[];
  deck: Card[];
  discard: Card[];
  round: number;
  /** Games started in this room. Missing on rooms saved before games were counted. */
  games?: number;
  dealerIndex: number;
  turnId: string | null;
  turnAnchor: number;
  dealQueue: string[];
  winnerIds: string[];
  log: LogEntry[];
  logSeq: number;
  drawSeq?: number;
  /** The most recent draws, oldest first. Missing on rooms saved before draws were recorded. */
  draws?: DrawEvent[];
  /** Players dealt Flip Three cards this round, who get Hit or Stay at their opening deal slot. */
  flippedIds?: string[];
  /** The current turn is an opening deal slot, so it doesn't move where play resumes. */
  dealSlotTurn?: boolean;
}

export class GameError extends Error {
  override name = "GameError";
}

export const createGame = () => {
  const state: GameState = {
    ...initialActionCards(),
    dealQueue: [],
    dealerIndex: -1,
    deck: [],
    discard: [],
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
    game: state.games ?? 0,
    id: state.logSeq,
    round: state.round,
  });

  if (state.log.length > LOG_LIMIT) {
    state.log.splice(0, state.log.length - LOG_LIMIT);
  }
};

const pointsLabel = (points: number) =>
  points === 1 ? "1 point" : `${points} points`;

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

const clearTable = (state: GameState, player: Player) => {
  state.discard.push(...player.hand, ...(player.played ?? []));

  if (player.bustCard) {
    state.discard.push(player.bustCard);
  }

  player.hand = [];
  player.played = [];
  player.bustCard = null;
};

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
  owner: Pick<Player, "id" | "name">,
  card: ActionCard,
  targetId: string
) => {
  const target = getPlayer(state, targetId);

  if (card.kind === "freeze") {
    target.hand.push(card);
    target.status = "frozen";
    const banked = pointsLabel(calculateRoundScore(target.hand).total);
    say(
      state,
      target.id === owner.id
        ? `${owner.name} played Freeze on themselves and banked ${banked}.`
        : `${owner.name} played Freeze on ${target.name}, who banked ${banked}.`,
      "freeze"
    );

    return;
  }

  if (card.kind === "flipThree") {
    target.played = [...(target.played ?? []), card];
    startFlipThree(state, target.id);
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

const startAction = (state: GameState, owner: Player, card: ActionCard) => {
  if (card.kind === "secondChance" && !hasSecondChance(owner)) {
    owner.hand.push(card);
    say(state, `${owner.name} is holding a Second Chance.`, "special");

    return;
  }

  const options: string[] = [];

  for (const player of activePlayers(state)) {
    if (
      card.kind !== "secondChance" ||
      (player.id !== owner.id && !hasSecondChance(player))
    ) {
      options.push(player.id);
    }
  }

  if (card.kind === "secondChance" && options.length === 0) {
    say(state, `${owner.name} discarded an extra Second Chance.`);
  }

  const targetId = offerActionCardChoice(state, owner.id, card, options);

  if (targetId !== null) {
    applyAction(state, owner, card, targetId);
  }
};

const numberOutcome = (player: Player, card: NumberCard) => {
  if (player.bustCard?.id === card.id) {
    return "bust" satisfies DrawOutcome;
  }

  return player.hand.some((held) => held.id === card.id)
    ? ("kept" satisfies DrawOutcome)
    : ("saved" satisfies DrawOutcome);
};

const placeDealtCard = (state: GameState, player: Player, card: Card) => {
  if (card.kind === "number") {
    placeNumberCard(state, player, card);

    return numberOutcome(player, card);
  }

  if (!isActionCard(card)) {
    player.hand.push(card);

    return "kept" satisfies DrawOutcome;
  }

  startAction(state, player, card);

  return "action" satisfies DrawOutcome;
};

const resolveDealtCard = (
  state: GameState,
  player: Player,
  card: Card,
  flip?: FlipDraw
) => {
  const outcome =
    flip?.held === true ? "held" : placeDealtCard(state, player, card);

  const draws = state.draws ?? [];

  if (flip && state.flippedIds?.includes(player.id) !== true) {
    state.flippedIds = [...(state.flippedIds ?? []), player.id];
  }

  draws.push({
    card,
    flip: flip?.progress ?? null,
    outcome,
    playerId: player.id,
    seq: state.drawSeq ?? 0,
  });
  state.draws = draws.slice(-DRAW_LIMIT);
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
  discardActionCards(state);
  state.turnId = null;
  state.dealQueue = [];
  state.dealSlotTurn = false;

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

const stepDeal = (state: GameState, random: Random) => {
  const id = state.dealQueue.shift();

  if (id === undefined) {
    return false;
  }

  const player = findPlayer(state, id);

  if (player?.status !== "active") {
    return true;
  }

  if (state.flippedIds?.includes(player.id) === true) {
    state.turnId = player.id;
    state.dealSlotTurn = true;

    return true;
  }

  const card = draw(state, random);

  if (card) {
    resolveDealtCard(state, player, card);
  }

  return true;
};

const advance = (state: GameState, random: Random) => {
  const effects = {
    apply: (
      owner: Pick<Player, "id" | "name">,
      card: ActionCard,
      targetId: string
    ) => {
      applyAction(state, owner, card, targetId);
    },
    draw: () => draw(state, random),
    flip: (playerId: string, card: Card, flip: FlipDraw) => {
      resolveDealtCard(state, getPlayer(state, playerId), card, flip);
    },
    say: (text: string, cue?: GameCue) => {
      say(state, text, cue);
    },
  };

  while (state.phase === "playing" && !state.choice) {
    if (roundIsOver(state)) {
      finishRound(state);

      return;
    }

    if (advanceActionCards(state, effects)) {
      continue;
    }

    if (state.dealSlotTurn === true) {
      if (state.turnId !== null && isActive(state, state.turnId)) {
        return;
      }

      state.dealSlotTurn = false;
      state.turnId = null;
    }

    if (stepDeal(state, random)) {
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

const assertMove = (state: GameState, playerId: string, move: Move) => {
  const reason = rejectMove(state, playerId, move);

  if (reason !== null) {
    throw new GameError(reason);
  }
};

const startRound = (state: GameState, random: Random) => {
  for (const player of state.players) {
    clearTable(state, player);
    player.status = "active";
  }

  state.round += 1;
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  state.turnAnchor = state.dealerIndex;
  state.turnId = null;
  resetActionCards(state);
  state.flippedIds = [];
  state.dealSlotTurn = false;
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
  assertMove(state, playerId, { type: "start" });

  for (const player of state.players) {
    player.score = 0;
    player.hand = [];
    player.played = [];
    player.bustCard = null;
    player.lastRound = null;
  }

  state.deck = shuffle(buildDeck(), random);
  state.discard = [];
  state.games = (state.games ?? 0) + 1;
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
  assertMove(state, playerId, { type: "nextRound" });

  startRound(state, random);
};

const endTurn = (state: GameState, player: Player) => {
  if (state.dealSlotTurn === true) {
    state.dealSlotTurn = false;
  } else {
    state.turnAnchor = state.players.indexOf(player);
  }

  state.turnId = null;
};

export const hit = (state: GameState, playerId: string, random: Random) => {
  assertMove(state, playerId, { type: "hit" });
  const player = getPlayer(state, playerId);
  endTurn(state, player);
  const card = draw(state, random);

  if (card) {
    resolveDealtCard(state, player, card);
  }

  advance(state, random);
};

const stayAndBankPoints = (
  state: GameState,
  player: Player,
  random: Random,
  describe = (banked: string) => `${player.name} stayed and banked ${banked}.`
) => {
  player.status = "stayed";
  say(
    state,
    describe(pointsLabel(calculateRoundScore(player.hand).total)),
    "bank"
  );
  endTurn(state, player);
  advance(state, random);
};

export const stay = (state: GameState, playerId: string, random: Random) => {
  assertMove(state, playerId, { type: "stay" });
  const player = getPlayer(state, playerId);
  stayAndBankPoints(state, player, random);
};

export const choose = (
  state: GameState,
  playerId: string,
  targetId: string,
  random: Random
) => {
  assertMove(state, playerId, { targetId, type: "choose" });

  if (!state.choice) {
    return;
  }

  const card = chooseActionCard(state, targetId, (text, cue) => {
    say(state, text, cue);
  });

  if (card) {
    applyAction(state, getPlayer(state, playerId), card, targetId);
  }

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
  clearTable(state, player);
  const count = state.players.length;
  state.dealerIndex = shiftIndex(state.dealerIndex, index, count);
  state.turnAnchor = shiftIndex(state.turnAnchor, index, count);
  state.dealQueue = state.dealQueue.filter((id) => id !== playerId);
  evictFromActionCards(state, playerId);

  if (state.turnId === playerId) {
    state.turnId = null;
    state.dealSlotTurn = false;
  }

  if (state.hostId === playerId) {
    state.hostId =
      state.players.find((other) => other.connected)?.id ??
      state.players[0]?.id ??
      null;
  }

  const playing = state.phase === "playing" || state.phase === "roundOver";

  if (playing && count < MIN_PLAYERS) {
    state.phase = "lobby";
    state.turnId = null;
    resetActionCards(state);
    state.dealSlotTurn = false;
    state.dealQueue = [];

    for (const remaining of state.players) {
      clearTable(state, remaining);
      remaining.status = "out";
    }

    say(state, "Not enough players left, so the game ended.");

    return;
  }

  advance(state, random);
};

const evict = (
  state: GameState,
  playerId: string,
  random: Random,
  logText: (name: string) => string
) => {
  const player = findPlayer(state, playerId);

  if (!player) {
    throw new GameError("That player already left.");
  }

  removePlayer(state, playerId, random);
  say(state, logText(player.name));
};

/** The host removes another player from the room. */
export const kick = (
  state: GameState,
  hostId: string,
  playerId: string,
  random: Random
) => {
  assertMove(state, hostId, { playerId, type: "kick" });
  evict(state, playerId, random, (name) => `${name} was removed by the host.`);
};

/** A player removes themselves from the room. */
export const leave = (state: GameState, playerId: string, random: Random) => {
  evict(state, playerId, random, (name) => `${name} left.`);
};

export const backToLobby = (state: GameState, playerId: string) => {
  assertMove(state, playerId, { type: "lobby" });

  state.phase = "lobby";
  state.round = 0;

  for (const player of state.players) {
    clearTable(state, player);
    player.status = "out";
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

/**
 * Moves the game on for a player who went offline while it waited on them:
 * Plays their Action card on another active player when possible.
 * On a regular turn, chooses Stay if they have a card in front of them and Hit otherwise.
 */
export const playForAbsent = (state: GameState, random: Random) => {
  const waiting = waitingOn(state);

  if (waiting?.offline !== true) {
    return false;
  }

  const player = getPlayer(state, waiting.playerId);

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

  if (!waiting.canStay) {
    say(state, `${player.name} is offline and has no cards, so they hit.`);
    hit(state, player.id, random);

    return true;
  }

  stayAndBankPoints(
    state,
    player,
    random,
    (banked) =>
      `${player.name} is offline, so they stayed and banked ${banked}.`
  );

  return true;
};

export type MoveForOffline =
  | { type: "hit" }
  | { type: "stay" }
  | { type: "choose"; targetId: string };

/**
 * Lets the host make the move an offline player owes, so a table that can
 * still reach them (on a call, in the same room) needn't wait for the grace
 * period or accept the automatic move.
 */
export const playFor = (
  state: GameState,
  hostId: string,
  playerId: string,
  move: MoveForOffline,
  random: Random
) => {
  assertMove(state, hostId, { ...move, forId: playerId });
  const host = getPlayer(state, hostId);
  const player = getPlayer(state, playerId);

  if (move.type === "choose") {
    say(state, `${host.name} chose for ${player.name}, who is offline.`);
    choose(state, player.id, move.targetId, random);

    return;
  }

  if (move.type === "hit") {
    say(state, `${host.name} hit for ${player.name}, who is offline.`);
    hit(state, player.id, random);

    return;
  }

  stayAndBankPoints(
    state,
    player,
    random,
    (banked) =>
      `${host.name} stayed for ${player.name}, who is offline, and banked ${banked}.`
  );
};
