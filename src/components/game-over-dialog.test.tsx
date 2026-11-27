import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateRoundScore } from "../game/cards";
import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";
import GameOverDialog from "./game-over-dialog";

const player = (id: string, name: string, score: number) => {
  const view: Player = {
    avatar: 1,
    bot: false,
    bustCard: null,
    connected: true,
    hand: [],
    id,
    lastRound: null,
    name,
    score,
    status: "stayed",
  };

  return view;
};

const room = () => {
  const view: RoomView = {
    choice: null,
    code: "ABCDE",
    dealerId: "a",
    deckCount: 40,
    discardCount: 0,
    dealSeq: 0,
    drawSeq: 0,
    dealHistory: [],
    flips: [],
    held: [],
    hostId: "a",
    log: [],
    phase: "gameOver",
    players: [
      player("a", "Ana", 140),
      player("b", "Ben", 212),
      player("c", "Cara", 90),
    ],
    reactions: {},
    round: 6,
    settings: { botSpeed: "normal", locked: false, targetScore: 200 },
    spectatorCount: 0,
    turnId: null,
    winner: { id: "b", name: "Ben", points: 212 },
    winnerIds: ["b"],
  };

  return view;
};

const openDialog = () => {
  vi.advanceTimersByTime(1000);
  flush();
};

describe("<GameOverDialog />", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pops in with the winner and final standings", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="a"
        canPlayAgain={false}
        canReturnToLobby={false}
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    expect(screen.queryByRole("dialog")).toBeNull();

    openDialog();

    expect(screen.getByRole("dialog", { name: "Ben wins!" })).toBeVisible();
    expect(
      screen.getByText("You finished 2nd with 140 points.")
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".game-over-name")?.textContent)
    ).toStrictEqual(["Ben", "Ana You", "Cara"]);
    expect(
      screen.getByText(
        "Waiting for Ana to play again or head back to the lobby."
      )
    ).toBeInTheDocument();
  });

  it("keeps a winner who has left in the standings, under the name they won with", () => {
    const view = room();
    view.players = view.players.filter(({ id }) => id !== "b");

    render(() => (
      <GameOverDialog
        room={view}
        playerId="a"
        canPlayAgain={false}
        canReturnToLobby={false}
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();

    expect(screen.getByRole("dialog", { name: "Ben wins!" })).toBeVisible();
    expect(
      screen.getByText("You finished 2nd with 140 points.")
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".game-over-name")?.textContent)
    ).toStrictEqual(["Ben Left", "Ana You", "Cara"]);
  });

  it("congratulates the winner and lets the host play again or return to the lobby", () => {
    const onPlayAgain = vi.fn<() => void>();
    const onReturnToLobby = vi.fn<() => void>();
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="b"
        canPlayAgain
        canReturnToLobby
        onPlayAgain={onPlayAgain}
        onReturnToLobby={onReturnToLobby}
      />
    ));

    openDialog();

    expect(screen.getByRole("dialog", { name: "You win!" })).toBeVisible();
    expect(screen.queryByText(/You finished/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));

    expect(onPlayAgain).toHaveBeenCalledOnce();
    expect(onReturnToLobby).toHaveBeenCalledOnce();
  });

  it("only offers the lobby when too few players are left to play again", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="b"
        canPlayAgain={false}
        canReturnToLobby
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();

    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Back to lobby" })
    ).toBeInTheDocument();
  });

  it("marks your own row in the final standings", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="a"
        canPlayAgain={false}
        canReturnToLobby={false}
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();

    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => Object.hasOwn(item.dataset, "me"))
    ).toStrictEqual([false, true, false]);
  });

  it("closes from the corner button so you can see the table", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="a"
        canPlayAgain={false}
        canReturnToLobby={false}
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "See the table" }));
    flush();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks hidden rows at either edge of the final standings", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="a"
        canPlayAgain={false}
        canReturnToLobby={false}
        onPlayAgain={vi.fn<() => void>()}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();
    const standings = screen.getByRole("region", { name: "Final standings" });
    expect(standings).toHaveAttribute("data-at-y-end");

    Object.defineProperties(standings, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 300 },
    });
    fireEvent.scroll(standings);
    vi.advanceTimersToNextFrame();
    expect(standings).not.toHaveAttribute("data-at-y-end");
    expect(standings).toHaveAttribute("data-at-y-start");

    standings.scrollTop = 180;
    fireEvent.scroll(standings);
    vi.advanceTimersToNextFrame();
    expect(standings).not.toHaveAttribute("data-at-y-start");
    expect(standings).toHaveAttribute("data-at-y-end");
  });

  it("counts final scores from the previous total when the dialog opens", () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    try {
      const view = room();

      const lastRound = calculateRoundScore([
        { id: 1, kind: "number", value: 12 },
      ]);

      view.players = view.players.map((entry) =>
        entry.id === "b" ? { ...entry, lastRound } : entry
      );
      render(() => (
        <GameOverDialog
          room={view}
          playerId="a"
          canPlayAgain={false}
          canReturnToLobby={false}
          onPlayAgain={vi.fn<() => void>()}
          onReturnToLobby={vi.fn<() => void>()}
        />
      ));

      openDialog();
      const shown = screen.getByText("200", { exact: true });
      expect(shown).toHaveAttribute("aria-hidden", "true");

      vi.advanceTimersByTime(200);
      flush();
      const intermediate = Number(shown.textContent);
      expect(intermediate > 200 && intermediate < 212).toBeTruthy();

      vi.advanceTimersByTime(500);
      flush();
      expect(shown).toHaveTextContent("212");
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});
