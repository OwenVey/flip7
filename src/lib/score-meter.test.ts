import { describe, expect, it } from "vitest";

import type { Card } from "../game/cards";
import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { scoreMeter } from "./score-meter";

const SEVEN: Card = { id: 1, kind: "number", value: 7 };
const FIVE: Card = { id: 2, kind: "number", value: 5 };

const player = (
  status: Player["status"],
  score = 40,
  hand: Card[] = [SEVEN, FIVE]
) => ({ hand, score, status });

const cases: {
  name: string;
  args: [ReturnType<typeof player>, RoomView["phase"], number, number];
  expected: ReturnType<typeof scoreMeter>;
}[] = [
  {
    args: [player("active"), "playing", 12, 200],
    expected: {
      atTarget: false,
      banked: 40,
      details: ["12 this round"],
      lost: 0,
      projected: 52,
      risk: "at-risk",
      round: 12,
    },
    name: "puts an active player's round points at risk",
  },
  {
    args: [player("stayed"), "playing", 12, 200],
    expected: {
      atTarget: false,
      banked: 40,
      details: ["12 this round"],
      lost: 0,
      projected: 52,
      risk: "locked",
      round: 12,
    },
    name: "locks the round points of a player who stayed",
  },
  {
    args: [player("active", 190), "playing", 12, 200],
    expected: {
      atTarget: true,
      banked: 190,
      details: ["12 this round", "at the target"],
      lost: 0,
      projected: 202,
      risk: "at-risk",
      round: 12,
    },
    name: "notes when the round points would reach the target",
  },
  {
    args: [player("busted"), "playing", 0, 200],
    expected: {
      atTarget: false,
      banked: 40,
      details: [],
      lost: 12,
      projected: 40,
      risk: "none",
      round: 0,
    },
    name: "shows the points a bust cost",
  },
  {
    args: [player("busted"), "roundOver", 0, 200],
    expected: {
      atTarget: false,
      banked: 40,
      details: [],
      lost: 0,
      projected: 40,
      risk: "none",
      round: 0,
    },
    name: "stops showing a bust's lost points once the round is scored",
  },
  {
    args: [player("stayed", 52), "roundOver", 12, 200],
    expected: {
      atTarget: false,
      banked: 52,
      details: [],
      lost: 0,
      projected: 52,
      risk: "none",
      round: 0,
    },
    name: "leaves round points out once they're banked",
  },
  {
    args: [player("stayed", 205), "gameOver", 12, 200],
    expected: {
      atTarget: true,
      banked: 205,
      details: ["at the target"],
      lost: 0,
      projected: 205,
      risk: "none",
      round: 0,
    },
    name: "marks a banked total at the target",
  },
];

describe(scoreMeter, () => {
  it.each(cases)("$name", ({ args, expected }) => {
    expect(scoreMeter(...args)).toStrictEqual(expected);
  });
});
