import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
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
import type { RoomConnection } from "../lib/room-connection";
import { room } from "../test/room-view";
import { agent, agentApproval, Table } from "../test/table";

const meterOf = (name: string) =>
  within(screen.getByRole("article", { name })).getByRole("meter", {
    name: "Total score",
  });

describe("<RoundPlayer />", () => {
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
          { id: 90, kind: "modifier", value: 4 },
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
                  modifiers: 0,
                  doubled: false,
                  numbers: 7,
                  flipSeven: false,
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
                    modifiers: 0,
                    doubled: false,
                    numbers: 7,
                    flipSeven: false,
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

  it("keeps Remove steady during the deal and blocks it only while offline", () => {
    const [offline, setOffline] = createSignal(false);
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={vi.fn<RoomConnection["chat"]>()}
        actionsDisabled
        dealing
        offline={offline()}
      />
    ));

    const remove = screen.getByRole("button", { name: "Remove Ben" });
    expect(remove).not.toHaveAttribute("aria-disabled");

    setOffline(true);
    flush();
    expect(remove).toHaveAttribute("aria-disabled", "true");
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

    agentApproval.approve = false;
    const refused = await agent.act(remove);
    expect(refused.ok).toBeFalsy();
    expect(send).not.toHaveBeenCalled();
    agentApproval.approve = true;
    await agent.act(remove);
    expect(send).toHaveBeenCalledWith({ playerId: "b", type: "kick" });
    agentApproval.approve = false;
  });

  it("keeps the host's Remove control available while picking a target", async () => {
    const choice = {
      card: { id: 9, kind: "freeze" as const },
      chooserId: "a",
      options: ["a", "b"],
    };

    const sent = Promise.withResolvers<Parameters<RoomConnection["send"]>[0]>();

    const send: RoomConnection["send"] = async (command) => {
      sent.resolve(command);

      return await Promise.resolve(true);
    };

    render(() => (
      <Table
        room={room({ choice })}
        playerId="a"
        send={send}
        chat={vi.fn<RoomConnection["chat"]>()}
      />
    ));

    const remove = screen.getByRole("button", { name: "Remove Ben" });
    expect(remove).not.toHaveAttribute("aria-disabled");
    fireEvent.click(remove);
    flush();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove from room" })
    );
    await expect(sent.promise).resolves.toStrictEqual({
      playerId: "b",
      type: "kick",
    });
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
});
