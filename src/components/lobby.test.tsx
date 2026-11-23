import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addBot, addPlayer, createGame, MAX_PLAYERS } from "../game/engine";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import Lobby from "./lobby";

const roomOf = (size: number) => {
  const state = createGame();

  for (let index = 0; index < size; index += 1) {
    addPlayer(state, `p${index}`, `Player ${index}`, 1);
  }

  return toRoomView("ABCDE", state);
};

const roomWithBot = () => {
  const state = createGame();
  addPlayer(state, "p0", "Host", 1);
  addPlayer(state, "p1", "Guest", 1);
  addBot(state, "p0", "bot", () => 0);

  return toRoomView("ABCDE", state);
};

const addBotButton = () =>
  screen.getByRole("button", { name: /Add bot|Table full/u });

describe("<Lobby />", () => {
  afterEach(cleanup);

  it("keeps the host's Add bot button mounted and focusable once the room fills", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [room, setRoom] = createSignal<RoomView>(roomOf(MAX_PLAYERS - 1));

    render(() => <Lobby room={room()} playerId="p0" send={send} />);
    const button = addBotButton();
    expect(button).not.toHaveAttribute("aria-disabled");

    setRoom(roomOf(MAX_PLAYERS));
    flush();
    expect(addBotButton()).toBe(button);
    expect(button).toHaveTextContent("Table full");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a bot's Remove focusable but ignores presses while actions are paused", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [paused, setPaused] = createSignal(true);
    render(() => (
      <Lobby
        room={roomWithBot()}
        playerId="p0"
        send={send}
        actionsDisabled={paused()}
      />
    ));
    const [, bot] = screen.getAllByRole("button", { name: /^Remove/u });
    expect(bot).toBeEnabled();
    expect(bot).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(bot);
    expect(send).not.toHaveBeenCalled();

    setPaused(false);
    flush();
    fireEvent.click(bot);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      playerId: "bot",
      type: "kick",
    });
  });

  it("shows one open seat until the room is full, then none", () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(1));

    render(() => (
      <Lobby
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));
    expect(screen.getAllByText("Open seat")).toHaveLength(1);

    setRoom(roomOf(MAX_PLAYERS - 1));
    flush();
    expect(screen.getAllByText("Open seat")).toHaveLength(1);

    setRoom(roomOf(MAX_PLAYERS));
    flush();
    expect(screen.queryByText("Open seat")).toBeNull();
  });

  it("shows guests the player count without the Add bot button", () => {
    render(() => (
      <Lobby
        room={roomOf(3)}
        playerId="p1"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(screen.queryByRole("button", { name: /Add bot/u })).toBeNull();
    expect(screen.getByText(`3 / ${MAX_PLAYERS}`)).toBeInTheDocument();
  });

  it("removes a bot in one tap but asks before removing a person", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => <Lobby room={roomWithBot()} playerId="p0" send={send} />);
    const [guest, bot] = screen.getAllByRole("button", { name: /^Remove/u });

    fireEvent.click(bot);
    fireEvent.click(guest);

    expect(send).toHaveBeenCalledExactlyOnceWith({
      playerId: "bot",
      type: "kick",
    });
  });

  it("offers the invite from the open seat", () => {
    render(() => (
      <Lobby
        room={roomOf(1)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(
      screen.getByRole("button", { name: /Open seat.*invite/iu })
    ).toBeInTheDocument();
  });
});
