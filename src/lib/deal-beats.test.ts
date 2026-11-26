import { describe, expect, it } from "vitest";

import { addPlayer, choose, hit, nextRound, stay } from "../game/engine";
import { gameAtFirstTurn, random, view } from "../test/deal-game";
import { readTransition } from "./deal-beats";

const freeze = { id: 1003, kind: "freeze" } as const;
const number = { id: 1004, kind: "number", value: 7 } as const;
const flipThree = { id: 1005, kind: "flipThree" } as const;

const cardsOf = (beats: ReturnType<typeof readTransition>) =>
  beats.cards.map(({ landCue, landHaptic, leadIn, settle, step }) => ({
    card: step.card.id,
    landCue,
    landHaptic,
    leadIn: leadIn?.cue ?? null,
    settle: settle?.moment ?? null,
  }));

const felt = (beats: ReturnType<typeof readTransition>) => [
  ...beats.cards.map(({ landHaptic }) => landHaptic),
  beats.settle?.haptic ?? null,
  beats.end.haptic,
];

describe(readTransition, () => {
  it("plays a chosen Flip Three as it lands, then settles the bust it causes", () => {
    const game = gameAtFirstTurn();
    game.deck = [{ ...number, id: 1006 }, number, flipThree];
    hit(game, "a", random);
    const before = view(game);
    choose(game, "a", "a", random);

    const beats = readTransition(before, view(game), "a", true);

    expect({
      cards: cardsOf(beats),
      end: beats.end,
      flipHaptic: beats.cards[1]?.flipHaptic,
      settle: beats.settle?.moment,
      settleCues: beats.settle?.cues,
    }).toStrictEqual({
      cards: [
        {
          card: flipThree.id,
          landCue: "flipThree",
          landHaptic: null,
          leadIn: null,
          settle: null,
        },
        {
          card: number.id,
          landCue: "reveal",
          landHaptic: null,
          leadIn: null,
          settle: null,
        },
        {
          card: 1006,
          landCue: "reveal",
          landHaptic: "bust",
          leadIn: null,
          settle: null,
        },
      ],
      end: { cues: [], haptic: null },
      flipHaptic: "flipThree",
      settle: { kind: "bust", playerId: "a" },
      settleCues: ["bust"],
    });
  });

  it("plays every sound as the room settles when cards don't fly", () => {
    const game = gameAtFirstTurn();
    game.deck = [{ ...number, id: 1006 }, number, flipThree];
    hit(game, "a", random);
    const before = view(game);
    choose(game, "a", "a", random);

    const beats = readTransition(before, view(game), "a", false);

    expect({
      cards: beats.cards,
      end: beats.end,
      settle: beats.settle,
    }).toStrictEqual({
      cards: [],
      end: { cues: ["bust"], haptic: "bust" },
      settle: null,
    });
  });

  it("feels a Freeze only at the frozen player's seat, once", () => {
    const game = gameAtFirstTurn();
    game.deck = [freeze];
    hit(game, "a", random);
    const before = view(game);
    choose(game, "a", "b", random);
    const after = view(game);

    const ben = readTransition(before, after, "b", true);
    const ada = readTransition(before, after, "a", true);

    expect({ ada: felt(ada), ben: felt(ben) }).toStrictEqual({
      ada: [null, null, null],
      ben: ["freeze", null, null],
    });
    expect(ben.settle?.moment).toStrictEqual({
      byId: "a",
      kind: "freeze",
      playerId: "b",
    });
  });

  it("settles a mid-batch Freeze on its target and credits the player who gave it", () => {
    const game = gameAtFirstTurn();
    addPlayer(game, "c", "Cat", 1);
    game.phase = "roundOver";
    game.round = 0;
    game.dealerIndex = 1;
    game.deck = [
      { id: 1003, kind: "number", value: 8 },
      { id: 1002, kind: "number", value: 3 },
      { id: 1001, kind: "number", value: 5 },
    ];
    nextRound(game, "a", random);
    game.deck = [
      { id: 1012, kind: "number", value: 11 },
      { id: 1011, kind: "flipThree" },
      { id: 1010, kind: "freeze" },
      { id: 1009, kind: "number", value: 1 },
      { id: 1008, kind: "flipThree" },
    ];
    hit(game, "a", random);
    choose(game, "a", "c", random);
    choose(game, "c", "b", random);
    const before = view(game);
    choose(game, "c", "b", random);

    const beats = readTransition(before, view(game), "a", true);

    expect(beats.cards[0]?.settle).toStrictEqual({
      cue: "freeze",
      duration: 520,
      moment: { byId: "c", kind: "freeze", playerId: "b" },
    });
    expect(beats.settle?.moment.kind).not.toBe("freeze");
  });

  it("celebrates a Flip 7 that wins the game once, with the Flip 7 moment", () => {
    const game = gameAtFirstTurn();
    const [ada] = game.players;

    if (ada === undefined) {
      throw new Error("Expected Ada at the table");
    }

    ada.score = game.settings.targetScore - 1;
    ada.hand = Array.from({ length: 6 }, (_, value) => ({
      id: 1100 + value,
      kind: "number",
      value,
    }));
    const before = view(game);
    game.deck = [number];
    hit(game, "a", random);
    const after = view(game);

    const winner = readTransition(before, after, "a", true);
    const watcher = readTransition(before, after, null, true);

    expect({
      watcher: [watcher.settle?.haptic, watcher.end],
      winner: [winner.settle?.moment, winner.settle?.haptic, winner.end],
    }).toStrictEqual({
      watcher: [null, { cues: ["win"], haptic: null }],
      winner: [
        { kind: "flipSeven", playerId: "a" },
        "celebrate",
        { cues: ["win"], haptic: null },
      ],
    });
  });

  it("banks a Stay as the settling moment without dealing a card", () => {
    const game = gameAtFirstTurn();
    const before = view(game);
    stay(game, "a", random);

    const beats = readTransition(before, view(game), "b", true);

    expect({
      cards: beats.cards,
      settle: beats.settle?.moment,
      settleCues: beats.settle?.cues,
    }).toStrictEqual({
      cards: [],
      settle: { kind: "stay", playerId: "a", points: 5 },
      settleCues: ["bank"],
    });
  });

  it("holds a dealt action card while someone else chooses who gets it", () => {
    const game = gameAtFirstTurn();
    const before = view(game);
    game.deck = [freeze];
    hit(game, "a", random);
    const after = view(game);

    expect({
      chooser: readTransition(before, after, "a", true).holdsOtherChoice,
      other: readTransition(before, after, "b", true).holdsOtherChoice,
      still: readTransition(before, after, "b", false).holdsOtherChoice,
    }).toStrictEqual({ chooser: false, other: true, still: false });
  });
});
