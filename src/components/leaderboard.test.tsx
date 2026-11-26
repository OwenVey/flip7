import { expectNoDiagnostics } from "@solidjs/diagnostics";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { calculateRoundScore } from "../game/cards";
import type { Card } from "../game/cards";
import type { RoomView } from "../game/protocol";
import { roundPointsFor } from "../lib/deal-playback";
import { captureScenario } from "../test/diagnostics";
import { itemAt } from "../test/item-at";
import { room } from "../test/room-view";
import Leaderboard from "./leaderboard";
import { ROUND_COUNT_MS } from "./table-common";

const Scores = (props: { room: RoomView; playerId: string | null }) => (
  <Leaderboard
    room={props.room}
    playerId={props.playerId}
    roundPoints={roundPointsFor(props.room)}
  />
);

const SCORED_HAND: Card[] = [
  { id: 1, kind: "number", value: 12 },
  { id: 2, kind: "number", value: 11 },
  { id: 3, kind: "double" },
  { id: 4, kind: "modifier", value: 6 },
];

const BUSTED_ROUND = calculateRoundScore([]);

const scoredRoom = (phase: RoomView["phase"], hand = SCORED_HAND) => {
  const { players } = room();
  const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];

  return room({
    phase,
    players: [
      {
        ...ana,
        hand,
        lastRound: calculateRoundScore(hand),
        status: "stayed",
      },
      { ...ben, lastRound: BUSTED_ROUND, status: "busted" },
      { ...ben, id: "c", lastRound: null, name: "Cara", status: "out" },
    ],
  });
};

const shownText = (cell: Element) => {
  const tooltip = cell.querySelector('[role="tooltip"]')?.textContent ?? "";

  return cell.textContent.replace(tooltip, "");
};

const ranks = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.children[0]?.textContent);

describe("<Leaderboard />", () => {
  afterEach(cleanup);

  it("waits for the first points before ranking anyone", () => {
    const { players } = room();
    const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];

    const [view, setView] = createSignal(
      room({
        players: [
          { ...ana, score: 0 },
          { ...ben, score: 0 },
        ],
      })
    );

    render(() => <Scores room={view()} playerId="a" />);

    expect(ranks()).toStrictEqual(["–Not ranked yet", "–Not ranked yet"]);

    setView(
      room({
        players: [
          { ...ana, score: 0 },
          { ...ben, score: 12 },
        ],
      })
    );
    flush();

    expect(ranks()).toStrictEqual(["1", "2"]);
  });

  it("ranks banked scores, shares tied ranks, and updates after scoring", async () => {
    const { players } = room();
    const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];

    const cara = { ...ben, hand: [], id: "c", name: "Cara" };

    const benLive = {
      ...ben,
      hand: [
        ...ben.hand,
        { id: 3, kind: "number" as const, value: 12 },
        { id: 4, kind: "number" as const, value: 11 },
        { id: 5, kind: "number" as const, value: 10 },
      ],
    };

    const [view, setView] = createSignal(
      room({ players: [benLive, ana, cara] })
    );

    render(() => <Scores room={view()} playerId="a" />);

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));

    const rows = () =>
      leaderboard
        .getAllByRole("row")
        .slice(1)
        .map((row) => Array.from(row.children, shownText));

    expect(
      leaderboard.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toStrictEqual(["#", "Player", "Round", "Total"]);
    expect(
      leaderboard.getByRole("columnheader", { name: "Rank" })
    ).toHaveTextContent("#");
    expect(rows()).toStrictEqual([
      ["1", "Ana (You)", "+7", "40"],
      ["2", "Ben", "+36", "12"],
      ["2", "Cara", "+0", "12"],
    ]);

    const { artifact } = await captureScenario(() => {
      setView(
        room({
          phase: "gameOver",
          players: [
            {
              ...ben,
              lastRound: calculateRoundScore(ben.hand),
              score: 202,
              status: "stayed",
            },
            ana,
            cara,
          ],
          winnerIds: ["b"],
        })
      );
      flush();
    }, "leaderboard-game-over");

    expectNoDiagnostics(artifact);
    expect(rows()).toStrictEqual([
      ["1", "Ben", "+3", "202"],
      ["2", "Ana (You)", "+0", "40"],
      ["3", "Cara", "+0", "12"],
    ]);
    expect(leaderboard.getByRole("row", { name: /Ben/u })).toHaveAttribute(
      "data-winner"
    );
  });

  it("distinguishes points in play, banked points, and a bust", () => {
    const { players } = room();
    const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];

    render(() => (
      <Scores
        room={room({
          players: [
            ana,
            { ...ben, status: "stayed" },
            { ...ben, id: "c", name: "Cara", status: "busted" },
          ],
        })}
        playerId="a"
      />
    ));

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));
    const cell = (name: string) => leaderboard.getByRole("cell", { name });

    expect(cell("7 points, in play")).toHaveAttribute(
      "data-round-state",
      "at-risk"
    );
    expect(cell("3 points, banked")).toHaveAttribute(
      "data-round-state",
      "banked"
    );
    expect(cell("0 points, busted")).toHaveTextContent(/^0$/u);
  });

  it("marks your row and second and third place in the scores once the game is over", () => {
    const base = room({ phase: "gameOver", winnerIds: ["a"] });

    const view: RoomView = {
      ...base,
      players: [
        ...base.players,
        {
          avatar: 1,
          bot: false,
          bustCard: null,
          connected: true,
          hand: [],
          id: "c",
          lastRound: null,
          name: "Cara",
          score: 5,
          status: "stayed",
        },
      ],
    };

    render(() => <Scores room={view} playerId="a" />);

    const rows = within(
      screen.getByRole("table", { name: "Scores" })
    ).getAllByRole("row");

    expect(rows.slice(1).map((row) => row.dataset.medal ?? null)).toStrictEqual(
      [null, "2", "3"]
    );
    expect(
      rows.slice(1).map((row) => Object.hasOwn(row.dataset, "me"))
    ).toStrictEqual([true, false, false]);
  });

  it("keeps a winner who has left at rank 1 in the scores at game over", () => {
    const base = room({ phase: "gameOver", winnerIds: ["b"] });

    const view: RoomView = {
      ...base,
      players: base.players.filter(({ id }) => id !== "b"),
      winner: { id: "b", name: "Ben", points: 212 },
    };

    render(() => <Scores room={view} playerId="a" />);

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));

    const rows = leaderboard
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.children, shownText));

    expect(rows).toStrictEqual([
      ["1", "Ben Left", "—", "212"],
      ["2", "Ana (You)", "+0", "40"],
    ]);
    expect(leaderboard.getByRole("row", { name: /Ben/u })).toHaveAttribute(
      "data-winner"
    );
    expect(leaderboard.getByRole("row", { name: /Ana/u })).toHaveAttribute(
      "data-medal",
      "2"
    );
  });

  it("shows how each scored round adds up, except a bust or a round sat out", () => {
    render(() => <Scores room={scoredRoom("roundOver")} playerId="a" />);

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));

    const breakdown = leaderboard.getByRole("button", {
      name: "52 points, banked",
    });

    expect(breakdown).toHaveTextContent(/^\+52$/u);
    expect(breakdown).toHaveAccessibleDescription(
      "Number cards 23, ×2 46, Score Modifiers +6, Total 52"
    );
    expect(leaderboard.getAllByRole("button")).toHaveLength(1);
    expect(
      leaderboard.getByRole("cell", { name: "0 points, busted" })
    ).toBeInTheDocument();
    expect(
      leaderboard.getByRole("cell", { name: "0 points, sitting out" })
    ).toBeInTheDocument();
  });

  it("keeps the breakdown, with a chip for each scored card, at game over", () => {
    render(() => <Scores room={scoredRoom("gameOver")} playerId="a" />);

    expect(
      screen.getByRole("button", { name: "52 points, banked" })
    ).toBeInTheDocument();
    expect(
      Array.from(
        document.querySelectorAll(".score-chip"),
        (chip) => chip.textContent
      )
    ).toStrictEqual(["12", "11", "×2", "+6"]);
  });

  it("opens the score breakdown when the button is pressed", async () => {
    render(() => <Scores room={scoredRoom("roundOver")} playerId="a" />);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "52 points, banked" }));

    await expect(screen.findByRole("tooltip")).resolves.toHaveTextContent(
      /Total\s*52/u
    );
  });

  it("has no breakdown while the round is in play", () => {
    const { players } = room();
    const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];

    render(() => (
      <Scores
        room={room({ players: [ana, { ...ben, status: "stayed" }] })}
        playerId="a"
      />
    ));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the breakdown for a 0-point banked hand", () => {
    const { players } = room();
    const [ana, ben] = [itemAt(players, 0), itemAt(players, 1)];
    const zeroHand: Card[] = [{ id: 1, kind: "number", value: 0 }];

    render(() => (
      <Scores
        room={room({
          phase: "roundOver",
          players: [
            {
              ...ana,
              hand: zeroHand,
              lastRound: calculateRoundScore(zeroHand),
              status: "frozen",
            },
            { ...ben, lastRound: BUSTED_ROUND, status: "busted" },
          ],
        })}
        playerId="a"
      />
    ));

    const breakdown = screen.getByRole("button", { name: "0 points, banked" });

    expect(breakdown).toHaveTextContent(/^\+0$/u);
    expect(breakdown).toHaveAccessibleDescription("Number cards 0, Total 0");
  });

  it("waits for the round points to count up before offering the breakdown", () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    try {
      const opening = room();

      const [view, setView] = createSignal(
        room({
          players: opening.players.map((player) => ({ ...player, hand: [] })),
        })
      );

      render(() => <Scores room={view()} playerId="a" />);

      setView(scoredRoom("roundOver", [{ id: 1, kind: "number", value: 1 }]));
      flush();

      expect(screen.queryByRole("button")).not.toBeInTheDocument();

      vi.advanceTimersByTime(ROUND_COUNT_MS / 2);
      flush();

      expect(
        screen.getByRole("cell", { name: "1 point, banked" })
      ).toHaveTextContent(/^\+1$/u);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();

      vi.advanceTimersByTime(ROUND_COUNT_MS / 2);
      flush();

      expect(
        screen.getByRole("button", { name: "1 point, banked" })
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
