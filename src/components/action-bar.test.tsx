import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomView } from "../game/protocol";
import { roundPointsFor } from "../lib/deal-playback";
import type { RoomConnection } from "../lib/room-connection";
import { chatControls } from "../test/chat";
import { room } from "../test/room-view";
import { Table } from "../test/table";
import ActionBar from "./action-bar";

const Bar = (props: {
  room: RoomView;
  playerId: string | null;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
  roundPoints?: ReadonlyMap<string, number>;
}) => (
  <ActionBar
    room={props.room}
    playerId={props.playerId}
    send={props.send}
    actionsDisabled={props.actionsDisabled}
    playback={{
      dealing: false,
      roundPoints: props.roundPoints ?? roundPointsFor(props.room),
      step: null,
    }}
  />
);

describe("<ActionBar />", () => {
  afterEach(cleanup);

  it("distinguishes an opening card from an ordinary hit", () => {
    const [hit, setHit] = createSignal<true | undefined>(undefined);

    render(() => (
      <Table
        room={room({ turnId: "b" })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        dealing
        dealStep={{
          card: { id: 2, kind: "number", value: 3 },
          flip: null,
          from: "deck",
          hit: hit(),
          partnerId: null,
          to: { kind: "hand", playerId: "b" },
        }}
      />
    ));

    expect(screen.getByText("Dealing to Ben…")).toBeVisible();
    setHit(true);
    flush();
    expect(screen.getByText("Ben hits…")).toBeVisible();
  });

  it("keeps the same Hit and Stay buttons while the prompt's points change", () => {
    const [points, setPoints] = createSignal(7);

    render(() => (
      <Bar
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        roundPoints={new Map([["a", points()]])}
      />
    ));

    const actionBar = within(screen.getByRole("region", { name: "Your move" }));
    const hit = actionBar.getByRole("button", { name: "Hit" });
    const stay = actionBar.getByRole("button", { name: "Stay" });

    expect(actionBar.getByText("7 points this round")).toBeVisible();

    setPoints(9);
    flush();

    expect(actionBar.getByText("9 points this round")).toBeVisible();
    expect(actionBar.getByRole("button", { name: "Hit" })).toBe(hit);
    expect(actionBar.getByRole("button", { name: "Stay" })).toBe(stay);
  });

  it("keeps your Hit pending until the room confirms it", async () => {
    const confirmed = Promise.withResolvers<boolean>();
    const sent: Parameters<RoomConnection["send"]>[0][] = [];

    const send: RoomConnection["send"] = async (command) => {
      sent.push(command);

      return await confirmed.promise;
    };

    render(() => <Bar room={room()} playerId="a" send={send} />);

    const hit = screen.getByRole("button", { name: "Hit" });
    hit.click();
    flush();

    expect(sent).toStrictEqual([{ type: "hit" }]);
    expect(hit).toHaveAttribute("data-pending");

    confirmed.resolve(true);
    await vi.waitFor(() => {
      expect(hit).not.toHaveAttribute("data-pending");
    });
  });

  it("keeps the same Hit and Stay buttons for an offline player while their points change", () => {
    const [points, setPoints] = createSignal(7);
    const view = room({ turnId: "b" });
    view.players = view.players.map((player) =>
      player.id === "b" ? { ...player, connected: false } : player
    );

    render(() => (
      <Bar
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        roundPoints={new Map([["b", points()]])}
      />
    ));

    const actionBar = within(
      screen.getByRole("region", { name: "Game status" })
    );

    const hit = actionBar.getByRole("button", { name: "Hit for Ben" });

    const stay = actionBar.getByRole("button", {
      name: "Stay for Ben with 7 points",
    });

    setPoints(9);
    flush();

    expect(actionBar.getByRole("button", { name: "Hit for Ben" })).toBe(hit);
    expect(
      actionBar.getByRole("button", { name: "Stay for Ben with 9 points" })
    ).toBe(stay);
  });

  it("waits for the host to start the next round", () => {
    vi.useFakeTimers();

    try {
      const send = vi.fn<RoomConnection["send"]>();
      render(() => (
        <Bar room={room({ phase: "roundOver" })} playerId="a" send={send} />
      ));
      vi.advanceTimersByTime(60_000);
      expect(send).not.toHaveBeenCalled();

      screen.getByRole("button", { name: "Start next round" }).click();
      expect(send).toHaveBeenCalledExactlyOnceWith({ type: "nextRound" });
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("lets the host play again from the action bar once the game is over", () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Bar
        room={room({ phase: "gameOver", winnerIds: ["b"] })}
        playerId="a"
        send={send}
      />
    ));

    const actionBar = within(
      screen.getByRole("region", { name: "Game status" })
    );

    fireEvent.click(actionBar.getByRole("button", { name: "Play again" }));

    expect(send).toHaveBeenCalledWith({ type: "start" });
  });

  it("pauses moves while the room is syncing and resumes once it is ready", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const [syncing, setSyncing] = createSignal(true);
    render(() => (
      <Bar room={room()} playerId="a" send={send} actionsDisabled={syncing()} />
    ));

    const hit = screen.getByRole("button", { name: "Hit" });
    const stay = screen.getByRole("button", { name: "Stay" });
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

  it("labels the action bar as your move only when it is yours", () => {
    const [view, setView] = createSignal(room());

    render(() => (
      <Bar room={view()} playerId="a" send={vi.fn<RoomConnection["send"]>()} />
    ));
    expect(screen.getByRole("region", { name: "Your move" })).toBeVisible();

    setView(room({ turnId: "b" }));
    flush();
    expect(screen.getByRole("region", { name: "Game status" })).toBeVisible();

    setView(
      room({
        choice: {
          card: { id: 9, kind: "freeze" as const },
          chooserId: "a",
          options: ["a", "b"],
        },
      })
    );
    flush();
    expect(screen.getByRole("region", { name: "Your move" })).toBeVisible();
  });

  it("lets the host move for an offline player whose turn it is", () => {
    const send = vi.fn<RoomConnection["send"]>();
    const view = room({ turnId: "b" });
    view.players = view.players.map((seat) =>
      seat.id === "b" ? { ...seat, connected: false } : seat
    );

    render(() => <Bar room={view} playerId="a" send={send} />);
    expect(
      screen.getByText(/Play for them, or the game will Stay soon/u)
    ).toBeVisible();
    screen.getByRole("button", { name: "Hit for Ben" }).click();
    flush();
    expect(send).toHaveBeenCalledWith({ forId: "b", type: "hit" });
    screen.getByRole("button", { name: "Stay for Ben with 3 points" }).click();
    flush();
    expect(send).toHaveBeenCalledWith({ forId: "b", type: "stay" });
    cleanup();

    render(() => (
      <Bar room={{ ...view, hostId: "b" }} playerId="a" send={send} />
    ));
    expect(screen.queryByRole("button", { name: "Hit for Ben" })).toBeNull();
  });
});
