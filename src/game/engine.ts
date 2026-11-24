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
import { decideBotMove } from "./bot";
import {
  buildDeck,
  FLIP_SEVEN_COUNT,
  isActionCard,
  calculateRoundScore,
  shuffle,
  countUniqueNumberCards,
} from "./cards";
import type { ActionCard, Card, NumberCard, Random, RoundScore } from "./cards";
import { MAX_PLAYERS, MIN_PLAYERS, rejectMove, waitingOn } from "./moves";
import type { Move } from "./moves";
import { DEFAULT_SETTINGS } from "./settings";
import type { RoomSettings } from "./settings";

/** The winning score a room starts with. */
export const TARGET_SCORE = DEFAULT_SETTINGS.targetScore;

export { MAX_PLAYERS } from "./moves";

export { FLIP_THREE_COUNT } from "./action-card-resolution";

export type { ActionCardChoice, HeldCard } from "./action-card-resolution";

/** The most log entries a room keeps. The log starts over each game, so this only guards against runaway chat. */
export const LOG_LIMIT = 1000;

/** The most recent draws a room keeps, enough for deal playback to replay one update card by card. */
export const DRAW_LIMIT = 40;
export const CHAT_MAX_LENGTH = 200;
const WHITESPACE = /\s+/gu;

export type Phase = "lobby" | "playing" | "roundOver" | "gameOver";

export type RoundStatus =
  | "out"
  | "active"
  | "stayed"
  | "frozen"
  | "busted"
  | "flipSeven";

export interface Player {
  id: string;
  name: string;
  score: number;
  /** Bots are always connected. */
  connected: boolean;
  /** Set on players the room plays itself. */
  bot: boolean;
  /** The avatar a person picked, or null for a bot. */
  avatar: number | null;
  status: RoundStatus;
  hand: Card[];
  bustCard: Card | null;
  lastRound: RoundScore | null;
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
  hit?: true;
}

export type GameCue =
  | "bank"
  | "bust"
  | "freeze"
  | "join"
  | "special"
  | "flipSeven";

export interface LogEntry {
  /** Epoch milliseconds. */
  at: number;
  cue?: GameCue;
  /** Set on chat messages: who sent it, with their name and avatar at the time. */
  from?: { id: string; name: string; avatar: number | null };
  /** Which game in this room, counting from 1; 0 before the first game starts. */
  game: number;
  id: number;
  round: number;
  text: string;
}

export interface GameState extends ActionCardState {
  phase: Phase;
  hostId: string | null;
  players: Player[];
  deck: Card[];
  discard: Card[];
  /** Table cards from evicted players, held until round cleanup. */
  evictedCards: Card[];
  round: number;
  /** Games started in this room. */
  games: number;
  dealerIndex: number;
  turnId: string | null;
  turnAnchor: number;
  dealQueue: string[];
  winnerIds: string[];
  /** This game's log, oldest first. Cleared when a game starts. */
  log: LogEntry[];
  /** The id of the newest log entry. Never reset, so ids stay unique for the life of the room. */
  logSeq: number;
  /** `logSeq` when the log was last cleared. */
  logClearedAt: number;
  /** The seq of the newest draw. Never reset, so draws keep unique seqs for the life of the room. */
  drawSeq: number;
  /** The most recent draws, oldest first. */
  draws: DrawEvent[];
  /** Players dealt Flip Three cards this round, who get Hit or Stay at their opening deal slot. */
  flippedIds: string[];
  /** The current turn is an opening deal slot, so it doesn't move where play resumes. */
  dealSlotTurn: boolean;
  /**
   * A draw found both the deck and the discard pile empty, so the round ends
   * and every player who hasn't busted scores what they hold.
   */
  outOfCards: boolean;
  /** How the host set up the room. */
  settings: RoomSettings;
}

export class GameError extends Error {
  override name = "GameError";
}

export const createGame = () => {
  const state: GameState = {
    ...initialActionCards(),
    dealQueue: [],
    dealSlotTurn: false,
    dealerIndex: -1,
    deck: [],
    discard: [],
    drawSeq: 0,
    draws: [],
    evictedCards: [],
    flippedIds: [],
    games: 0,
    hostId: null,
    log: [],
    logClearedAt: 0,
    logSeq: 0,
    outOfCards: false,
    phase: "lobby",
    players: [],
    round: 0,
    settings: { ...DEFAULT_SETTINGS },
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
    game: state.games,
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

  record(state, {
    from: { avatar: player.avatar, id: player.id, name: player.name },
    text,
  });
};

const isActive = (state: GameState, id: string) =>
  findPlayer(state, id)?.status === "active";

const activePlayers = (state: GameState) =>
  state.players.filter((player) => player.status === "active");

const hasSecondChance = (player: Player) =>
  player.hand.some((card) => card.kind === "secondChance");

const clearTable = (cards: Card[], player: Player) => {
  cards.push(...player.hand);

  if (player.bustCard) {
    cards.push(player.bustCard);
  }

  player.hand = [];
  player.bustCard = null;
};

const clearRoundTable = (state: GameState, status: RoundStatus) => {
  state.discard.push(...state.evictedCards);
  state.evictedCards = [];

  for (const player of state.players) {
    clearTable(state.discard, player);
    player.status = status;
  }
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
    state.drawSeq += 1;
  } else if (!state.outOfCards) {
    state.outOfCards = true;
    say(state, "No cards are left to draw, so the round ends.");
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
      player.status = "flipSeven";
      say(state, `${player.name} earned the Flip 7 bonus!`, "flipSeven");
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
    startFlipThree(state, target.id, card);
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
  source?: FlipDraw | "hit"
) => {
  const flip = source === "hit" ? undefined : source;

  const outcome =
    flip?.held === true ? "held" : placeDealtCard(state, player, card);

  if (flip && !state.flippedIds.includes(player.id)) {
    state.flippedIds = [...state.flippedIds, player.id];
  }

  state.draws.push({
    card,
    flip: flip?.progress ?? null,
    ...(source === "hit" && { hit: true }),
    outcome,
    playerId: player.id,
    seq: state.drawSeq,
  });
  state.draws = state.draws.slice(-DRAW_LIMIT);
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
  state.outOfCards ||
  state.players.some((player) => player.status === "flipSeven") ||
  activePlayers(state).length === 0;

const finishRound = (state: GameState) => {
  discardActionCards(state);
  state.outOfCards = false;
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
        ? {
            doubled: false,
            flipSeven: false,
            modifiers: 0,
            numbers: 0,
            total: 0,
          }
        : calculateRoundScore(player.hand);

    player.lastRound = score;
    player.score += score.total;
  }

  const best = Math.max(...state.players.map((player) => player.score));
  const leaders = state.players.filter((player) => player.score === best);
  const [winner] = leaders;
  const { targetScore } = state.settings;

  if (best >= targetScore && leaders.length === 1 && winner !== undefined) {
    state.phase = "gameOver";
    state.winnerIds = [winner.id];
    say(state, `${winner.name} wins with ${best} points!`);

    return;
  }

  state.phase = "roundOver";
  say(
    state,
    best >= targetScore
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

  if (state.flippedIds.includes(player.id)) {
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

    if (state.dealSlotTurn) {
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
  clearRoundTable(state, "active");

  state.round += 1;
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  state.turnAnchor = state.dealerIndex;
  state.turnId = null;
  resetActionCards(state);
  state.flippedIds = [];
  state.dealSlotTurn = false;
  state.outOfCards = false;
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

export const addPlayer = (
  state: GameState,
  id: string,
  name: string,
  avatar: number
) => {
  if (state.players.length >= MAX_PLAYERS) {
    throw new GameError(`This room is full (${MAX_PLAYERS} players).`);
  }

  if (state.settings.locked && state.players.length > 0) {
    throw new GameError("This room is locked. Ask the host to unlock it.");
  }

  const taken = state.players.some(
    (player) => player.name.toLowerCase() === name.toLowerCase()
  );

  if (taken) {
    throw new GameError(`Someone here is already called ${name}.`);
  }

  state.players.push({
    avatar,
    bot: false,
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

  const next = state.phase === "gameOver" ? "game" : "round";
  say(
    state,
    state.phase === "lobby"
      ? `${name} joined.`
      : `${name} joined and will play in the next ${next}.`,
    "join"
  );
};

const BOT_NAMES = [
  "Ember",
  "Blaze",
  "Cinder",
  "Flare",
  "Sparky",
  "Ash",
  "Torch",
  "Kindle",
  "Scorch",
  "Fuse",
  "Wick",
  "Flint",
  "Pyro",
  "Smolder",
  "Glow",
  "Sizzle",
] as const;

const botName = (state: GameState, random: Random) => {
  const taken = new Set(
    state.players.map((player) => player.name.toLowerCase())
  );

  const free = BOT_NAMES.filter((name) => !taken.has(name.toLowerCase()));
  const picked = free[Math.floor(random() * free.length)];

  if (picked !== undefined) {
    return picked;
  }

  let number = 1;

  while (taken.has(`bot ${number}`)) {
    number += 1;
  }

  return `Bot ${number}`;
};

/** The host seats a bot, which the room plays itself. */
export const addBot = (
  state: GameState,
  hostId: string,
  id: string,
  random: Random
) => {
  assertMove(state, hostId, { type: "addBot" });

  const name = botName(state, random);

  state.players.push({
    avatar: null,
    bot: true,
    bustCard: null,
    connected: true,
    hand: [],
    id,
    lastRound: null,
    name,
    score: 0,
    status: "out",
  });
  say(state, `The host added ${name}, a bot.`, "join");

  return name;
};

const announceSettings = (
  state: GameState,
  before: RoomSettings,
  after: RoomSettings
) => {
  if (after.targetScore !== before.targetScore) {
    say(state, `The host set the winning score to ${after.targetScore}.`);
  }

  if (after.botSpeed !== before.botSpeed) {
    say(
      state,
      after.botSpeed === "fast"
        ? "The host sped up the bots."
        : "The host set the bots back to normal speed."
    );
  }

  if (after.locked !== before.locked) {
    say(
      state,
      after.locked
        ? "The host locked the room. New players can't join."
        : "The host unlocked the room."
    );
  }
};

/** The host changes how the room is set up. */
export const configure = (
  state: GameState,
  hostId: string,
  changes: Partial<RoomSettings>
) => {
  assertMove(state, hostId, {
    targetScore: changes.targetScore,
    type: "configure",
  });

  const before = state.settings;
  const after: RoomSettings = { ...before, ...changes };
  state.settings = after;
  announceSettings(state, before, after);
};

/** Whether anyone in the room is a person rather than a bot. */
export const hasHumans = (state: GameState) =>
  state.players.some((player) => !player.bot);

const isOnlineHuman = (player: Player) => player.connected && !player.bot;

export const startGame = (
  state: GameState,
  playerId: string,
  random: Random
) => {
  assertMove(state, playerId, { type: "start" });

  state.log = [];
  state.logClearedAt = state.logSeq;

  for (const player of state.players) {
    player.score = 0;
    player.hand = [];
    player.bustCard = null;
    player.lastRound = null;
  }

  state.deck = shuffle(buildDeck(), random);
  state.discard = [];
  state.evictedCards = [];
  state.games += 1;
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
  if (state.dealSlotTurn) {
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
    resolveDealtCard(state, player, card, "hit");
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

  const tableCards =
    state.phase === "lobby" ? state.discard : state.evictedCards;

  clearTable(tableCards, player);

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
      state.players.find(isOnlineHuman)?.id ??
      state.players.find((other) => !other.bot)?.id ??
      null;
  }

  const playing = state.phase === "playing" || state.phase === "roundOver";

  if (playing && count < MIN_PLAYERS) {
    state.phase = "lobby";
    state.turnId = null;
    discardActionCards(state);
    state.dealSlotTurn = false;
    state.dealQueue = [];

    clearRoundTable(state, "out");

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

  clearRoundTable(state, "out");
};

export const transferHost = (state: GameState) => {
  const host =
    state.hostId === null ? undefined : findPlayer(state, state.hostId);

  if (host?.connected === true) {
    return false;
  }

  const next = state.players.find(isOnlineHuman);

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

    say(state, `${player.name} is offline, so the game played their card.`);
    choose(state, player.id, target, random);

    return true;
  }

  if (!waiting.canStay) {
    say(
      state,
      `${player.name} is offline and has no cards, so the game hit for them.`
    );
    hit(state, player.id, random);

    return true;
  }

  stayAndBankPoints(
    state,
    player,
    random,
    (banked) =>
      `${player.name} is offline, so the game stayed for them and banked ${banked}.`
  );

  return true;
};

/** Makes the move a bot owes. Returns false when the game isn't waiting on a bot. */
export const playForBot = (state: GameState, random: Random) => {
  const waiting = waitingOn(state);

  const player =
    waiting === null ? undefined : findPlayer(state, waiting.playerId);

  if (player?.bot !== true) {
    return false;
  }

  const move = decideBotMove(
    {
      choice: state.choice,
      players: state.players,
      targetScore: state.settings.targetScore,
    },
    player.id
  );

  if (!move) {
    return false;
  }

  if (move.type === "choose") {
    choose(state, player.id, move.targetId, random);
  } else if (move.type === "hit") {
    hit(state, player.id, random);
  } else {
    stay(state, player.id, random);
  }

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
