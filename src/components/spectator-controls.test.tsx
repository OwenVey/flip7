import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addBot, addPlayer, createGame, MAX_PLAYERS } from "../game/engine";
import { toRoomView } from "../game/protocol";
import {
  SpectatorActions,
  WatchInstead,
  WatcherCount,
} from "./spectator-controls";
import type { SpectatorJoin } from "./spectator-controls";

const roomOf = (size: number, locked = false) => {
  const state = createGame();

  for (let index = 0; index < size; index += 1) {
    addPlayer(state, `p${index}`, `Player ${index}`, 1);
  }

  state.settings.locked = locked;

  return toRoomView("ABCDE", state);
};

const join = (overrides: Partial<SpectatorJoin> = {}) =>
  ({
    error: "",
    joining: false,
    onEdit: vi.fn<() => void>(),
    onJoin: vi.fn<(name: string, avatar: number) => void>(),
    savedAvatar: null,
    savedName: "",
    unavailable: false,
    ...overrides,
  }) satisfies SpectatorJoin;

const joinButton = () => screen.getByRole("button", { name: "Join as player" });

describe("<WatcherCount />", () => {
  afterEach(cleanup);

  it("stays hidden from players until someone watches", () => {
    render(() => <WatcherCount count={0} watching={false} />);
    expect(screen.queryByText(/watching/u)).toBeNull();
  });

  it("counts other spectators for players", () => {
    render(() => <WatcherCount count={3} watching={false} />);
    expect(screen.getByText("3 watching")).toBeInTheDocument();
  });

  it("counts every spectator, including the viewer", () => {
    render(() => <WatcherCount count={3} watching />);
    expect(screen.getByText("3 watching")).toBeInTheDocument();
  });
});

describe("<SpectatorActions />", () => {
  afterEach(cleanup);

  it("opens a join dialog and takes a seat", async () => {
    const onJoin = vi.fn<(name: string, avatar: number) => void>();

    render(() => (
      <SpectatorActions
        room={roomOf(2)}
        join={join({ onJoin, savedName: "Cy" })}
        onStopWatching={vi.fn<() => void>()}
      />
    ));

    fireEvent.click(joinButton());
    await screen.findByRole("dialog", { name: "Take a seat" });
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    expect(onJoin).toHaveBeenCalledOnce();
    expect(onJoin.mock.calls[0]?.[0]).toBe("Cy");
  });

  it.each([
    ["full", roomOf(MAX_PLAYERS)],
    ["locked", roomOf(2, true)],
  ])("keeps Join closed when the room is %s", (_, room) => {
    render(() => (
      <SpectatorActions
        room={room}
        join={join()}
        onStopWatching={vi.fn<() => void>()}
      />
    ));

    expect(joinButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(joinButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the room, except while a join is in flight", () => {
    const onStopWatching = vi.fn<() => void>();

    render(() => (
      <SpectatorActions
        room={roomOf(2)}
        join={join({ joining: true })}
        onStopWatching={onStopWatching}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Leave room" }));
    expect(onStopWatching).not.toHaveBeenCalled();
  });
});

const watchButton = () => screen.getByRole("button", { name: "Watch instead" });

describe("<WatchInstead />", () => {
  afterEach(cleanup);

  it("gives up the seat to watch", () => {
    const onWatch = vi.fn<() => void>();
    render(() => (
      <WatchInstead room={roomOf(2)} playerId="p1" onWatch={onWatch} />
    ));

    fireEvent.click(watchButton());
    expect(onWatch).toHaveBeenCalledOnce();
  });

  it("stays put when only bots would be left", () => {
    const state = createGame();
    addPlayer(state, "p0", "Ana", 1);
    addBot(state, "p0", "bot", () => 0);
    const onWatch = vi.fn<() => void>();

    render(() => (
      <WatchInstead
        room={toRoomView("ABCDE", state)}
        playerId="p0"
        onWatch={onWatch}
      />
    ));

    expect(watchButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(watchButton());
    expect(onWatch).not.toHaveBeenCalled();
  });
});
