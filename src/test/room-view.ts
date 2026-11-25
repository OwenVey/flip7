import type { RoomView } from "../game/protocol";

/** When the default room's opening log entry was written. */
export const LOGGED_AT = Date.now();

/** A two-player room mid-round, with Ana (the host) to move. */
export const room = (overrides: Partial<RoomView> = {}) => {
  const view: RoomView = {
    choice: null,
    code: "ABCDE",
    dealerId: "b",
    deckCount: 80,
    discardCount: 0,
    dealSeq: 0,
    drawSeq: 0,
    dealHistory: [],
    flips: [],
    held: [],
    hostId: "a",
    log: [
      {
        about: [],
        at: LOGGED_AT,
        game: 1,
        id: 1,
        round: 1,
        text: "Round 1 begins. Ben deals.",
      },
    ],
    phase: "playing",
    players: [
      {
        avatar: 1,
        bot: false,
        bustCard: null,
        connected: true,
        hand: [{ id: 1, kind: "number", value: 7 }],
        id: "a",
        lastRound: null,
        name: "Ana",
        score: 40,
        status: "active",
      },
      {
        avatar: 1,
        bot: false,
        bustCard: null,
        connected: true,
        hand: [{ id: 2, kind: "number", value: 3 }],
        id: "b",
        lastRound: null,
        name: "Ben",
        score: 12,
        status: "active",
      },
    ],
    round: 1,
    settings: { botSpeed: "normal", locked: false, targetScore: 200 },
    spectatorCount: 0,
    turnId: "a",
    winnerIds: [],
    ...overrides,
  };

  return view;
};
