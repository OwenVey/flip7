import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
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

  it("keeps the open seat list quiet while bots join", async () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));
    const seat = screen.getByText("Open seat");

    const { artifact } = await captureArtifact(
      () => {
        for (let size = 3; size <= 8; size += 1) {
          setRoom(roomOf(size));
          flush();
        }
      },
      { scenario: "lobby-bots-join" }
    );

    expectNoDiagnostics(artifact);
    expect(screen.getByText("Open seat")).toBe(seat);
  });

  it("slides in only the players who join after the lobby shows", () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));
    setRoom(roomOf(3));
    flush();

    const rows = screen
      .getAllByRole("listitem")
      .filter((row) => !row.classList.contains("open-seat"));

    expect(rows.map((row) => row.dataset.arrived)).toStrictEqual([
      undefined,
      undefined,
      "",
    ]);
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

  it("sends the host's settings changes and shows the room's saved values", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => <Lobby room={roomWithBot()} playerId="p0" send={send} />);

    expect(screen.getByRole("radio", { name: "200" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "300" }));
    fireEvent.click(screen.getByRole("radio", { name: "Fast" }));
    fireEvent.click(screen.getByRole("switch", { name: /Lock room/u }));

    expect(send.mock.calls).toStrictEqual([
      [{ targetScore: 300, type: "configure" }],
      [{ botSpeed: "fast", type: "configure" }],
      [{ locked: true, type: "configure" }],
    ]);
    expect(screen.getByRole("radio", { name: "200" })).toBeChecked();
  });

  it("shows guests the settings and a locked seat instead of the invite", () => {
    render(() => (
      <Lobby
        room={{
          ...roomWithBot(),
          settings: { botSpeed: "fast", locked: true, targetScore: 100 },
        }}
        playerId="p1"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.getByText("First to 100 · Fast bots · Room locked")
    ).toBeInTheDocument();
    expect(screen.getByText("Room locked")).toBeInTheDocument();
    expect(screen.queryByText("Open seat")).toBeNull();
  });

  it("offers bot speed only once a bot is seated", () => {
    render(() => (
      <Lobby
        room={roomOf(2)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(screen.queryByRole("radiogroup", { name: "Bot speed" })).toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Winning score" })
    ).toBeInTheDocument();
  });

  it("shows the host a disabled Start game that says what it's waiting for", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => <Lobby room={roomOf(1)} playerId="p0" send={send} />);

    const start = screen.getByRole("button", { name: "Start game" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription(
      "Add a bot or invite 1 more player."
    );
    fireEvent.click(start);
    expect(send).not.toHaveBeenCalled();
  });
});
