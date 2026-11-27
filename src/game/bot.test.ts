import { describe, expect, it } from "vitest";

import { bustChance, decideBotMove } from "./bot";
import type { BotView } from "./bot";
import { buildDeck } from "./cards";
import type { ActionCard, Card } from "./cards";
import type { Player } from "./engine";

let nextCardId = 7000;

const cardId = () => {
  nextCardId += 1;

  return nextCardId;
};

const num = (value: number) =>
  ({ id: cardId(), kind: "number", value }) satisfies Card;

const action = (kind: ActionCard["kind"]) =>
  ({ id: cardId(), kind }) satisfies Card;

const seat = (
  id: string,
  hand: Card[],
  score = 0,
  status: Player["status"] = "active"
) => ({ bustCard: null, hand, id, score, status });

const table = (
  players: ReturnType<typeof seat>[],
  choice: BotView["choice"] = null
) => ({ choice, players, targetScore: 200 }) satisfies BotView;

const botChasingLeaderOn180 = (score: number) => [
  seat("bot", [num(12), num(11), num(10)], score),
  seat("ana", [num(1)], 180),
];

describe(bustChance, () => {
  it("counts only the copies of held numbers that aren't face up", () => {
    const view = table([seat("bot", [num(1)]), seat("ana", [])]);

    expect(bustChance(view, [num(1)])).toBe(0);
  });

  it("counts each held Number value once and ignores Score Modifiers", () => {
    const hand = [
      num(0),
      num(4),
      num(4),
      { id: cardId(), kind: "modifier", value: 10 },
    ] satisfies Card[];

    const view = table([seat("bot", hand)]);

    expect(bustChance(view, hand)).toBeCloseTo(
      2 / (buildDeck().length - hand.length)
    );
  });

  it("is higher with more high numbers in hand", () => {
    const low = table([seat("bot", [num(2)])]);
    const high = table([seat("bot", [num(12), num(11), num(10)])]);

    expect(bustChance(high, high.players[0]?.hand ?? [])).toBeGreaterThan(
      bustChance(low, low.players[0]?.hand ?? [])
    );
  });
});

describe(decideBotMove, () => {
  it("hits when it has no cards to stay on", () => {
    const view = table([seat("bot", []), seat("ana", [num(4)])]);

    expect(decideBotMove(view, "bot")).toStrictEqual({ type: "hit" });
  });

  it("hits on a low-risk hand", () => {
    const view = table([seat("bot", [num(3)]), seat("ana", [num(4)])]);

    expect(decideBotMove(view, "bot")).toStrictEqual({ type: "hit" });
  });

  it("stays on a risky hand", () => {
    const view = table([
      seat("bot", [num(12), num(11), num(10), num(9)]),
      seat("ana", [num(4)]),
    ]);

    expect(decideBotMove(view, "bot")).toStrictEqual({ type: "stay" });
  });

  it("stays when staying wins the game", () => {
    const view = table([seat("bot", [num(2)], 199), seat("ana", [num(4)], 50)]);

    expect(decideBotMove(view, "bot")).toStrictEqual({ type: "stay" });
  });

  it("keeps hitting with a Second Chance to fall back on", () => {
    const view = table([
      seat("bot", [num(12), num(11), num(10), num(9), action("secondChance")]),
      seat("ana", [num(4)]),
    ]);

    expect(decideBotMove(view, "bot")).toStrictEqual({ type: "hit" });
  });

  it("takes more risk when far behind late in the game", () => {
    expect(
      decideBotMove(table(botChasingLeaderOn180(140)), "bot")
    ).toStrictEqual({
      type: "stay",
    });
    expect(
      decideBotMove(table(botChasingLeaderOn180(40)), "bot")
    ).toStrictEqual({
      type: "hit",
    });
  });

  it("freezes the leader rather than itself", () => {
    const view = table(
      [
        seat("bot", [num(3)], 100),
        seat("ana", [num(4)], 20),
        seat("ben", [num(5)], 90),
      ],
      {
        card: action("freeze"),
        chooserId: "bot",
        options: ["bot", "ana", "ben"],
      }
    );

    expect(decideBotMove(view, "bot")).toStrictEqual({
      targetId: "ben",
      type: "choose",
    });
  });

  it("gives Flip Three to whoever is most likely to bust", () => {
    const view = table(
      [
        seat("bot", [num(3)]),
        seat("ana", [num(2)], 150),
        seat("ben", [num(12), num(11), num(10)]),
      ],
      {
        card: action("flipThree"),
        chooserId: "bot",
        options: ["bot", "ana", "ben"],
      }
    );

    expect(decideBotMove(view, "bot")).toStrictEqual({
      targetId: "ben",
      type: "choose",
    });
  });

  it("gives a spare Second Chance to the player furthest behind", () => {
    const view = table(
      [
        seat("bot", [action("secondChance")]),
        seat("ana", [num(2)], 150),
        seat("ben", [num(4)], 30),
      ],
      {
        card: action("secondChance"),
        chooserId: "bot",
        options: ["ana", "ben"],
      }
    );

    expect(decideBotMove(view, "bot")).toStrictEqual({
      targetId: "ben",
      type: "choose",
    });
  });

  it("plays on itself when it's the only option", () => {
    const view = table([seat("bot", [num(3)]), seat("ana", [], 0, "stayed")], {
      card: action("freeze"),
      chooserId: "bot",
      options: ["bot"],
    });

    expect(decideBotMove(view, "bot")).toStrictEqual({
      targetId: "bot",
      type: "choose",
    });
  });
});
