import { describe, expect, it } from "vitest";

import type { Card } from "./cards";
import {
  addBot,
  addPlayer,
  createGame,
  hit,
  nextRound,
  startGame,
  stay,
} from "./engine";
import type { GameState } from "./engine";
import { availableMoves, rejectMove, waitingOn } from "./moves";
import type { Move, MovesView } from "./moves";

const random = () => 0.5;

let nextCardId = 5000;

const cardId = () => {
  nextCardId += 1;

  return nextCardId;
};

const num = (value: number) =>
  ({ id: cardId(), kind: "number", value }) satisfies Card;

const freeze = () => ({ id: cardId(), kind: "freeze" }) satisfies Card;

const lobby = (names: string[]) => {
  const state = createGame();

  for (const name of names) {
    addPlayer(state, name, name, 1);
  }

  return state;
};

const round = (names: string[], draws: Card[]) => {
  const state = lobby(names);
  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = names.length - 2;
  state.discard = [];
  state.deck = [...draws].toReversed();
  nextRound(state, "a", random);

  return state;
};

const rig = (state: GameState, draws: Card[]) => {
  state.deck = [...draws].toReversed();
};

const makeBot = (state: GameState, id: string) => {
  const player = state.players.find((candidate) => candidate.id === id);

  if (player) {
    player.bot = true;
  }
};

const goOffline = (state: GameState, id: string) => {
  const player = state.players.find((candidate) => candidate.id === id);

  if (player) {
    player.connected = false;
  }
};

describe(waitingOn, () => {
  it("is nobody outside a round", () => {
    expect(waitingOn(lobby(["a", "b"]))).toBeNull();
  });

  it("is the player whose turn it is, with whether they can stay", () => {
    const state = round(["a", "b"], [num(5), num(3)]);

    expect(waitingOn(state)).toStrictEqual({
      canStay: true,
      offline: false,
      playerId: "a",
    });
  });

  it("is the chooser while an action card waits on a choice", () => {
    const state = round(["a", "b", "c"], [num(5), num(3), num(8)]);
    rig(state, [freeze()]);
    hit(state, "a", random);
    goOffline(state, "a");

    expect(waitingOn(state)).toMatchObject({ offline: true, playerId: "a" });
  });
});

describe(availableMoves, () => {
  it("offers hit and stay on your turn, and nothing to the others", () => {
    const state = round(["a", "b"], [num(5), num(3)]);

    expect(availableMoves(state, "a")).toMatchObject({
      choice: null,
      turn: { canStay: true, forId: undefined },
    });
    expect(availableMoves(state, "b")).toMatchObject({
      choice: null,
      turn: null,
    });
  });

  it("offers the host the move an offline player owes", () => {
    const state = round(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    goOffline(state, "b");

    expect(availableMoves(state, "a").turn).toStrictEqual({
      canStay: true,
      forId: "b",
    });
  });

  it("offers a choice to the chooser, or to the host when the chooser is offline", () => {
    const state = round(["a", "b", "c"], [num(5), num(3), num(8)]);
    stay(state, "a", random);
    rig(state, [freeze()]);
    hit(state, "b", random);

    expect(availableMoves(state, "b").choice).toStrictEqual({
      forId: undefined,
      targets: ["b", "c"],
    });
    expect(availableMoves(state, "a").choice).toBeNull();

    goOffline(state, "b");
    expect(availableMoves(state, "a").choice).toStrictEqual({
      forId: "b",
      targets: ["b", "c"],
    });
    expect(availableMoves(state, "c").choice).toBeNull();
  });

  it("lets the host start once enough players have joined, and kick anyone else", () => {
    expect(availableMoves(lobby(["a"]), "a").host.start).toBeFalsy();
    expect(availableMoves(lobby(["a", "b"]), "a").host).toStrictEqual({
      addBot: true,
      kick: ["b"],
      lobby: false,
      nextRound: false,
      start: true,
    });
    expect(availableMoves(lobby(["a", "b"]), "b").host).toStrictEqual({
      addBot: false,
      kick: [],
      lobby: false,
      nextRound: false,
      start: false,
    });
  });
});

describe(rejectMove, () => {
  it("explains why a move isn't allowed", () => {
    const state = round(["a", "b"], [num(5), num(3)]);

    expect(rejectMove(state, "b", { type: "hit" })).toBe("It isn't your turn.");
    expect(rejectMove(state, "b", { forId: "a", type: "hit" })).toBe(
      "Only the host can do that."
    );
    expect(rejectMove(state, "a", { forId: "b", type: "stay" })).toBe(
      "b is back online, so it's their move."
    );
    expect(rejectMove(state, "a", { type: "nextRound" })).toBe(
      "The round isn't over yet."
    );
    expect(rejectMove(state, "a", { playerId: "a", type: "kick" })).toBe(
      "Use Leave to leave the room."
    );
  });
});

describe("bots", () => {
  it("lets only the host add bots, and only in the lobby", () => {
    const state = lobby(["a", "b"]);

    expect(rejectMove(state, "a", { type: "addBot" })).toBeNull();
    expect(rejectMove(state, "b", { type: "addBot" })).toBe(
      "Only the host can do that."
    );

    const playing = round(["a", "b"], [num(5), num(3)]);

    expect(rejectMove(playing, "a", { type: "addBot" })).toBe(
      "You can only add bots in the lobby."
    );
  });

  it("counts bots toward the player cap", () => {
    const state = lobby(["a"]);

    for (let added = 1; added < 16; added += 1) {
      addBot(state, "a", `bot-${added}`, random);
    }

    expect(rejectMove(state, "a", { type: "addBot" })).toBe(
      "This room is full (16 players)."
    );
  });

  it("lets a lone player start a game against a bot", () => {
    const state = lobby(["a"]);
    addBot(state, "a", "bot", random);

    expect(rejectMove(state, "a", { type: "start" })).toBeNull();
  });

  it("never lets the host move for a bot", () => {
    const state = round(["a", "b"], [num(5), num(3)]);
    stay(state, "a", random);
    makeBot(state, "b");
    goOffline(state, "b");

    expect(rejectMove(state, "a", { forId: "b", type: "hit" })).toBe(
      "Bots make their own moves."
    );
  });
});

const candidateMoves = (state: MovesView) => {
  const ids = state.players.map((player) => player.id);
  const forIds = [undefined, ...ids];

  const moves: Move[] = [
    { type: "start" },
    { type: "nextRound" },
    { type: "lobby" },
    { type: "addBot" },
    ...ids.map((playerId) => ({ playerId, type: "kick" }) satisfies Move),
  ];

  for (const forId of forIds) {
    moves.push({ forId, type: "hit" }, { forId, type: "stay" });

    for (const targetId of ids) {
      moves.push({ forId, targetId, type: "choose" });
    }
  }

  return moves;
};

const offers = (state: MovesView, viewerId: string, move: Move) => {
  const moves = availableMoves(state, viewerId);

  switch (move.type) {
    case "hit":
    case "stay": {
      const { turn } = moves;

      return (
        turn !== null &&
        (turn.forId ?? viewerId) === (move.forId ?? viewerId) &&
        (move.type === "hit" || turn.canStay)
      );
    }

    case "choose": {
      const { choice } = moves;

      return (
        choice !== null &&
        (choice.forId ?? viewerId) === (move.forId ?? viewerId) &&
        choice.targets.includes(move.targetId)
      );
    }

    case "kick": {
      return moves.host.kick.includes(move.playerId);
    }

    case "start":
    case "nextRound":
    case "lobby":
    case "addBot": {
      return moves.host[move.type];
    }

    default: {
      return move satisfies never;
    }
  }
};

const tables = () => {
  const turn = round(["a", "b", "c"], [num(5), num(3), num(8)]);

  const offlineTurn = round(["a", "b"], [num(5), num(3)]);
  stay(offlineTurn, "a", random);
  goOffline(offlineTurn, "b");

  const choice = round(["a", "b", "c"], [num(5), num(3), num(8)]);
  stay(choice, "a", random);
  rig(choice, [freeze()]);
  hit(choice, "b", random);

  const offlineChoice = structuredClone(choice);
  goOffline(offlineChoice, "b");

  const roundOver = round(["a", "b"], [num(5), num(3)]);
  stay(roundOver, "a", random);
  stay(roundOver, "b", random);

  const gameOver = structuredClone(roundOver);
  gameOver.phase = "gameOver";

  const botTurn = round(["a", "b"], [num(5), num(3)]);
  stay(botTurn, "a", random);
  makeBot(botTurn, "b");

  const noCards = round(["a", "b"], [num(5), num(3)]);
  noCards.players[0]?.hand.splice(0);

  return {
    botTurn,
    choice,
    gameOver,
    lobby: lobby(["a", "b"]),
    lonelyLobby: lobby(["a"]),
    noCards,
    offlineChoice,
    offlineTurn,
    roundOver,
    turn,
  };
};

describe("available moves and rejected moves", () => {
  it.each(Object.entries(tables()))(
    "agree on every move at a table with %s",
    (_name, state) => {
      const disagreements: string[] = [];

      for (const viewer of state.players) {
        for (const move of candidateMoves(state)) {
          const offered = offers(state, viewer.id, move);
          const allowed = rejectMove(state, viewer.id, move) === null;

          if (offered !== allowed) {
            disagreements.push(
              `${viewer.id} ${JSON.stringify(move)}: offered ${offered}, allowed ${allowed}`
            );
          }
        }
      }

      expect(disagreements).toStrictEqual([]);
    }
  );
});
