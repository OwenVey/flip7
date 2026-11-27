import type { Card } from "./cards";
import type { GameState, Player } from "./engine";
import { DEFAULT_SETTINGS } from "./settings";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;

/** What the moves rules read, shared by the engine's state and the room view sent to players. */
export type MovesView = Pick<
  GameState,
  "choice" | "hostId" | "phase" | "turnId"
> & {
  players: readonly Pick<
    Player,
    "bot" | "connected" | "hand" | "id" | "name"
  >[];
};

/** A move on a turn or an action card choice, made by the player, a bot, or the host for an offline player. */
export type PlayMove =
  | { type: "hit" }
  | { type: "stay" }
  | { type: "choose"; targetId: string };

/** A command a player can send, with `forId` set when the host moves for an offline player. */
export type Move =
  | (PlayMove & { forId?: string })
  | { type: "start" }
  | { type: "nextRound" }
  | { type: "lobby" }
  | { type: "addBot" }
  | { type: "configure"; targetScore?: number }
  | { type: "kick"; playerId: string }
  | { type: "makeHost"; playerId: string };

export const MAX_SPECTATORS = 32;

/**
 * Why a seated player can't give up their seat to watch, or null when they can.
 * Only in the lobby, so nobody leaves a hand already dealt; only with room for
 * another Spectator; and never leaving only bots, which would close the room.
 */
export const rejectWatchInstead = (
  view: Pick<MovesView, "phase" | "players">,
  playerId: string,
  spectatorCount: number
) => {
  if (view.phase !== "lobby") {
    return "The game has started. Leave the room to stop playing.";
  }

  if (spectatorCount >= MAX_SPECTATORS) {
    return "The spectator limit has been reached.";
  }

  const others = view.players.filter((player) => player.id !== playerId);

  return others.length > 0 && others.every((player) => player.bot)
    ? "You're the only person playing. Leaving the bots alone would close the room."
    : null;
};

/** A player may stay only once they have at least one card in front of them. */
export const canStay = (player: { hand: readonly Card[] }) =>
  player.hand.length > 0;

const findPlayer = (view: MovesView, id: string) =>
  view.players.find((player) => player.id === id);

/**
 * The player whose move the game needs next, whether they're offline, and
 * whether they could stay (which is what an automatic move would do).
 */
export const waitingOn = (view: MovesView) => {
  if (view.phase !== "playing") {
    return null;
  }

  const id = view.choice?.chooserId ?? view.turnId;
  const player = id === null ? undefined : findPlayer(view, id);

  if (!player) {
    return null;
  }

  return {
    canStay: canStay(player),
    offline: !player.connected,
    playerId: player.id,
  };
};

const rejectTurn = (view: MovesView, playerId: string) => {
  if (view.phase !== "playing") {
    return "No round is being played.";
  }

  if (view.choice) {
    return "Waiting for a choice to be made.";
  }

  if (view.turnId !== playerId) {
    return "It isn't your turn.";
  }

  return null;
};

const rejectPlay = (
  view: MovesView,
  actor:
    | { forOffline: false; playerId: string }
    | { forOffline: true; player: Pick<Player, "hand" | "id" | "name"> },
  move: PlayMove
) => {
  const playerId = actor.forOffline ? actor.player.id : actor.playerId;

  if (move.type === "choose") {
    const { choice } = view;

    if (!actor.forOffline && choice?.chooserId !== playerId) {
      return "There's nothing for you to choose.";
    }

    return choice?.options.includes(move.targetId) === true
      ? null
      : "You can't choose that player.";
  }

  const turn = rejectTurn(view, playerId);

  if (turn !== null || move.type === "hit") {
    return turn;
  }

  const player = actor.forOffline ? actor.player : findPlayer(view, playerId);

  if (player && canStay(player)) {
    return null;
  }

  return actor.forOffline
    ? `${actor.player.name} needs a card in front of them before they can stay.`
    : "You need a card in front of you before you can stay.";
};

const rejectMoveFor = (
  view: MovesView,
  viewerId: string,
  forId: string,
  move: PlayMove
) => {
  if (view.hostId !== viewerId) {
    return "Only the host can do that.";
  }

  const player = findPlayer(view, forId);

  if (!findPlayer(view, viewerId) || !player) {
    return "That player isn't in this room.";
  }

  if (player.bot) {
    return "Bots make their own moves.";
  }

  if (player.connected) {
    return `${player.name} is back online, so it's their move.`;
  }

  if (waitingOn(view)?.playerId !== player.id) {
    return `The game isn't waiting on ${player.name}.`;
  }

  return rejectPlay(view, { forOffline: true, player }, move);
};

const rejectKick = (view: MovesView, viewerId: string, playerId: string) => {
  if (view.hostId !== viewerId) {
    return "Only the host can remove players.";
  }

  if (playerId === viewerId) {
    return "Use Leave to leave the room.";
  }

  return findPlayer(view, playerId) ? null : "That player already left.";
};

const rejectMakeHost = (
  view: MovesView,
  viewerId: string,
  playerId: string
) => {
  if (view.hostId !== viewerId) {
    return "Only the host can hand over hosting.";
  }

  if (playerId === viewerId) {
    return "You're already the host.";
  }

  const player = findPlayer(view, playerId);

  if (!player) {
    return "That player already left.";
  }

  if (player.bot) {
    return "Bots can't be the host.";
  }

  return player.connected
    ? null
    : `${player.name} is offline. Only an online player can be the host.`;
};

type HostMove = Exclude<Move, { type: PlayMove["type"] }>;

const rejectHostMove = (
  view: MovesView,
  viewerId: string | null,
  move: HostMove
) => {
  if (viewerId === null) {
    return "Join the room first.";
  }

  if (move.type === "kick") {
    return rejectKick(view, viewerId, move.playerId);
  }

  if (move.type === "makeHost") {
    return rejectMakeHost(view, viewerId, move.playerId);
  }

  if (view.hostId !== viewerId) {
    return "Only the host can do that.";
  }

  if (move.type === "configure") {
    return move.targetScore === undefined || view.phase === "lobby"
      ? null
      : "You can only change the winning score in the lobby.";
  }

  if (move.type === "addBot") {
    if (view.phase !== "lobby") {
      return "You can only add bots in the lobby.";
    }

    return view.players.length >= MAX_PLAYERS
      ? `This room is full (${MAX_PLAYERS} players).`
      : null;
  }

  if (move.type === "start") {
    if (view.phase === "playing" || view.phase === "roundOver") {
      return "A game is already running.";
    }

    return view.players.length < MIN_PLAYERS
      ? `You need at least ${MIN_PLAYERS} players to start.`
      : null;
  }

  if (move.type === "nextRound") {
    return view.phase === "roundOver" ? null : "The round isn't over yet.";
  }

  return view.phase === "gameOver" ? null : "Finish the game first.";
};

/** Why `viewerId` can't make `move` right now, or null when they can. */
export const rejectMove = (view: MovesView, viewerId: string, move: Move) => {
  switch (move.type) {
    case "hit":
    case "stay":
    case "choose": {
      return move.forId === undefined || move.forId === viewerId
        ? rejectPlay(view, { forOffline: false, playerId: viewerId }, move)
        : rejectMoveFor(view, viewerId, move.forId, move);
    }

    case "start":
    case "nextRound":
    case "lobby":
    case "addBot":
    case "configure":
    case "kick":
    case "makeHost": {
      return rejectHostMove(view, viewerId, move);
    }

    default: {
      return move satisfies never;
    }
  }
};

/**
 * Every move `viewerId` can make right now. `turn` and `choice` carry a
 * `forId` when the host is moving for an offline player.
 */
export const availableMoves = (view: MovesView, viewerId: string | null) => {
  const waiting = waitingOn(view);
  const isHost = viewerId !== null && view.hostId === viewerId;
  const mine = waiting?.playerId === viewerId;
  const forOffline = !mine && isHost && waiting?.offline === true;
  const owed = waiting !== null && (mine || forOffline);
  const forId = forOffline ? waiting?.playerId : undefined;

  const turn =
    owed && !view.choice ? { canStay: waiting.canStay, forId } : null;

  const choice =
    owed && view.choice ? { forId, targets: [...view.choice.options] } : null;

  const allows = (move: HostMove) =>
    rejectHostMove(view, viewerId, move) === null;

  const targetsFor = (type: "kick" | "makeHost") =>
    isHost
      ? view.players.flatMap(({ id }) =>
          allows({ playerId: id, type }) ? [id] : []
        )
      : [];

  const host = {
    addBot: allows({ type: "addBot" }),
    configure: allows({ type: "configure" }),
    kick: targetsFor("kick"),
    lobby: allows({ type: "lobby" }),
    makeHost: targetsFor("makeHost"),
    nextRound: allows({ type: "nextRound" }),
    setTargetScore: allows({
      targetScore: DEFAULT_SETTINGS.targetScore,
      type: "configure",
    }),
    start: allows({ type: "start" }),
  };

  return { choice, host, turn, waitingOn: waiting };
};

export type AvailableMoves = ReturnType<typeof availableMoves>;
