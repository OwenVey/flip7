import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomView } from "../game/protocol";
import JoinForm from "./join-form";

const roomWith = (names: string[]) => {
  const view: Pick<RoomView, "phase" | "players"> = {
    phase: "lobby",
    players: names.map((name, index) => ({
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
});
