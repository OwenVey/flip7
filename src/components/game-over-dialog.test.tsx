import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateRoundScore } from "../game/cards";
import type { PlayerView, RoomView } from "../game/protocol";
import GameOverDialog from "./game-over-dialog";

const player = (id: string, name: string, score: number) => {
  const view: PlayerView = {
    avatar: 1,
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
    botSpeed: "normal",
    choice: null,
    code: "ABCDE",
    dealerId: "a",
    deckCount: 40,
    discardCount: 0,
    draws: [],
    flips: [],
    held: [],
    hostId: "a",
    locked: false,
    log: [],
    phase: "gameOver",
    players: [
      player("a", "Ana", 140),
      player("b", "Ben", 212),
      player("c", "Cara", 90),
    ],
    round: 6,
    targetScore: 200,
    turnId: null,
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
        canReturnToLobby={false}
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
      screen.getByText("Waiting for the host to head back to the lobby.")
    ).toBeInTheDocument();
  });

  it("congratulates the winner and lets the host return to the lobby", () => {
    const onReturnToLobby = vi.fn<() => void>();
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="b"
        canReturnToLobby
        onReturnToLobby={onReturnToLobby}
      />
    ));

    openDialog();

    expect(screen.getByRole("dialog", { name: "You win!" })).toBeVisible();
    expect(screen.queryByText(/You finished/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));

    expect(onReturnToLobby).toHaveBeenCalledOnce();
  });

  it("marks hidden rows at either edge of the final standings", () => {
    render(() => (
      <GameOverDialog
        room={room()}
        playerId="a"
        canReturnToLobby={false}
        onReturnToLobby={vi.fn<() => void>()}
      />
    ));

    openDialog();
    const standings = screen.getByRole("region", { name: "Final standings" });
    expect(standings).not.toHaveAttribute("data-scroll-after");

    Object.defineProperties(standings, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 300 },
    });
    fireEvent.scroll(standings);
    expect(standings).toHaveAttribute("data-scroll-after");
    expect(standings).not.toHaveAttribute("data-scroll-before");

    standings.scrollTop = 180;
    fireEvent.scroll(standings);
    expect(standings).toHaveAttribute("data-scroll-before");
    expect(standings).not.toHaveAttribute("data-scroll-after");
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
          canReturnToLobby={false}
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
