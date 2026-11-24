import { describe, expect, it } from "vitest";

import type { ActionCard, Card, RoundScore } from "../game/cards";
import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { room } from "../test/room-view";
import type { DealStep } from "./deal-plan";
import { samePrompt, tablePrompt } from "./table-prompt";
import type { PromptPlayback } from "./table-prompt";

const FREEZE: ActionCard = { id: 20, kind: "freeze" };
const FIVE: Card = { id: 9, kind: "number", value: 5 };

const playback = (overrides: Partial<PromptPlayback> = {}) =>
  ({
    dealing: false,
    roundPoints: new Map(),
    step: null,
    ...overrides,
  }) satisfies PromptPlayback;

const dealing = (step: DealStep | null) => playback({ dealing: true, step });

const step = (overrides: Partial<DealStep> = {}) =>
  ({
    card: FIVE,
    flip: null,
    from: "deck",
    partnerId: null,
    to: { kind: "hand", playerId: "b" },
    ...overrides,
  }) satisfies DealStep;

const scored = (total: number, flipSeven = false) =>
  ({
    doubled: false,
    flipSeven,
    modifiers: 0,
    numbers: total,
    total,
  }) satisfies RoundScore;

const withPlayers = (
  view: RoomView,
  changes: Record<string, Partial<Player>>
) =>
  ({
    ...view,
    players: view.players.map((player) => ({
      ...player,
      ...changes[player.id],
    })),
  }) satisfies RoomView;

const offline = (view: RoomView, id: string) =>
  withPlayers(view, { [id]: { connected: false } });

const noPersonCanMove = (view: RoomView) =>
  withPlayers(view, { a: { connected: false }, b: { bot: true } });

const choosing = (chooserId: string) =>
  room({ choice: { card: FREEZE, chooserId, options: ["a", "b"] } });

describe(tablePrompt, () => {
  it.each([
    {
      expected: {
        controls: { canStay: true, kind: "turn", roundPoints: 7 },
        headline: "Your turn",
        note: "7 points this round",
        yours: true,
      },
      name: "asks you to hit or stay on your turn",
      play: playback({ roundPoints: new Map([["a", 7]]) }),
      view: room(),
      viewer: "a",
    },
    {
      expected: {
        controls: { canStay: false, kind: "turn", roundPoints: 0 },
        headline: "Your turn",
        note: "Hit for a card before you can stay",
        yours: true,
      },
      name: "asks you to hit when you have no cards yet",
      play: playback(),
      view: withPlayers(room(), { a: { hand: [] } }),
      viewer: "a",
    },
    {
      expected: {
        controls: { kind: "none" },
        headline: "Ana is deciding…",
        yours: false,
      },
      name: "shows other players whose turn it is",
      play: playback(),
      view: room(),
      viewer: "b",
    },
    {
      expected: {
        controls: { kind: "none" },
        headline: "Ana is deciding…",
        yours: false,
      },
      name: "shows a Spectator whose turn it is",
      play: playback(),
      view: room(),
      viewer: null,
    },
    {
      expected: {
        controls: {
          canStay: true,
          forId: "b",
          forName: "Ben",
          kind: "turn",
          roundPoints: 3,
        },
        headline: "Ben is offline",
        note: "Play for them, or the game will Stay soon",
        yours: false,
      },
      name: "lets the host move for an offline player",
      play: playback({ roundPoints: new Map([["b", 3]]) }),
      view: offline(room({ turnId: "b" }), "b"),
      viewer: "a",
    },
    {
      expected: {
        controls: { kind: "none" },
        headline: "Ana is offline.",
        note: "The game will Stay for them soon.",
        yours: false,
      },
      name: "tells a guest the game will move for an offline player",
      play: playback(),
      view: offline(room(), "a"),
      viewer: "b",
    },
    {
      expected: {
        controls: { kind: "none" },
        headline: "Waiting on Ana",
        note: "Play resumes when a player reconnects.",
        yours: false,
      },
      name: "waits for a person to reconnect when nobody can move",
      play: playback(),
      view: noPersonCanMove(room()),
      viewer: null,
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Who gets your Freeze?",
        note: "Tap a player",
        yours: true,
      },
      name: "asks the chooser who gets their action card",
      play: playback(),
      view: choosing("a"),
      viewer: "a",
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Ana is choosing who receives Freeze.",
        yours: false,
      },
      name: "shows others who is choosing",
      play: playback(),
      view: choosing("a"),
      viewer: "b",
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Ben is offline.",
        note: "Pick who gets their Freeze, or the game will play it for them soon.",
        yours: false,
      },
      name: "lets the host choose for an offline chooser",
      play: playback(),
      view: offline(choosing("b"), "b"),
      viewer: "a",
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Ana is offline.",
        note: "The game will play Freeze for them soon.",
        yours: false,
      },
      name: "tells a guest the game will play an offline chooser's card",
      play: playback(),
      view: offline(choosing("a"), "a"),
      viewer: "b",
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Ana is offline.",
        note: "Play resumes when a player reconnects.",
        yours: false,
      },
      name: "waits for a person to reconnect during a choice nobody can make",
      play: playback(),
      view: noPersonCanMove(choosing("a")),
      viewer: null,
    },
    {
      expected: {
        controls: { kind: "none" },
        headline: "Dealing to Ben…",
        yours: false,
      },
      name: "narrates the deal instead of asking for your move",
      play: dealing(step()),
      view: room(),
      viewer: "a",
    },
    {
      expected: {
        card: FREEZE,
        controls: { kind: "none" },
        headline: "Dealing to Ben…",
        yours: false,
      },
      name: "narrates the deal over a choice, keeping the card in view",
      play: dealing(step()),
      view: choosing("a"),
      viewer: "a",
    },
    {
      expected: {
        controls: { kind: "nextRound" },
        headline: "End of round 1",
        yours: false,
      },
      name: "lets the host start the next round",
      play: playback(),
      view: room({ phase: "roundOver", turnId: null }),
      viewer: "a",
    },
    {
      expected: {
        controls: {
          kind: "waitForHost",
          text: "Waiting for Ana to start the next round.",
        },
        headline: "End of round 1",
        yours: false,
      },
      name: "tells guests the host starts the next round",
      play: playback(),
      view: room({ phase: "roundOver", turnId: null }),
      viewer: "b",
    },
    {
      expected: {
        controls: { canStart: true, kind: "gameOver" },
        headline: "Ben wins!",
        winner: true,
        yours: false,
      },
      name: "lets the host play again or return to the lobby",
      play: playback(),
      view: room({ phase: "gameOver", turnId: null, winnerIds: ["b"] }),
      viewer: "a",
    },
    {
      expected: {
        controls: {
          kind: "waitForHost",
          text: "Waiting for Ana to play again or head back to the lobby.",
        },
        headline: "Ana and Ben wins!",
        winner: true,
        yours: false,
      },
      name: "tells guests the host decides what happens after the game",
      play: playback(),
      view: room({ phase: "gameOver", turnId: null, winnerIds: ["a", "b"] }),
      viewer: "b",
    },
    {
      expected: {
        controls: { canStart: true, kind: "gameOver" },
        headline: "Ben wins!",
        winner: true,
        yours: false,
      },
      name: "announces the winner even while the last cards play back",
      play: dealing(step()),
      view: room({ phase: "gameOver", turnId: null, winnerIds: ["b"] }),
      viewer: "a",
    },
    {
      expected: { controls: { kind: "none" }, yours: false },
      name: "says nothing between turns",
      play: playback(),
      view: room({ turnId: null }),
      viewer: "a",
    },
  ])("$name", ({ expected, play, view, viewer }) => {
    expect(tablePrompt(view, viewer, play)).toStrictEqual(expected);
  });

  it.each([
    { expected: "Dealing…", step: null },
    { expected: "Dealing to Ben…", step: step() },
    {
      expected: "Dealing to you…",
      step: step({ to: { kind: "hand", playerId: "a" } }),
    },
    { expected: "Ben hits…", step: step({ hit: true }) },
    {
      expected: "You hit…",
      step: step({ hit: true, to: { kind: "hand", playerId: "a" } }),
    },
    {
      expected: "Flip Three on Ben!",
      step: step({
        card: { id: 21, kind: "flipThree" },
        to: { kind: "played", playerId: "b" },
      }),
    },
    {
      expected: "Flip Three on you!",
      step: step({
        card: { id: 21, kind: "flipThree" },
        to: { kind: "played", playerId: "a" },
      }),
    },
    {
      expected: "Flip Three · Ben flips 2 of 3",
      step: step({ flip: { index: 2, total: 3 } }),
    },
    {
      expected: "Flip Three · you flip 2 of 3",
      step: step({
        flip: { index: 2, total: 3 },
        to: { kind: "hand", playerId: "a" },
      }),
    },
    {
      expected: "Second Chance saves Ben!",
      step: step({ partnerId: 30, to: { kind: "discard", playerId: "b" } }),
    },
    {
      expected: "Freeze is discarded",
      step: step({ card: FREEZE, to: { kind: "discard", playerId: "b" } }),
    },
    {
      expected: "Freeze comes into play…",
      step: step({ card: FREEZE, from: "held" }),
    },
    {
      expected: "Freeze goes to Ben…",
      step: step({ card: FREEZE, from: "choice" }),
    },
    {
      expected: "Freeze goes to you…",
      step: step({
        card: FREEZE,
        from: "choice",
        to: { kind: "hand", playerId: "a" },
      }),
    },
  ])("narrates the deal: $expected", ({ expected, step: dealt }) => {
    expect(tablePrompt(room(), "a", dealing(dealt)).headline).toBe(expected);
  });

  it("names the chooser when a card is dealt to the action card prompt", () => {
    const prompt = tablePrompt(
      choosing("b"),
      "a",
      dealing(step({ card: FREEZE, to: { kind: "choice" } }))
    );

    expect(prompt.headline).toBe("Dealing to Ben…");
  });

  const roundEnds: {
    expected: string;
    name: string;
    players: Record<string, Partial<Player>>;
  }[] = [
    {
      expected: "Ben Flipped 7! +25",
      name: "celebrates a Flip 7",
      players: { b: { lastRound: scored(25, true), status: "flipSeven" } },
    },
    {
      expected: "Ben takes the lead",
      name: "names a player who took the lead",
      players: {
        a: { lastRound: scored(0) },
        b: { lastRound: scored(45), score: 50 },
      },
    },
    {
      expected: "End of round 1",
      name: "falls back to the round number",
      players: { a: { lastRound: scored(10) }, b: { lastRound: scored(5) } },
    },
  ];

  it.each(roundEnds)("$name at the end of a round", ({ expected, players }) => {
    const view = withPlayers(
      room({ phase: "roundOver", turnId: null }),
      players
    );

    expect(tablePrompt(view, "b", playback()).headline).toBe(expected);
  });
});

describe(samePrompt, () => {
  it("matches prompts that render the same and tells changed ones apart", () => {
    const points = (value: number) =>
      tablePrompt(
        room(),
        "a",
        playback({ roundPoints: new Map([["a", value]]) })
      );

    expect(samePrompt(points(7), points(7))).toBeTruthy();
    expect(samePrompt(points(7), points(8))).toBeFalsy();
    const theirs = tablePrompt(room(), "b", playback());

    expect(samePrompt(points(7), theirs)).toBeFalsy();
  });
});
