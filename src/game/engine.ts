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
import type {
  ActionCardState,
  FlipDraw,
  HeldActionResolution,
} from "./action-card-resolution";
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
import type { ChatReactions, ReactionEmoji } from "./chat-reactions";
import type { GameEvent, LogPlayer, Mover, OfflineMover } from "./game-events";
import { MAX_PLAYERS, MIN_PLAYERS, rejectMove, waitingOn } from "./moves";
import type { Move, PlayMove } from "./moves";
import { nameKey, sameName } from "./names";
import type { Player, RoundStatus } from "./player";
import { DEFAULT_SETTINGS } from "./settings";
import type { RoomSettings } from "./settings";
import { CHAT_TEXT_LIMIT, clipText } from "./text";

export { MAX_PLAYERS } from "./moves";

export { FLIP_THREE_COUNT } from "./action-card-resolution";

export type { ActionCardChoice, HeldCard } from "./action-card-resolution";

export type { GameEvent, LogPlayer } from "./game-events";

export type { Player, RoundStatus } from "./player";

/** The most log entries a room keeps. The log starts over each game, so this only guards against runaway chat. */
export const LOG_LIMIT = 1000;

/** How many draws and held action resolutions each Room keeps for Deal playback. */
export const DEAL_HISTORY_LIMIT = 40;
export const CHAT_MAX_LENGTH = CHAT_TEXT_LIMIT.graphemes;
const WHITESPACE = /\s+/gu;

export const PHASES = ["lobby", "playing", "roundOver", "gameOver"] as const;

export type Phase = (typeof PHASES)[number];

/**
 * What became of a drawn card: kept in the hand, busted the player, cancelled
 * by Second Chance, held until a Flip Three ends, or played as an action.
 */
export const DRAW_OUTCOMES = [
  "kept",
  "bust",
  "saved",
  "held",
  "action",
] as const;

export type DrawOutcome = (typeof DRAW_OUTCOMES)[number];

/** One card leaving the deck. These are sent in WebSocket state messages. */
export interface DrawEvent {
  type: "draw";
  card: Card;
  playerId: string;
  /** Set when the card is one of the flips of a Flip Three. */
  flip: FlipDraw["progress"] | null;
  outcome: DrawOutcome;
  hit?: true;
}

type UnsequencedDealEvent =
  | DrawEvent
  | ({ type: "heldAction" } & HeldActionResolution);

export type DealEvent = UnsequencedDealEvent & { seq: number };

export interface LogEntryBase {
  /** Epoch milliseconds. */
  at: number;
  /** Which game in this room, counting from 1; 0 before the first game starts. */
  game: number;
  id: number;
  round: number;
}

/** A chat message, with its sender's name and avatar at the time. */
export interface ChatEntry extends LogEntryBase {
  from: LogPlayer & Pick<Player, "avatar">;
  text: string;
}

/** Something that happened in the game. */
export interface EventEntry extends LogEntryBase {
  event: GameEvent;
}

export type LogEntry = ChatEntry | EventEntry;

export const isChat = (entry: LogEntry) => "from" in entry;

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
  /** Players still to be dealt an opening card this round, in deal order. */
  openingSlots: string[];
  winnerIds: string[];
  winner: (LogPlayer & { points: number }) | null;
  /** This game's log, oldest first. Cleared when a game starts. */
  log: LogEntry[];
  chatReactions: ChatReactions;
  /** The id of the newest log entry. Never reset, so ids stay unique for the life of the room. */
  logSeq: number;
  /** `logSeq` when the log was last cleared. */
  logClearedAt: number;
  /** Counts cards drawn for the life of the room. */
  drawSeq: number;
  /** The newest Deal playback event's sequence, never reset. */
  dealSeq: number;
  /** Recent draws and held action resolutions in execution order. */
  dealHistory: DealEvent[];
  /** Players who have taken Flip Three draws this round. They get Hit or Stay at their opening slot instead of a dealt card. */
  flipThreeTargetIds: string[];
  /** The current turn is an opening slot, so it doesn't move where play resumes. */
  atOpeningSlot: boolean;
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
    openingSlots: [],
    atOpeningSlot: false,
    dealerIndex: -1,
    deck: [],
    discard: [],
    dealHistory: [],
    dealSeq: 0,
    drawSeq: 0,
    evictedCards: [],
    flipThreeTargetIds: [],
    games: 0,
    hostId: null,
    log: [],
    chatReactions: new Map(),
    logClearedAt: 0,
    logSeq: 0,
    outOfCards: false,
    phase: "lobby",
    players: [],
    round: 0,
    settings: { ...DEFAULT_SETTINGS },
    turnAnchor: 0,
    turnId: null,
    winner: null,
    winnerIds: [],
  };

  return state;
};

const record = (
  state: GameState,
  entry: Pick<ChatEntry, "from" | "text"> | Pick<EventEntry, "event">
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
    for (const removed of state.log.splice(0, state.log.length - LOG_LIMIT)) {
      state.chatReactions.delete(removed.id);
    }
  }
};

/** Records a game event in the log. */
export const say = (state: GameState, event: GameEvent) => {
  record(state, { event });
};

/** A player as the log names them now. */
export const named = ({ id, name }: LogPlayer) =>
  ({ id, name }) satisfies LogPlayer;

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

  const text = clipText(
    raw.replaceAll(WHITESPACE, " ").trim(),
    CHAT_TEXT_LIMIT
  );

  if (text === "") {
    throw new GameError("Type a message first.");
  }

  record(state, {
    from: { avatar: player.avatar, id: player.id, name: player.name },
    text,
  });
};

export const reactToChat = (
  state: GameState,
  playerId: string,
  messageId: number,
  emoji: ReactionEmoji | null
) => {
  getPlayer(state, playerId);

  const message = state.log.find((entry) => entry.id === messageId);

  if (!message || !isChat(message)) {
    throw new GameError("That chat message is no longer available.");
  }

  const byPlayer = state.chatReactions.get(messageId) ?? new Map();

  if (emoji === null) {
    byPlayer.delete(playerId);
  } else {
    byPlayer.set(playerId, emoji);
  }

  if (byPlayer.size === 0) {
    state.chatReactions.delete(messageId);
  } else {
    state.chatReactions.set(messageId, byPlayer);
  }
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
    say(state, { type: "deckReshuffled" });
  }

  const card = state.deck.pop();

  if (card) {
    state.drawSeq += 1;
  } else if (!state.outOfCards) {
    state.outOfCards = true;
    say(state, { type: "outOfCards" });
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
      say(state, { player: named(player), type: "flipSeven" });
    }

    return;
  }

  const chance = player.hand.find((held) => held.kind === "secondChance");

  if (chance) {
    removeCard(player, chance);
    state.discard.push(chance, card);
    say(state, {
      card: card.value,
      player: named(player),
      type: "secondChanceUsed",
    });

    return;
  }

  player.status = "busted";
  player.bustCard = card;
  say(state, { card: card.value, player: named(player), type: "busted" });
};

const applyAction = (
  state: GameState,
  owner: LogPlayer | null,
  card: ActionCard,
  targetId: string
) => {
  const target = getPlayer(state, targetId);
  const by = owner && named(owner);

  if (card.kind === "freeze") {
    target.hand.push(card);
    target.status = "frozen";
    say(state, {
      by,
      points: calculateRoundScore(target.hand).total,
      target: named(target),
      type: "frozen",
    });

    return;
  }

  if (card.kind === "flipThree") {
    startFlipThree(state, target.id, card);
    say(state, { by, target: named(target), type: "flipThreeStarted" });

    return;
  }

  target.hand.push(card);
  say(state, { by, target: named(target), type: "secondChanceGiven" });
};

const startAction = (state: GameState, owner: Player, card: ActionCard) => {
  if (card.kind === "secondChance" && !hasSecondChance(owner)) {
    owner.hand.push(card);
    say(state, { player: named(owner), type: "secondChanceKept" });

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
    say(state, { player: named(owner), type: "secondChanceDiscarded" });
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

const recordDeal = (state: GameState, event: UnsequencedDealEvent) => {
  state.dealSeq += 1;
  state.dealHistory = [
    ...state.dealHistory,
    { ...event, seq: state.dealSeq },
  ].slice(-DEAL_HISTORY_LIMIT);
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

  if (flip && !state.flipThreeTargetIds.includes(player.id)) {
    state.flipThreeTargetIds = [...state.flipThreeTargetIds, player.id];
  }

  recordDeal(state, {
    card,
    flip: flip?.progress ?? null,
    ...(source === "hit" && { hit: true }),
    outcome,
    playerId: player.id,
    type: "draw",
  });
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
  state.openingSlots = [];
  state.atOpeningSlot = false;

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

  const scores = state.players.flatMap((player) =>
    player.lastRound === null
      ? []
      : [{ id: player.id, name: player.name, points: player.lastRound.total }]
  );

  const best = Math.max(...state.players.map((player) => player.score));
  const leaders = state.players.filter((player) => player.score === best);
  const [winner] = leaders;
  const { targetScore } = state.settings;

  if (best >= targetScore && leaders.length === 1 && winner !== undefined) {
    state.phase = "gameOver";
    state.winnerIds = [winner.id];
    state.winner = { ...named(winner), points: best };
    say(state, {
      player: named(winner),
      points: best,
      scores,
      type: "gameWon",
    });

    return;
  }

  state.phase = "roundOver";
  say(state, {
    scores,
    tiedAt: best >= targetScore ? best : null,
    type: "roundOver",
  });
};

const stepDeal = (state: GameState, random: Random) => {
  const id = state.openingSlots.shift();

  if (id === undefined) {
    return false;
  }

  const player = findPlayer(state, id);

  if (player?.status !== "active") {
    return true;
  }

  if (state.flipThreeTargetIds.includes(player.id)) {
    state.turnId = player.id;
    state.atOpeningSlot = true;

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
    apply: (owner: LogPlayer | null, card: ActionCard, targetId: string) => {
      applyAction(state, owner, card, targetId);
    },
    draw: () => draw(state, random),
    flip: (playerId: string, card: Card, flip: FlipDraw) => {
      resolveDealtCard(state, getPlayer(state, playerId), card, flip);
    },
    resolveHeld: (resolution: HeldActionResolution) => {
      recordDeal(state, { ...resolution, type: "heldAction" });
    },
    say: (event: GameEvent) => {
      say(state, event);
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

    if (state.atOpeningSlot) {
      if (state.turnId !== null && isActive(state, state.turnId)) {
        return;
      }

      state.atOpeningSlot = false;
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
  state.flipThreeTargetIds = [];
  state.atOpeningSlot = false;
  state.outOfCards = false;
  state.phase = "playing";
  state.openingSlots = state.players.map(
    (_, offset) =>
      state.players[(state.dealerIndex + 1 + offset) % state.players.length]
        ?.id ?? ""
  );
  const dealer = state.players[state.dealerIndex];
  say(state, {
    dealer: dealer === undefined ? null : named(dealer),
    type: "roundStarted",
  });
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

  const taken = state.players.some((player) => sameName(player.name, name));

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
  say(state, {
    player: { id, name },
    type: "joined",
    waitsFor: state.phase === "lobby" ? null : next,
  });
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
  const taken = new Set(state.players.map((player) => nameKey(player.name)));

  const free = BOT_NAMES.filter((name) => !taken.has(nameKey(name)));
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
  say(state, { player: { id, name }, type: "botAdded" });

  return name;
};

const announceSettings = (
  state: GameState,
  before: RoomSettings,
  after: RoomSettings
) => {
  if (after.targetScore !== before.targetScore) {
    say(state, { targetScore: after.targetScore, type: "targetScoreSet" });
  }

  if (after.botSpeed !== before.botSpeed) {
    say(state, { botSpeed: after.botSpeed, type: "botSpeedSet" });
  }

  if (after.locked !== before.locked) {
    say(state, { locked: after.locked, type: "lockSet" });
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
  state.chatReactions.clear();
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
  state.winner = null;
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
  if (state.atOpeningSlot) {
    state.atOpeningSlot = false;
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
  by: Mover
) => {
  player.status = "stayed";
  say(state, {
    by,
    player: named(player),
    points: calculateRoundScore(player.hand).total,
    type: "stayed",
  });
  endTurn(state, player);
  advance(state, random);
};

export const stay = (state: GameState, playerId: string, random: Random) => {
  assertMove(state, playerId, { type: "stay" });
  const player = getPlayer(state, playerId);
  stayAndBankPoints(state, player, random, { kind: "player" });
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

  const card = chooseActionCard(state, targetId, (event) => {
    say(state, event);
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
  state.openingSlots = state.openingSlots.filter((id) => id !== playerId);
  evictFromActionCards(state, playerId);

  if (state.turnId === playerId) {
    state.turnId = null;
    state.atOpeningSlot = false;
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
    state.atOpeningSlot = false;
    state.openingSlots = [];

    clearRoundTable(state, "out");

    say(state, { type: "gameAbandoned" });

    return;
  }

  advance(state, random);
};

const evict = (
  state: GameState,
  playerId: string,
  random: Random,
  how: Extract<GameEvent, { type: "evicted" }>["how"]
) => {
  const player = findPlayer(state, playerId);

  if (!player) {
    throw new GameError("That player already left.");
  }

  removePlayer(state, playerId, random);
  say(state, { how, player: named(player), type: "evicted" });
};

/** The host removes another player from the room. */
export const kick = (
  state: GameState,
  hostId: string,
  playerId: string,
  random: Random
) => {
  assertMove(state, hostId, { playerId, type: "kick" });
  evict(state, playerId, random, "kicked");
};

/** A player removes themselves from the room. */
export const leave = (state: GameState, playerId: string, random: Random) => {
  evict(state, playerId, random, "left");
};

/** A player gives up their seat to keep watching the room. */
export const leaveToWatch = (
  state: GameState,
  playerId: string,
  random: Random
) => {
  evict(state, playerId, random, "leftToWatch");
};

export const backToLobby = (state: GameState, playerId: string) => {
  assertMove(state, playerId, { type: "lobby" });

  state.phase = "lobby";
  state.round = 0;

  clearRoundTable(state, "out");
};

/** The host hands hosting to another connected human. */
export const makeHost = (
  state: GameState,
  hostId: string,
  playerId: string
) => {
  assertMove(state, hostId, { playerId, type: "makeHost" });

  const host = findPlayer(state, hostId);
  const next = findPlayer(state, playerId);

  if (!host || !next) {
    throw new GameError("That player already left.");
  }

  state.hostId = next.id;
  say(state, {
    by: named(host),
    how: "given",
    player: named(next),
    type: "hostChanged",
  });
};

/** Hands hosting to the first connected human once the host has been offline too long. */
export const handOffHost = (state: GameState) => {
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
  say(state, { how: "auto", player: named(next), type: "hostChanged" });

  return true;
};

const sayMovedFor = (
  state: GameState,
  player: Player,
  move: "hit" | "choose",
  by: OfflineMover
) => {
  say(state, { by, move, player: named(player), type: "movedForOffline" });
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

    sayMovedFor(state, player, "choose", { kind: "game" });
    choose(state, player.id, target, random);

    return true;
  }

  if (!waiting.canStay) {
    sayMovedFor(state, player, "hit", { kind: "game" });
    hit(state, player.id, random);

    return true;
  }

  stayAndBankPoints(state, player, random, { kind: "game" });

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

/**
 * Lets the host make the move an offline player owes, so a table that can
 * still reach them (on a call, in the same room) needn't wait for the grace
 * period or accept the automatic move.
 */
export const playFor = (
  state: GameState,
  hostId: string,
  playerId: string,
  move: PlayMove,
  random: Random
) => {
  assertMove(state, hostId, { ...move, forId: playerId });

  const hostMove = {
    host: named(getPlayer(state, hostId)),
    kind: "host",
  } satisfies OfflineMover;

  const player = getPlayer(state, playerId);

  if (move.type === "choose") {
    sayMovedFor(state, player, "choose", hostMove);
    choose(state, player.id, move.targetId, random);

    return;
  }

  if (move.type === "hit") {
    sayMovedFor(state, player, "hit", hostMove);
    hit(state, player.id, random);

    return;
  }

  stayAndBankPoints(state, player, random, hostMove);
};
