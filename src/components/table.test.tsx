import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { calculateRoundScore } from "../game/cards";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import Table from "./table";

let approve = false;

const agent = createAgent({
  allow: (step) => (step.confirm ?? "") === "" || approve,
});

const room = (overrides: Partial<RoomView> = {}) => {
  const view: RoomView = {
    botSpeed: "normal",
    choice: null,
    code: "ABCDE",
    dealerId: "b",
    deckCount: 80,
    discardCount: 0,
    draws: [],
    flips: [],
    held: [],
    hostId: "a",
    locked: false,
    log: [{ id: 1, text: "Round 1 begins. Ben deals." }],
    phase: "playing",
    players: [
      {
        avatar: 1,
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
    targetScore: 200,
    turnId: "a",
    winnerIds: [],
    ...overrides,
  };

  return view;
};

const meterOf = (name: string) =>
  within(screen.getByRole("article", { name })).getByRole("meter", {
    name: "Total score",
  });

const entries = () =>
  agent
    .snapshot()
    .filter((entry) => entry.offPage !== true && entry.component !== "more");

describe("<Table />", () => {
  afterEach(cleanup);

  it("labels bot seats beside the player name", () => {
    const view = room();
    const [ana, ben] = view.players;
    view.players = [ana, { ...ben, avatar: null, bot: true, name: "Torch" }];

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const botSeat = screen.getByRole("article", { name: "Torch, 12 points" });
    const humanSeat = screen.getByRole("article", { name: "Ana, 40 points" });
    expect(within(botSeat).getByText("Bot")).toBeVisible();
    expect(within(humanSeat).queryByText("Bot")).toBeNull();
    expect(within(humanSeat).getByText("You")).toBeVisible();
  });

  it("distinguishes an opening card from an ordinary hit", () => {
    const [hit, setHit] = createSignal<true | undefined>(undefined);

    render(() => (
      <Table
        room={room({ turnId: "b" })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
        dealing
        dealStep={{
          card: { id: 2, kind: "number", value: 3 },
          flip: null,
          from: "deck",
          hit: hit(),
          partnerId: null,
          to: { kind: "hand", playerId: "b" },
        }}
      />
    ));

    expect(screen.getByText("Dealing to Ben…")).toBeVisible();
    setHit(true);
    flush();
    expect(screen.getByText("Ben hits…")).toBeVisible();
  });

  it("sets held action cards beside the deck, not in the seat", () => {
    render(() => (
      <Table
        room={room({
          flips: [{ remaining: 1, targetId: "b" }],
          held: [{ card: { id: 9, kind: "freeze" }, ownerId: "b" }],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const pile = screen.getByRole("list", {
      name: "Held for Ben until the Flip Three ends",
    });

    expect(pile.closest("[data-action-bar]")).not.toBeNull();
    expect(within(pile).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(screen.getByRole("article", { name: /^Ben,/u })).queryByText(
        /held/iu
      )
    ).toBeNull();
  });

  it("lets the host lock the room mid-game from the header, without the winning score", async () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Room settings" }));

    const popover = await screen.findByRole("dialog", {
      name: "Room settings",
    });

    expect(
      within(popover).queryByRole("radiogroup", { name: "Winning score" })
    ).toBeNull();

    fireEvent.click(
      within(popover).getByRole("switch", { name: /Lock room/u })
    );
    expect(send).toHaveBeenCalledExactlyOnceWith({
      locked: true,
      type: "configure",
    });
  });

  it("offers invite, settings, and leave from the phone menu", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toStrictEqual(["Copy invite link", "Room settings", "Leave room"]);

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Room settings" })
    );

    const settings = await screen.findByRole("dialog", {
      name: "Room settings",
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(settings).toBeVisible();
    expect(settings.contains(document.activeElement)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Leave room",
      })
    );

    await expect(
      screen.findByRole("alertdialog", { name: "Leave this room?" })
    ).resolves.toBeVisible();
  });

  it("leaves room settings out of a guest's phone menu and blocks leaving during the deal", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
        actionsDisabled
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Room settings" })
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", { name: "Leave after the deal" })
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps room settings away from guests", () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    expect(screen.queryByRole("button", { name: "Room settings" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy invite link" })
    ).toHaveTextContent("Invite");
  });

  it("opens the Scores sheet during play and returns focus on close", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const scores = screen.getByRole("button", { name: "Scores" });
    scores.focus();

    const result = await agent.act({
      steps: [{ action: "press", ref: "Scores" }],
    });

    expect(result.error).toBeUndefined();
    const sheet = await screen.findByRole("dialog", { name: "Scores" });
    const standings = within(sheet).getByRole("table", { name: "Scores" });
    expect(
      within(standings).getByRole("cell", { name: "7 points, in play" })
    ).toHaveTextContent("+7");

    within(sheet).getByRole("button", { name: "Close" }).click();
    flush();
    expect(screen.queryByRole("dialog", { name: "Scores" })).toBeNull();
    expect(scores).toHaveFocus();
  });

  it("opens the Scores sheet once per round end and lists busted players", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("width < 64rem"),
    }));

    try {
      const initial = room();
      const [ana, ben] = initial.players;
      const [view, setView] = createSignal(initial);
      render(() => (
        <Table
          room={view()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={vi.fn<RoomConnection["chat"]>()}
        />
      ));

      const result = room({
        phase: "roundOver",
        players: [
          {
            ...ana,
            lastRound: calculateRoundScore(ana.hand),
            score: 47,
            status: "stayed",
          },
          { ...ben, status: "busted" },
        ],
      });

      setView(result);
      flush();

      const scores = within(
        await screen.findByRole("dialog", { name: "Scores" })
      );

      expect(scores.getByRole("cell", { name: "47" })).toBeVisible();
      expect(scores.getByRole("rowheader", { name: "Ben" })).toBeVisible();
      scores.getByRole("button", { name: "Close" }).click();
      setView({ ...result, deckCount: 79 });
      flush();
      expect(screen.queryByRole("dialog", { name: "Scores" })).toBeNull();
      expect(screen.getByRole("button", { name: "Scores" })).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for the host to start the next round", () => {
    vi.useFakeTimers();

    try {
      const send = vi.fn<RoomConnection["send"]>();
      render(() => (
        <Table
          room={room({ phase: "roundOver" })}
          playerId="a"
          send={send}
          chat={vi.fn<RoomConnection["chat"]>()}
        />
      ));
      vi.advanceTimersByTime(60_000);
      expect(send).not.toHaveBeenCalled();

      screen.getByRole("button", { name: "Start next round" }).click();
      expect(send).toHaveBeenCalledExactlyOnceWith({ type: "nextRound" });
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("shows the banked and round scores in the same label row", () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const seat = screen.getByRole("article", { name: "Ana, 40 points" });
    expect(within(seat).getByText("Your turn")).toBeVisible();

    const meter = within(seat).getByRole("meter", { name: "Total score" });
    expect(within(meter).getByText("40 / 200")).toBeVisible();
    expect(
      Array.from(
        meter.querySelectorAll(".seat-score"),
        (label) => label.textContent
      )
    ).toStrictEqual(["40 / 200", "+7"]);
    expect(meter).toHaveAttribute("aria-valuenow", "40");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      "40 of 200 points, 7 this round"
    );
  });

  it("keeps only Number cards on the mat and sets the rest beside it in arrival order", () => {
    const view = room();
    const [ana, ben] = view.players;
    view.players = [
      {
        ...ana,
        hand: [
          { id: 1, kind: "number", value: 7 },
          { id: 90, kind: "bonus", value: 4 },
          { id: 91, kind: "secondChance" },
          { id: 3, kind: "number", value: 2 },
        ],
      },
      ben,
    ];

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const mat = screen.getByRole("list", { name: "Ana's cards" });

    const extras = screen.getByRole("list", {
      name: "Ana's modifier and Second Chance cards",
    });

    expect(
      within(mat)
        .getAllByRole("listitem")
        .map((card) => card.dataset.cardId)
    ).toStrictEqual(["1", "3"]);
    expect(
      within(extras)
        .getAllByRole("listitem")
        .map((card) => card.dataset.cardId)
    ).toStrictEqual(["90", "91"]);
  });

  it("updates the score preview on a bust and when the round is scored", () => {
    const initial = room();
    const [view, setView] = createSignal(initial);

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const seat = screen.getByRole("article", { name: "Ana, 40 points" });
    const meter = within(seat).getByRole("meter", { name: "Total score" });

    const projectedScore = () =>
      meter.style.getPropertyValue("--projected-score");

    expect(meter.style.getPropertyValue("--meter-value")).toBe("20%");

    setView(
      room({
        players: initial.players.map((player) =>
          player.id === "a" ? { ...player, status: "busted" } : player
        ),
      })
    );
    flush();

    expect(projectedScore()).toBe("20%");
    expect(within(meter).queryByText("+7")).toBeNull();

    setView(initial);
    flush();

    setView(
      room({
        phase: "roundOver",
        players: initial.players.map((player) =>
          player.id === "a"
            ? {
                ...player,
                lastRound: {
                  bonus: 0,
                  doubled: false,
                  numbers: 7,
                  streak: false,
                  total: 7,
                },
                score: 47,
                status: "stayed",
              }
            : player
        ),
      })
    );
    flush();

    expect(projectedScore()).toBe("23.5%");
    expect(meter).toHaveAttribute("aria-valuetext", "47 of 200 points");
  });

  it("rolls scored points into the seat total", () => {
    const initial = room();

    render(() => (
      <Table
        room={room({
          phase: "roundOver",
          players: initial.players.map((player) =>
            player.id === "a"
              ? {
                  ...player,
                  lastRound: {
                    bonus: 0,
                    doubled: false,
                    numbers: 7,
                    streak: false,
                    total: 7,
                  },
                  score: 47,
                  status: "stayed",
                }
              : player
          ),
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const seat = screen.getByRole("article", { name: "Ana, 47 points" });
    const meter = within(seat).getByRole("meter", { name: "Total score" });

    expect(meter.style.getPropertyValue("--round-start")).toBe("23.5%");
    expect(meter.style.getPropertyValue("--projected-score")).toBe("23.5%");
    expect(within(meter).getByText("47 / 200")).toBeVisible();
    expect(within(meter).queryByText("+7")).toBeNull();
    expect(within(seat).queryByText(/points this round/u)).toBeNull();
  });

  it("stamps the points a stayed hand banked after the round is scored", () => {
    const initial = room();

    render(() => (
      <Table
        room={room({
          phase: "roundOver",
          players: initial.players.map((player) =>
            player.id === "a"
              ? {
                  ...player,
                  lastRound: calculateRoundScore(player.hand),
                  score: 47,
                  status: "stayed",
                }
              : player
          ),
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const seat = screen.getByRole("article", { name: "Ana, 47 points" });

    expect(seat.querySelector(".hand-stamp")).toHaveTextContent("Stayed+7");
  });

  it("marks round points at risk and a score that would win", () => {
    const initial = room();
    const [view, setView] = createSignal(initial);

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    expect(meterOf("Ana, 40 points")).toHaveAttribute("data-round", "at-risk");
    expect(meterOf("Ben, 12 points")).toHaveAttribute(
      "aria-valuetext",
      "12 of 200 points, 3 this round"
    );

    setView(
      room({
        players: initial.players.map((player) =>
          player.id === "a"
            ? { ...player, score: 195, status: "stayed" }
            : player
        ),
      })
    );
    flush();

    const ana = meterOf("Ana, 195 points");

    expect(ana).toHaveAttribute("data-round", "locked");
    expect(ana).toHaveAttribute("data-winning");
    expect(ana).toHaveAttribute(
      "aria-valuetext",
      "195 of 200 points, 7 this round, at the target"
    );
  });

  it("flashes the points a bust loses", () => {
    const initial = room();
    const [view, setView] = createSignal(initial);

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const meter = within(
      screen.getByRole("article", { name: "Ana, 40 points" })
    ).getByRole("meter", { name: "Total score" });

    expect(meter.querySelector(".meter-lost")).toBeNull();

    setView(
      room({
        players: initial.players.map((player) =>
          player.id === "a" ? { ...player, status: "busted" } : player
        ),
      })
    );
    flush();

    expect(meter.querySelector(".meter-lost")).not.toBeNull();
    expect(meter.style.getPropertyValue("--lost-end")).toBe("23.5%");
    expect(meter).toHaveAttribute("data-round", "none");
  });

  it("ranks banked scores, shares tied ranks, and updates after scoring", async () => {
    const [ana, ben] = room().players;

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

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));

    const rows = () =>
      leaderboard
        .getAllByRole("row")
        .slice(1)
        .map((row) => Array.from(row.children, (cell) => cell.textContent));

    expect(
      leaderboard.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toStrictEqual(["Rank", "Player", "Round", "Total"]);
    expect(rows()).toStrictEqual([
      ["1", "Ana You", "+7", "40"],
      ["2", "Ben", "+36", "12"],
      ["2", "Cara", "+0", "12"],
    ]);

    const { artifact } = await captureArtifact(
      () => {
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
      },
      { scenario: "leaderboard-game-over" }
    );

    expectNoDiagnostics(artifact);
    expect(rows()).toStrictEqual([
      ["1", "Ben", "+3", "202"],
      ["2", "Ana You", "+0", "40"],
      ["3", "Cara", "+0", "12"],
    ]);
    expect(leaderboard.getByRole("row", { name: /Ben/u })).toHaveAttribute(
      "data-winner"
    );
  });

  it("distinguishes live round points and waits for the incoming card to land", () => {
    const [ana, ben] = room().players;
    const [incomingCardId, setIncomingCardId] = createSignal<number | null>(1);

    render(() => (
      <Table
        room={room({
          players: [
            ana,
            { ...ben, status: "stayed" },
            { ...ben, id: "c", name: "Cara", status: "busted" },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
        incomingCardId={incomingCardId()}
      />
    ));

    const leaderboard = within(screen.getByRole("table", { name: "Scores" }));
    const cell = (name: string) => leaderboard.getByRole("cell", { name });

    expect(cell("0 points, in play")).toHaveAttribute(
      "data-round-state",
      "at-risk"
    );
    expect(cell("3 points, banked")).toHaveAttribute(
      "data-round-state",
      "banked"
    );
    expect(cell("0 points, busted")).toHaveTextContent(/^0$/u);

    setIncomingCardId(null);
    flush();
    expect(cell("7 points, in play")).toHaveTextContent("+7");
  });

  it("counts up on a reveal and down on a bust in both round-score displays", () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    try {
      const [state, setState] = createSignal(room());

      const [incomingCardId, setIncomingCardId] = createSignal<number | null>(
        1
      );

      render(() => (
        <Table
          room={state()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={vi.fn<RoomConnection["chat"]>()}
          incomingCardId={incomingCardId()}
        />
      ));

      const seat = within(
        screen.getByRole("article", { name: "Ana, 40 points" })
      );

      const meters = seat.getByRole("meter", { name: "Total score" });
      const scoreTable = within(screen.getByRole("table", { name: "Scores" }));

      const shown = (label: string) => {
        const seatPoints =
          meters.querySelector("[data-projected]")?.textContent;

        const roundCell = scoreTable.getByRole("cell", { name: label });

        return [Number(seatPoints), Number(roundCell.textContent)];
      };

      setIncomingCardId(null);
      flush();
      vi.advanceTimersByTime(64);
      flush();

      const [seatPoints, roundPoints] = shown("7 points, in play");
      expect({
        matched: seatPoints === roundPoints,
        inMotion: seatPoints > 0 && seatPoints < 7,
      }).toStrictEqual({
        matched: true,
        inMotion: true,
      });

      setState(
        room({
          players: state().players.map((player) =>
            player.id === "a" ? { ...player, status: "busted" } : player
          ),
        })
      );
      flush();
      expect(shown("0 points, busted")).toStrictEqual([seatPoints, seatPoints]);

      vi.advanceTimersByTime(64);
      flush();
      const [decreasing] = shown("0 points, busted");
      expect(decreasing).toBeLessThan(seatPoints);

      vi.advanceTimersByTime(320);
      flush();
      expect(shown("0 points, busted")).toStrictEqual([0, 0]);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the deck through deal playback and highlights the game winner", () => {
    const [dealing, setDealing] = createSignal(true);
    const view = room({ phase: "gameOver", winnerIds: ["b"] });

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
        dealing={dealing()}
      />
    ));

    const actionBar = within(
      screen.getByRole("region", { name: "Game status" })
    );

    expect(actionBar.getByText("cards left in the deck")).toBeInTheDocument();

    setDealing(false);
    flush();

    expect(
      screen.getByRole("article", { name: "Ben, 12 points" })
    ).toHaveAttribute("data-winner");
    expect(
      screen.getByRole("article", { name: "Ana, 40 points" })
    ).not.toHaveAttribute("data-winner");
    expect(actionBar.getByText("Ben wins!")).toBeVisible();
    expect(actionBar.queryByText("cards left in the deck")).toBeNull();
  });

  it("an agent can find every control and hit on its turn", async () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const unnamed = entries()
      .filter((entry) => entry.label === "")
      .map((entry) => `${entry.component} ${entry.ref}`);

    expect(unnamed).toStrictEqual([]);

    const labels = entries().map((entry) => entry.label);
    expect(labels).toStrictEqual(
      expect.arrayContaining(["Hit", "Stay", "Copy invite link", "Leave room"])
    );

    const result = await agent.act({
      steps: [{ action: "press", ref: "Hit" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "hit" });
  });

  it("sends a chat message and shows chat in the game log", async () => {
    const chat = vi.fn<RoomConnection["chat"]>();
    render(() => (
      <Table
        room={room({
          log: [
            { id: 1, round: 1, text: "Round 1 begins. Ben deals." },
            { from: { id: "b", name: "Ben" }, id: 2, round: 1, text: "gl" },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chat}
      />
    ));

    const log = screen.getByRole("log", { name: "Chat & Log" });
    expect(within(log).getByText("Ben")).toBeTruthy();
    expect(within(log).getByText("gl")).toBeTruthy();

    const result = await agent.act({
      steps: [
        { action: "setValue", args: ["  you too "], ref: "Chat message" },
        { action: "press", ref: "Send" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(chat).toHaveBeenCalledWith("you too");
  });

  it("groups old game events by clock minute and keeps per-message timestamps", () => {
    const at = (Math.floor(Date.now() / 60_000) - 120) * 60_000;
    render(() => (
      <Table
        room={room({
          log: [
            { id: 1, text: "Round 1 begins. Ben deals." },
            { at, id: 2, round: 1, text: "Round 1 begins. Ben deals." },
            {
              at,
              cue: "bust",
              id: 3,
              round: 1,
              text: "Ben was dealt a duplicate 6 and busted.",
            },
            {
              at: at + 1000,
              cue: "bank",
              id: 4,
              round: 1,
              text: "Ana stayed and banked 44 points.",
            },
            {
              at: at + 2000,
              cue: "freeze",
              id: 5,
              round: 2,
              text: "Ben played Freeze on Ana, who banked 26 points.",
            },
            {
              at: at + 3000,
              cue: "special",
              id: 6,
              round: 2,
              text: "Ben assigned Flip Three to Ana.",
            },
            {
              at: at + 4000,
              cue: "special",
              id: 7,
              round: 2,
              text: "Ben is holding a Second Chance.",
            },
            {
              at: at + 60_000,
              from: { id: "b", name: "Ben" },
              id: 8,
              round: 2,
              text: "Good round",
            },
            {
              at: at + 61_000,
              from: { id: "a", name: "Ana" },
              id: 9,
              round: 2,
              text: "Thanks!",
            },
            { id: 10, round: 2, text: "Round 2 is over." },
            {
              id: 11,
              round: 2,
              text: "The discard pile was shuffled into a new deck.",
            },
            { id: 12, round: 2, text: "Ben wins with 202 points!" },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const log = within(screen.getByRole("log", { name: "Chat & Log" }));

    const rows = log.getAllByRole("listitem").map((row) => {
      const time = within(row).queryByRole("time");

      return {
        announcement: row.querySelector("[data-announcement]") !== null,
        at: time?.getAttribute("datetime"),
        text: row.textContent?.replace(time?.textContent ?? "", ""),
      };
    });

    expect(rows.map((row) => row.at)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new Date(at + 60_000).toISOString(),
      new Date(at + 61_000).toISOString(),
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      log.getAllByRole("heading").map((heading) => heading.textContent)
    ).toStrictEqual(["Round 1", "Round 2"]);
    expect(
      log.getAllByRole("time").map((time) => time.getAttribute("datetime"))
    ).toStrictEqual([
      new Date(at).toISOString(),
      new Date(at).toISOString(),
      new Date(at + 60_000).toISOString(),
      new Date(at + 61_000).toISOString(),
    ]);
    expect(rows.slice(0, 7).map((row) => row.text)).toStrictEqual([
      "Round 1 begins. Ben deals.",
      "Ben deals.",
      "Ben busted · duplicate 6",
      "Ana stayed · +44 pts",
      "Ana was frozen · +26 pts · by Ben",
      "Ben assigned Flip Three · to Ana",
      "Ben got a Second Chance",
    ]);
    expect(
      rows.filter((row) => row.announcement).map((row) => row.text)
    ).toStrictEqual([
      "Round 1 begins. Ben deals.",
      "Ben deals.",
      "Round 2 is over.",
      "Deck rebuilt from the discard pile.",
    ]);
  });

  it("updates relative times on game events and chat messages", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });

    try {
      const at = Date.now();
      render(() => (
        <Table
          room={room({
            log: [
              { at, id: 1, text: "Round 1 begins. Ben deals." },
              { at, from: { id: "b", name: "Ben" }, id: 2, text: "Good luck!" },
            ],
          })}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={vi.fn<RoomConnection["chat"]>()}
        />
      ));

      const log = within(screen.getByRole("log", { name: "Chat & Log" }));
      const times = log.getAllByRole("time");
      const labels = () => times.map((time) => time.textContent);

      expect(labels()).toStrictEqual(["now", "now"]);

      vi.advanceTimersByTime(2000);
      flush();
      expect(labels()).toStrictEqual(["2s", "2s"]);

      vi.advanceTimersByTime(58_000);
      flush();
      expect(labels()).toStrictEqual(["1m", "1m"]);

      vi.setSystemTime(at + 3_599_000);
      vi.advanceTimersByTime(1000);
      flush();

      const clock = new Intl.DateTimeFormat(undefined, {
        timeStyle: "short",
      }).format(at);

      expect(
        log.getAllByRole("time").map((time) => time.textContent)
      ).toStrictEqual([clock, clock]);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("filters activity and counts incoming chat while Game is selected", async () => {
    const [view, setView] = createSignal(room());
    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const filters = within(
      screen.getByRole("group", { name: "Filter activity" })
    );

    expect(
      filters.getByRole("button", { name: "All", pressed: true })
    ).toBeVisible();

    filters.getByRole("button", { name: "Game" }).click();
    flush();

    setView(
      room({
        log: [
          ...view().log,
          { from: { id: "b", name: "Ben" }, id: 2, text: "gl" },
          { from: { id: "a", name: "Ana" }, id: 3, text: "you too" },
        ],
      })
    );
    flush();

    const log = within(screen.getByRole("log", { name: "Chat & Log" }));
    const unread = screen.getByRole("status", { name: "Unread chat messages" });
    expect({
      hiddenMessage: log.queryByText("gl"),
      unread: unread.textContent,
    }).toStrictEqual({
      hiddenMessage: null,
      unread: "1 unread message",
    });

    await agent.act({
      steps: [{ action: "press", ref: "Chat, 1 unread" }],
    });

    expect(
      filters.getByRole("button", { name: "Chat", pressed: true })
    ).toBeVisible();
    expect({
      gameEvent: log.queryByText("Round 1 begins. Ben deals."),
      unread: unread.textContent,
    }).toStrictEqual({
      gameEvent: null,
      unread: "",
    });

    filters.getByRole("button", { name: "All" }).click();
    flush();
    expect(log.getByText("Round 1 begins. Ben deals.")).toBeVisible();
  });

  it("keeps the scroll position and counts new entries until jumping to latest", () => {
    const [view, setView] = createSignal(room());
    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const log = screen.getByRole("log", { name: "Chat & Log" });
    const unread = screen.getByRole("status", { name: "Unread chat messages" });
    Object.defineProperties(log, {
      clientHeight: { value: 200 },
      scrollHeight: { configurable: true, value: 500 },
    });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    flush();

    setView(
      room({
        log: [
          ...view().log,
          { id: 2, text: "Ben stayed." },
          { id: 3, text: "Round 2 begins." },
          { from: { id: "b", name: "Ben" }, id: 4, text: "Good luck!" },
          { from: { id: "a", name: "Ana" }, id: 5, text: "Thanks!" },
        ],
      })
    );
    flush();

    expect({
      after: Object.hasOwn(log.dataset, "scrollAfter"),
      before: Object.hasOwn(log.dataset, "scrollBefore"),
      top: log.scrollTop,
      unread: unread.textContent,
    }).toStrictEqual({
      after: true,
      before: true,
      top: 100,
      unread: "1 unread message",
    });
    screen.getByRole("button", { name: "Jump to latest · 4 new" }).click();
    flush();

    expect(log.scrollTop).toBe(log.scrollHeight);
    expect(log).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: /Jump to latest/u })
    ).toBeNull();

    Object.defineProperty(log, "scrollHeight", { value: 600 });
    setView(
      room({
        log: [
          ...view().log,
          { from: { id: "b", name: "Ben" }, id: 6, text: "Nice hand." },
        ],
      })
    );
    flush();
    expect({ top: log.scrollTop, unread: unread.textContent }).toStrictEqual({
      top: log.scrollHeight,
      unread: "",
    });
  });

  it("marks the score edges that have more rows to scroll to", () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const scores = screen.getByRole("region", { name: "Scores" });
    expect(scores).not.toHaveAttribute("data-scroll-after");

    Object.defineProperties(scores, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 300 },
    });
    fireEvent.scroll(scores);
    expect(scores).not.toHaveAttribute("data-scroll-before");
    expect(scores).toHaveAttribute("data-scroll-after");

    scores.scrollTop = 180;
    fireEvent.scroll(scores);
    expect(scores).toHaveAttribute("data-scroll-before");
    expect(scores).not.toHaveAttribute("data-scroll-after");
  });

  it("pauses moves while the room is syncing and resumes once it is ready", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [syncing, setSyncing] = createSignal(true);
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
        actionsDisabled={syncing()}
      />
    ));

    const hit = screen.getByRole("button", { name: "Hit" });
    const stay = screen.getByRole("button", { name: "Stay" });
    expect(hit).toBeDisabled();
    expect(stay).toBeDisabled();
    hit.click();
    expect(send).not.toHaveBeenCalled();

    setSyncing(false);
    flush();

    expect(hit).toBeEnabled();
    hit.click();
    expect(send).toHaveBeenCalledWith({ type: "hit" });
  });

  it("removing a player needs a person to confirm", async () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const ben = within(screen.getByRole("article", { name: "Ben, 12 points" }));
    expect(ben.getByRole("button", { name: "Remove Ben" })).toBeVisible();
    const scores = within(screen.getByRole("table", { name: "Scores" }));
    expect(scores.queryByRole("button", { name: /Remove/u })).toBeNull();

    const remove = {
      steps: [
        { action: "press", args: ["Remove from room"], ref: "Remove Ben" },
      ],
    };

    approve = false;
    const refused = await agent.act(remove);
    expect(refused.ok).toBeFalsy();
    expect(send).not.toHaveBeenCalled();
    approve = true;
    await agent.act(remove);
    expect(send).toHaveBeenCalledWith({ playerId: "b", type: "kick" });
    approve = false;
  });

  it("keeps Remove controls out of seats and Scores while picking a target", () => {
    const choice = {
      card: { id: 9, kind: "freeze" as const },
      chooserId: "a",
      options: ["a", "b"],
    };

    render(() => (
      <Table
        room={room({ choice })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    for (const seat of screen.getAllByRole("article")) {
      expect(
        within(seat).queryByRole("button", { name: /Remove/u })
      ).toBeNull();
    }

    const scores = within(screen.getByRole("table", { name: "Scores" }));
    expect(scores.queryByRole("button", { name: /Remove/u })).toBeNull();
  });

  it("labels the action bar as your move only when it is yours", () => {
    const [view, setView] = createSignal(room());

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(screen.getByRole("region", { name: "Your move" })).toBeVisible();

    setView(room({ turnId: "b" }));
    flush();
    expect(screen.getByRole("region", { name: "Game status" })).toBeVisible();

    setView(
      room({
        choice: {
          card: { id: 9, kind: "freeze" as const },
          chooserId: "a",
          options: ["a", "b"],
        },
      })
    );
    flush();
    expect(screen.getByRole("region", { name: "Your move" })).toBeVisible();
  });

  it("keeps Leave room focusable with a reason during the deal", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [dealing, setDealing] = createSignal(true);

    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
        actionsDisabled={dealing()}
      />
    ));
    const leave = screen.getByRole("button", { name: "Leave room" });
    expect(leave).toHaveAttribute("aria-disabled", "true");
    expect(leave).toHaveAccessibleDescription("You can leave after the deal");
    leave.click();
    flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    setDealing(false);
    flush();
    expect(leave).not.toHaveAttribute("aria-disabled");
    expect(leave).not.toHaveAccessibleDescription(
      "You can leave after the deal"
    );
  });

  it("prompts the chooser and dims players who cannot receive the card", () => {
    const view = room({
      choice: {
        card: { id: 9, kind: "freeze" },
        chooserId: "a",
        options: ["a"],
      },
    });

    const ben = view.players.find((player) => player.id === "b");

    if (ben) {
      ben.status = "busted";
    }

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    expect(screen.getByText(/Who gets your Freeze/u)).toBeVisible();
    expect(screen.getByText("Tap a player")).toBeVisible();
    expect(
      screen.getByRole("article", { name: "Ana, 40 points" })
    ).toHaveAttribute("data-pickable", "freeze");
    expect(
      screen.getByRole("article", { name: "Ben, 12 points" })
    ).toHaveAttribute("data-unpickable");
  });

  it("the chooser picks an action card target by clicking a seat", () => {
    const send = vi.fn<RoomConnection["send"]>();

    const choice = {
      card: { id: 9, kind: "freeze" as const },
      chooserId: "a",
      options: ["a", "b"],
    };

    render(() => (
      <Table
        room={room({ choice })}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    const seat = screen.getByRole("article", { name: "Ana, 40 points" });
    expect(within(seat).getByText("Choosing…")).toBeVisible();
    screen.getByRole("button", { name: "Freeze Ben" }).click();
    flush();
    expect(send).toHaveBeenCalledWith({ targetId: "b", type: "choose" });
    expect(screen.queryByRole("button", { name: "Hit" })).toBeNull();
    cleanup();

    render(() => (
      <Table
        room={room({ choice })}
        playerId="b"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(screen.queryByRole("button", { name: "Freeze Ben" })).toBeNull();
    expect(
      screen.getByText("Ana is choosing who receives Freeze.")
    ).toBeInTheDocument();
  });

  it("clears the unread count when the chat sheet opens and returns focus on close", async () => {
    const [view, setView] = createSignal(room());

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Chat & Log" });
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");

    setView(
      room({
        log: [
          { id: 1, text: "Round 1 begins. Ben deals." },
          { from: { id: "b", name: "Ben" }, id: 2, text: "gl" },
          { from: { id: "a", name: "Ana" }, id: 3, text: "you too" },
        ],
      })
    );
    flush();

    expect(toggle).toHaveAccessibleName("Chat & Log, 1 new message");

    toggle.focus();
    toggle.click();
    flush();

    const sheet = await screen.findByRole("dialog", {
      name: "Chat & Log",
    });

    expect(toggle).toHaveAccessibleName("Chat & Log");
    within(sheet).getByRole("button", { name: "Close" }).click();
    flush();
    expect(screen.queryByRole("dialog", { name: "Chat & Log" })).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("keeps the chat draft after dismissing the sheet with Escape", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Chat & Log" });
    toggle.focus();
    toggle.click();

    const sheet = await screen.findByRole("dialog", {
      name: "Chat & Log",
    });

    const input = within(sheet).getByRole("textbox", { name: "Chat message" });
    fireEvent.input(input, { target: { value: "See you next round" } });
    flush();

    fireEvent.keyDown(input, { key: "Escape" });
    flush();
    expect(toggle).toHaveFocus();

    toggle.click();

    const reopened = await screen.findByRole("dialog", {
      name: "Chat & Log",
    });

    expect(
      within(reopened).getByRole("textbox", { name: "Chat message" })
    ).toHaveValue("See you next round");
  });

  it("other players see whose turn it is, not the Hit button", () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    const seat = screen.getByRole("article", { name: "Ana, 40 points" });
    expect(within(seat).getByText("Thinking…")).toBeVisible();
    expect(screen.getByText("Ana is deciding…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/u })).toBeNull();
  });

  it("lets the host move for an offline player whose turn it is", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const view = room({ turnId: "b" });
    view.players = view.players.map((seat) =>
      seat.id === "b" ? { ...seat, connected: false } : seat
    );

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(
      screen.getByText(/Play for them, or the game will Stay soon/u)
    ).toBeVisible();
    screen.getByRole("button", { name: "Hit for Ben" }).click();
    flush();
    expect(send).toHaveBeenCalledWith({ forId: "b", type: "hit" });
    screen.getByRole("button", { name: "Stay for Ben with 3 points" }).click();
    flush();
    expect(send).toHaveBeenCalledWith({ forId: "b", type: "stay" });
    cleanup();

    render(() => (
      <Table
        room={{ ...view, hostId: "b" }}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(screen.queryByRole("button", { name: "Hit for Ben" })).toBeNull();
  });

  it("sends the choice for an offline player from their seat", () => {
    const send = vi.fn<RoomConnection["send"]>();

    const view = room({
      choice: {
        card: { id: 9, kind: "freeze" },
        chooserId: "b",
        options: ["a", "b"],
      },
      turnId: null,
    });

    view.players = view.players.map((seat) =>
      seat.id === "b" ? { ...seat, connected: false } : seat
    );

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(screen.getByText(/Pick who gets their Freeze/u)).toBeVisible();
    screen.getByRole("button", { name: "Freeze themselves for Ben" }).click();
    flush();

    expect(send).toHaveBeenCalledWith({
      forId: "b",
      targetId: "b",
      type: "choose",
    });
    expect(
      screen.getByRole("button", { name: "Freeze yourself for Ben" })
    ).toBeInTheDocument();
  });

  it("updates eligible seat targets during a Room sync", async () => {
    const send = vi.fn<RoomConnection["send"]>();

    const choice = {
      card: { id: 9, kind: "freeze" as const },
      chooserId: "a",
      options: ["a", "b"],
    };

    const [view, setView] = createSignal(room({ choice }));
    const [syncing, setSyncing] = createSignal(true);

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
        actionsDisabled={syncing()}
      />
    ));

    expect(screen.getByRole("button", { name: "Freeze Ben" })).toBeDisabled();

    const { artifact } = await captureArtifact(
      () => {
        setView(room({ choice: { ...choice, options: ["a"] } }));
        setSyncing(false);
        flush();
      },
      { scenario: "table-choice-targets-after-sync" }
    );

    expectNoDiagnostics(artifact);
    expect(screen.queryByRole("button", { name: "Freeze Ben" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Freeze yourself" })
    ).toBeEnabled();
  });

  it("names later games in the log's round headings", () => {
    render(() => (
      <Table
        room={room({
          log: [
            { game: 1, id: 1, round: 1, text: "Round 1 begins. Ben deals." },
            { game: 1, id: 2, round: 0, text: "Cal joined." },
            { game: 2, id: 3, round: 1, text: "Round 1 begins. Ana deals." },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    const log = screen.getByRole("log");
    expect(
      within(log)
        .getAllByRole("heading")
        .map((heading) => heading.textContent)
    ).toStrictEqual(["Round 1", "Lobby", "Game 2 · Round 1"]);
  });

  it("says when the player everyone is waiting on is offline", () => {
    const view = room();
    view.players = view.players.map((seat) =>
      seat.id === "a" ? { ...seat, connected: false } : seat
    );

    render(() => (
      <Table
        room={view}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));
    expect(
      screen.getByText(/The game will Stay for them soon/u)
    ).toBeInTheDocument();
  });
});
