import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
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
    choice: null,
    code: "ABCDE",
    dealerId: "b",
    deckCount: 80,
    discardCount: 0,
    draws: [],
    flips: [],
    held: [],
    hostId: "a",
    log: [{ id: 1, text: "Round 1 begins. Ben deals." }],
    phase: "playing",
    players: [
      {
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

  it("shows both score totals and the goal in the same label row", () => {
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
    const banked = within(meter).getByText("40");
    expect(banked).toBeVisible();
    expect(
      Array.from(
        banked.parentElement?.children ?? [],
        (label) => label.textContent
      )
    ).toStrictEqual(["40", "+7", "200"]);
    expect(meter).toHaveAttribute("aria-valuenow", "40");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      "40 of 200 points, 7 this round"
    );
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
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      "47 of 200 points, 7 this round"
    );
  });

  it("keeps the scored round's points on the meter until the next round", () => {
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

    expect(meter.style.getPropertyValue("--round-start")).toBe("20%");
    expect(meter.style.getPropertyValue("--projected-score")).toBe("23.5%");
    expect(within(meter).getByText("40")).toBeVisible();
    expect(within(meter).getByText("+7")).toBeVisible();
    expect(within(seat).queryByText(/points this round/u)).toBeNull();
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
      "195 of 200 points, 7 this round, enough to win"
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

    const [view, setView] = createSignal(room({ players: [ben, ana, cara] }));

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const leaderboard = within(
      screen.getByRole("table", { name: "Leaderboard" })
    );

    const rows = () =>
      leaderboard
        .getAllByRole("row")
        .slice(1)
        .map((row) => Array.from(row.children, (cell) => cell.textContent));

    expect(
      leaderboard.queryByRole("columnheader", { name: "Round" })
    ).toBeNull();
    expect(rows()).toStrictEqual([
      ["1", "Ana You", "40"],
      ["2", "Ben", "12"],
      ["2", "Cara", "12"],
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
      expect.arrayContaining([
        "Hit",
        "Stay with 7 points",
        "Copy invite link",
        "Leave room",
        "Remove Ben",
      ])
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

    const log = screen.getByRole("log", { name: "Game log" });
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
    const stay = screen.getByRole("button", { name: "Stay with 7 points" });
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
    const confirmed = await agent.act(remove);
    expect(confirmed.ok).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ playerId: "b", type: "kick" });
    approve = false;
  });

  it("only the chooser sees target buttons for an action card", () => {
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
      screen.getByText(/Offline, so they'll stay soon/u)
    ).toBeInTheDocument();
  });
});
