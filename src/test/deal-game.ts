import { addPlayer, createGame, nextRound, startGame } from "../game/engine";
import type { GameState } from "../game/engine";
import { toRoomView } from "../game/protocol";

/** Fixed randomness, so engine moves in a test play out the same every run. */
export const random = () => 0.5;

/** The room a browser receives for `game`, detached from later engine moves. */
export const view = (game: GameState) =>
  structuredClone(toRoomView("ABCDE", game));

/** Ada and Ben in round 1, with Ada on her first turn and a known deck. */
export const gameAtFirstTurn = () => {
  const game = createGame();
  addPlayer(game, "a", "Ada", 1);
  addPlayer(game, "b", "Ben", 1);
  startGame(game, "a", random);
  game.phase = "roundOver";
  game.round = 0;
  game.dealerIndex = 0;
  game.discard = [];
  game.deck = [
    { id: 1002, kind: "number", value: 3 },
    { id: 1001, kind: "number", value: 5 },
  ];
  nextRound(game, "a", random);

  return game;
};
