import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PLAYERS } from "../game/engine";
import type { RoomView } from "../game/protocol";
import JoinForm from "./join-form";

const roomWith = (names: string[], avatar = 1) => {
  const view: Pick<RoomView, "phase" | "players"> = {
    phase: "lobby",
    players: names.map((name, index) => ({
      avatar,
      bot: false,
      bustCard: null,
      connected: true,
      hand: [],
      id: String(index),
      lastRound: null,
      name,
      score: 0,
      status: "out",
    })),
  };

  // SAFETY: JoinForm reads only the phase and players.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- A partial room is enough here.
  return view as RoomView;
};

describe("<JoinForm />", () => {
  afterEach(cleanup);

  it("drops the saved name once the room shows someone already has it", () => {
    const [room, setRoom] = createSignal<RoomView | null>(null);

    render(() => (
      <JoinForm
        room={room()}
        savedName="Ben"
        savedAvatar={1}
        onJoin={vi.fn<(name: string) => void>()}
      />
    ));
    const input = screen.getByRole("textbox", { name: "Your name" });
    expect(input).toHaveValue("Ben");

    setRoom(roomWith(["Ana", "ben"]));
    flush();
    expect(input).toHaveValue("");
  });

  it("keeps what the player typed when the room arrives", () => {
    const [room, setRoom] = createSignal<RoomView | null>(null);

    render(() => (
      <JoinForm
        room={room()}
        savedName="Ben"
        savedAvatar={1}
        onJoin={vi.fn<(name: string) => void>()}
      />
    ));
    const input = screen.getByRole("textbox", { name: "Your name" });
    input.focus();
    // SAFETY: the textbox role only matches input elements here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getByRole returns HTMLElement.
    (input as HTMLInputElement).value = "Cal";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    setRoom(roomWith(["Ben"]));
    flush();
    expect(input).toHaveValue("Cal");
  });

  it("shows a full room before asking for a name", () => {
    const room = roomWith(
      Array.from({ length: MAX_PLAYERS }, (_, index) => `Player ${index + 1}`)
    );

    render(() => (
      <JoinForm
        room={room}
        savedName=""
        savedAvatar={1}
        onJoin={vi.fn<(name: string) => void>()}
      />
    ));

    expect(screen.getByRole("status")).toHaveTextContent("This room is full");
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
  });

  it("tells players whether they will join the next round or the next game", () => {
    const [phase, setPhase] = createSignal<RoomView["phase"]>("playing");
    const room = roomWith(["Ana"]);

    render(() => (
      <JoinForm
        room={{ ...room, phase: phase() }}
        savedName=""
        savedAvatar={1}
        onJoin={vi.fn<(name: string) => void>()}
      />
    ));

    expect(
      screen.getByText("A game is in progress. You'll be dealt in next round.")
    ).toBeVisible();

    setPhase("gameOver");
    flush();

    expect(screen.getByText("You'll play in the next game.")).toBeVisible();
  });

  it("keeps the name and shows the rejection at the field", () => {
    const [joining, setJoining] = createSignal(false);
    const [error, setError] = createSignal("");
    const room = roomWith(["Ana"]);
    let submittedName = "";

    const onJoin = (name: string) => {
      submittedName = name;
      setJoining(true);
    };

    render(() => (
      <JoinForm
        room={room}
        savedName="Ben"
        savedAvatar={1}
        onJoin={onJoin}
        joining={joining()}
        error={error()}
      />
    ));
    const name = screen.getByRole("textbox", { name: "Your name" });
    screen.getByRole("button", { name: "Join room" }).click();
    flush();

    expect(submittedName).toBe("Ben");
    expect(screen.getByRole("button", { name: "Joining…" })).toBeDisabled();

    setJoining(false);
    setError("Someone here is already called Ben.");
    flush();

    expect(name).toHaveValue("Ben");
    expect(name).toHaveAccessibleDescription(
      /Someone here is already called Ben/u
    );
    expect(screen.getByRole("button", { name: "Join room" })).toBeEnabled();
  });

  it("joins with the avatar picked from the grid", async () => {
    const onJoin = vi.fn<(name: string, avatar: number) => void>();

    render(() => (
      <JoinForm
        room={roomWith(["Ana"])}
        savedName="Ben"
        savedAvatar={1}
        onJoin={onJoin}
      />
    ));
    screen.getByRole("button", { name: "Change avatar" }).click();
    flush();

    const fifth = await screen.findByRole("radio", {
      name: "Pink pentagon on yellow",
    });

    fifth.click();
    flush();
    screen.getByRole("button", { name: "Join room" }).click();
    flush();

    expect(onJoin).toHaveBeenCalledWith("Ben", 5);
  });

  it.each(["Enter", " "])(
    "confirms an avatar with %j without submitting the join form",
    async (key) => {
      const onJoin = vi.fn<(name: string, avatar: number) => void>();
      render(() => (
        <JoinForm
          room={roomWith([])}
          savedName="Ben"
          savedAvatar={1}
          onJoin={onJoin}
        />
      ));
      const trigger = screen.getByRole("button", { name: "Change avatar" });
      trigger.click();
      flush();

      const grid = within(
        screen.getByRole("radiogroup", { name: "Choose an avatar" })
      );

      const first = grid.getByRole("radio", {
        name: "Pink circle on yellow",
      });

      const second = grid.getByRole("radio", { name: "Green egg on yellow" });

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight" });
      flush();
      expect(second).toHaveAttribute("aria-checked", "true");

      expect(fireEvent.keyDown(second, { key })).toBeFalsy();
      flush();
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
      expect(onJoin).not.toHaveBeenCalled();

      screen.getByRole("button", { name: "Join room" }).click();
      expect(onJoin).toHaveBeenCalledWith("Ben", 2);
    }
  );

  it("keeps the suggested avatar when its tile is clicked", () => {
    const onJoin = vi.fn<(name: string, avatar: number) => void>();
    const [room, setRoom] = createSignal(roomWith([]));

    render(() => (
      <JoinForm
        room={room()}
        savedName="Ben"
        savedAvatar={null}
        onJoin={onJoin}
      />
    ));

    const trigger = screen.getByRole("button", { name: "Change avatar" });

    trigger.click();
    flush();

    const suggested = screen.getByRole("radio", { checked: true });
    const avatar = screen.getAllByRole("radio").indexOf(suggested) + 1;

    suggested.click();
    flush();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onJoin).not.toHaveBeenCalled();

    setRoom(roomWith(["Ana"], avatar));
    flush();
    screen.getByRole("button", { name: "Join room" }).click();
    expect(onJoin).toHaveBeenCalledWith("Ben", avatar);
  });
});
