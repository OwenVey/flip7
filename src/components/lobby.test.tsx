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

import {
  addBot,
  addPlayer,
  backToLobby,
  createGame,
  MAX_PLAYERS,
} from "../game/engine";
import { toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import { chatControls } from "../test/chat";
import { captureScenario } from "../test/diagnostics";
import { itemAt } from "../test/item-at";
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

const spectator = () => ({
  join: {
    error: "",
    joining: false,
    onEdit: vi.fn<() => void>(),
    onJoin: vi.fn<(name: string, avatar: number) => void>(),
    savedAvatar: null,
    savedName: "",
    unavailable: false,
  },
  onLeave: vi.fn<() => void>(),
});

describe("<Lobby />", () => {
  afterEach(cleanup);

  it("keeps the host's Add bot button mounted and focusable once the room fills", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [room, setRoom] = createSignal<RoomView>(roomOf(MAX_PLAYERS - 1));

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId="p0"
        send={send}
      />
    ));
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
        chat={chatControls()}
        typing={[]}
        room={roomWithBot()}
        playerId="p0"
        send={send}
        actionsDisabled={paused()}
      />
    ));

    const bot = itemAt(screen.getAllByRole("button", { name: /^Remove/u }), 1);

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

  it("keeps a placeholder for every vacancy and labels only the next", () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(1));

    const { container } = render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    const vacancies = () => container.querySelectorAll(".roster .open-seat");

    expect(vacancies()).toHaveLength(MAX_PLAYERS - 1);
    expect(screen.getAllByText("Waiting for players…")).toHaveLength(1);

    setRoom(roomOf(MAX_PLAYERS - 1));
    flush();
    expect(vacancies()).toHaveLength(1);

    setRoom(roomOf(MAX_PLAYERS));
    flush();
    expect(vacancies()).toHaveLength(0);
  });

  it("lists only seated players to assistive tech", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomOf(1)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(
      within(screen.getByRole("list", { name: "Players" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(1);
  });

  it("keeps the open seat list quiet while bots join", async () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));
    const seat = screen.getByText("Waiting for players…");

    const { artifact } = await captureScenario(() => {
      for (let size = 3; size <= 8; size += 1) {
        setRoom(roomOf(size));
        flush();
      }
    }, "lobby-bots-join");

    expectNoDiagnostics(artifact);
    expect(screen.getByText("Waiting for players…")).toBe(seat);
  });

  it("keeps the final round folded after the host returns to the lobby", () => {
    const state = createGame();
    addPlayer(state, "p0", "Host", 1);
    state.phase = "gameOver";
    state.round = 1;
    state.log.push({
      at: Date.now(),
      event: {
        player: { id: "p0", name: "Host" },
        points: 202,
        scores: [{ id: "p0", name: "Host", points: 21 }],
        type: "gameWon",
      },
      game: 1,
      id: state.logSeq + 1,
      round: 1,
    });
    backToLobby(state, "p0");

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={toRoomView("ABCDE", state)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    const log = within(screen.getByRole("log", { name: "Chat & Log" }));

    expect(log.getByRole("button", { name: "Round 1" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(log.queryByText("Host wins with 202 points!")).toBeNull();
  });

  it("shows spectators the chat log and their actions, without Leave", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomOf(2)}
        playerId={null}
        send={vi.fn<RoomConnection["send"]>()}
        spectator={spectator()}
      />
    ));

    expect(
      screen.getByRole("button", { name: "Join as player" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Leave room" })).toHaveLength(
      1
    );
    expect(screen.queryByRole("button", { name: "Watch instead" })).toBeNull();
    expect(screen.getAllByText("Join as a player to chat.")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Chat & Log" })
    ).toBeInTheDocument();
  });

  it("keeps a Spectator's Join dialog and draft open when the room updates", async () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId={null}
        send={vi.fn<RoomConnection["send"]>()}
        spectator={spectator()}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Join as player" }));
    const dialog = await screen.findByRole("dialog", { name: "Take a seat" });
    const input = within(dialog).getByRole("textbox", { name: "Your name" });
    // SAFETY: the textbox role only matches input elements here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getByRole returns HTMLElement.
    (input as HTMLInputElement).value = "Cal";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    setRoom({ ...roomOf(3), spectatorCount: 2 });
    flush();

    expect(screen.getByRole("dialog", { name: "Take a seat" })).toBe(dialog);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Cal");
  });

  it("lets seated players chat in the lobby", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomOf(2)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    expect(
      screen.getByRole("textbox", { name: "Chat message" })
    ).toBeInTheDocument();
  });

  it("slides in only the players who join after the lobby shows", () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));
    setRoom(roomOf(3));
    flush();

    const rows = [
      ...document.querySelectorAll<HTMLElement>(".roster > li"),
    ].filter((row) => !row.classList.contains("open-seat"));

    expect(rows.map((row) => row.dataset.arrived)).toStrictEqual([
      undefined,
      undefined,
      "",
    ]);
  });

  it("shows guests the player count without the Add bot button", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
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
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomWithBot()}
        playerId="p0"
        send={send}
      />
    ));
    const removes = screen.getAllByRole("button", { name: /^Remove/u });
    const [guest, bot] = [itemAt(removes, 0), itemAt(removes, 1)];

    fireEvent.click(bot);
    fireEvent.click(guest);

    expect(send).toHaveBeenCalledExactlyOnceWith({
      playerId: "bot",
      type: "kick",
    });
  });

  it("offers the invite only in the Invite friends card", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomOf(1)}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    const [invite] = screen.getAllByRole("button", { name: /invite link/iu });
    expect(
      screen.getAllByRole("button", { name: /invite link/iu })
    ).toHaveLength(1);
    expect(invite?.closest("section")).toContainElement(
      screen.getByRole("heading", { name: "Invite friends" })
    );
  });

  it("sends the host's settings changes and shows the room's saved values", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomWithBot()}
        playerId="p0"
        send={send}
      />
    ));

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

  it("shows guests the settings and marks vacant seats as locked", () => {
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
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
    expect(screen.queryByText("Locked")).toBeNull();
    expect(
      document.querySelectorAll(".roster .open-seat[data-locked] svg")
    ).toHaveLength(MAX_PLAYERS - 3);
    expect(screen.queryByText("Waiting for players…")).toBeNull();
  });

  it("keeps the host's Bot speed control mounted when the first bot joins", () => {
    const [room, setRoom] = createSignal<RoomView>(roomOf(2));

    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={room()}
        playerId="p0"
        send={vi.fn<RoomConnection["send"]>()}
      />
    ));

    const botSpeed = screen.getByRole("radiogroup", { name: "Bot speed" });
    expect(
      within(botSpeed).getByRole("radio", { name: "Normal" })
    ).toBeChecked();

    setRoom(roomWithBot());
    flush();
    expect(screen.getByRole("radiogroup", { name: "Bot speed" })).toBe(
      botSpeed
    );
  });

  it("shows the host a disabled Start game that says what it's waiting for", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Lobby
        chat={chatControls()}
        typing={[]}
        room={roomOf(1)}
        playerId="p0"
        send={send}
      />
    ));

    const start = screen.getByRole("button", { name: "Start game" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription(
      "Add a bot or invite 1 more player."
    );
    fireEvent.click(start);
    expect(send).not.toHaveBeenCalled();
  });
});
