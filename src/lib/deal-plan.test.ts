import { describe, expect, it } from "vitest";

import type { Card } from "../game/cards";
import {
  addPlayer,
  choose,
  createGame,
  hit,
  nextRound,
  startGame,
} from "../game/engine";
import type { GameState } from "../game/engine";
import { toRoomView } from "../game/protocol";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";

const random = () => 0.5;

let nextId = 2000;

const id = () => {
  nextId += 1;

  return nextId;
};

const num = (value: number) =>
  ({ id: id(), kind: "number", value }) satisfies Card;

const freeze = () => ({ id: id(), kind: "freeze" }) satisfies Card;
const flipThree = () => ({ id: id(), kind: "flipThree" }) satisfies Card;
const secondChance = () => ({ id: id(), kind: "secondChance" }) satisfies Card;

const view = (state: GameState) => toRoomView("ABCDE", state);

const rig = (state: GameState, draws: Card[]) => {
  state.deck = [...draws].toReversed();
};

const finishedRound = (names: string[]) => {
  const state = createGame();

  for (const name of names) {
    addPlayer(state, name, name, 1);
  }

  startGame(state, "a", random);
  state.phase = "roundOver";
  state.round = 0;
  state.dealerIndex = names.length - 2;
  state.discard = [];

  return state;
};

const setup = (names: string[], draws: Card[]) => {
  const state = finishedRound(names);
  rig(state, draws);
  nextRound(state, "a", random);

  return state;
};

const seat = (state: GameState, playerId: string) => {
  const found = state.players.find((player) => player.id === playerId);

  if (!found) {
    throw new Error(`No player ${playerId}`);
  }

  return found;
};

const summary = (steps: DealStep[]) =>
  steps.map((step) => ({
    card: step.card.kind === "number" ? step.card.value : step.card.kind,
    flip: step.flip?.index ?? null,
    from: step.from,
    to:
      step.to.kind === "choice"
        ? "choice"
        : `${step.to.kind} ${step.to.playerId}`,
  }));

describe(planDeal, () => {
  it("deals a new round starting left of the dealer", () => {
    const state = finishedRound(["a", "b", "c"]);
    const before = view(state);
    rig(state, [num(1), num(2), num(3)]);
    nextRound(state, "a", random);

    expect(state.players[state.dealerIndex]?.id).toBe("c");
    expect(summary(planDeal(before, view(state)))).toStrictEqual([
      { card: 1, flip: null, from: "deck", to: "hand a" },
      { card: 2, flip: null, from: "deck", to: "hand b" },
      { card: 3, flip: null, from: "deck", to: "hand c" },
    ]);
  });

  it("marks a card drawn by Hit even when it opens a target choice", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    const before = view(state);
    const card = freeze();
    rig(state, [card]);
    hit(state, "a", random);

    expect(planDeal(before, view(state))).toMatchObject([
      { card, from: "deck", hit: true, to: { kind: "choice" } },
    ]);
  });

  it("plays out a Flip Three flip by flip, holding the Freeze it turns up", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), num(1), freeze(), num(2)]);
    hit(state, "a", random);
    const before = view(state);
    choose(state, "a", "b", random);

    expect(summary(planDeal(before, view(state)))).toStrictEqual([
      { card: "flipThree", flip: null, from: "choice", to: "played b" },
      { card: 1, flip: 1, from: "deck", to: "hand b" },
      { card: "freeze", flip: 2, from: "deck", to: "held b" },
      { card: 2, flip: 3, from: "deck", to: "hand b" },
      { card: "freeze", flip: null, from: "held", to: "choice" },
    ]);
  });

  it("plays an assigned Flip Three from the prompt into a fresh run", () => {
    const state = setup(["a", "b", "c"], [num(5), num(3), num(8)]);
    rig(state, [
      flipThree(),
      num(1),
      flipThree(),
      num(2),
      num(4),
      num(6),
      num(10),
    ]);
    hit(state, "a", random);
    choose(state, "a", "b", random);
    const before = view(state);
    choose(state, "b", "c", random);

    expect(summary(planDeal(before, view(state)))).toStrictEqual([
      { card: "flipThree", flip: null, from: "choice", to: "played c" },
      { card: 4, flip: 1, from: "deck", to: "hand c" },
      { card: 6, flip: 2, from: "deck", to: "hand c" },
      { card: 10, flip: 3, from: "deck", to: "hand c" },
    ]);
  });

  it("discards held cards when a Flip Three ends in a bust", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), freeze(), num(3), num(9)]);
    hit(state, "a", random);
    const before = view(state);
    choose(state, "a", "b", random);

    expect(summary(planDeal(before, view(state)))).toStrictEqual([
      { card: "flipThree", flip: null, from: "choice", to: "played b" },
      { card: "freeze", flip: 1, from: "deck", to: "held b" },
      { card: 3, flip: 2, from: "deck", to: "bust b" },
      { card: "freeze", flip: null, from: "held", to: "discard b" },
    ]);
  });

  it("discards a duplicate together with the Second Chance it used", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    const chance = secondChance();
    seat(state, "a").hand.push(chance);
    const before = view(state);
    rig(state, [num(5)]);
    hit(state, "a", random);
    const steps = planDeal(before, view(state));

    expect(steps).toMatchObject([
      { partnerId: chance.id, to: { kind: "discard", playerId: "a" } },
    ]);
    expect(
      dealFrame(before, view(state), steps, 1).players[0]?.hand
    ).toHaveLength(3);
  });

  it("shows the result at once for rooms saved without a draw record", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    const before = view(state);
    rig(state, [num(7)]);
    hit(state, "a", random);

    expect(planDeal(before, { ...view(state), draws: [] })).toStrictEqual([]);
  });
});

describe(dealFrame, () => {
  it("holds a bust and the log back until the busting card lands", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    rig(state, [flipThree(), freeze(), num(3), num(9)]);
    hit(state, "a", random);
    const before = view(state);
    choose(state, "a", "b", random);
    const after = view(state);
    const steps = planDeal(before, after);
    const busting = dealFrame(before, after, steps, 3);

    expect(seat(state, "b").status).toBe("busted");
    expect(busting.players[1]).toMatchObject({
      bustCard: { kind: "number", value: 3 },
      status: "active",
    });
    expect(busting.held).toMatchObject([{ card: { kind: "freeze" } }]);
    expect(busting.log).toStrictEqual(before.log);
  });

  it("clears the last round's hands when a new round is dealt", () => {
    const state = setup(["a", "b"], [num(5), num(3)]);
    state.phase = "roundOver";
    const before = view(state);
    rig(state, [num(1), num(2)]);
    nextRound(state, "a", random);
    const frame = dealFrame(before, view(state), [], 0);

    expect(frame.phase).toBe("playing");
    expect(frame.players.map((player) => player.hand)).toStrictEqual([[], []]);
    expect(frame.turnId).toBeNull();
  });
});
