import { expectNoDiagnostics } from "@solidjs/diagnostics";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import type { LogEntry } from "../game/engine";
import { captureScenario } from "../test/diagnostics";
import GameLog from "./game-log";

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    at: 0,
    cue: "bank",
    game: 1,
    id: index + 1,
    round: 1,
    text: `Player ${index} stayed and banked ${index + 1} points.`,
  })) satisfies LogEntry[];

describe("<GameLog />", () => {
  afterEach(cleanup);

  it("tells spectators why they can't chat", () => {
    render(() => <GameLog log={entries(1)} playerId={null} />);

    expect(screen.queryByRole("textbox", { name: "Chat message" })).toBeNull();
    expect(screen.getByText("Join as a player to chat.")).toBeInTheDocument();
  });

  it("groups nearby chat by player and restarts after an event or a pause", () => {
    const own = { avatar: 1, id: "p0", name: "Owen" };
    const guest = { avatar: 2, id: "p1", name: "Ben" };
    const now = Date.now();

    const log = [
      { at: now, from: own, text: "Hello!" },
      { at: now + 1000, from: own, text: "Good luck!" },
      { at: now + 2000, from: guest, text: "You too!" },
      { at: now + 3000, text: "Room unlocked." },
      { at: now + 4000, from: guest, text: "Ready?" },
      { at: now + 64_000, from: guest, text: "Still here." },
    ].map((entry, index) => ({ ...entry, game: 1, id: index + 1, round: 1 }));

    render(() => <GameLog log={log} playerId={own.id} />);

    const bubbles = screen
      .getAllByRole("listitem")
      .filter((row) => row.dataset.kind === "chat");

    expect(
      bubbles.map((row) => ({
        continuation: Object.hasOwn(row.dataset, "continuation"),
        own: Object.hasOwn(row.dataset, "own"),
        author: row.querySelector("strong")?.textContent ?? null,
      }))
    ).toStrictEqual([
      { continuation: false, own: true, author: "Owen" },
      { continuation: true, own: true, author: null },
      { continuation: false, own: false, author: "Ben" },
      { continuation: false, own: false, author: "Ben" },
      { continuation: false, own: false, author: "Ben" },
    ]);
  });

  it("enables Send for a message and keeps the draft until a retry succeeds", () => {
    const [connected, setConnected] = createSignal(false);
    const sent: string[] = [];
    render(() => (
      <GameLog
        log={[]}
        playerId="p0"
        onChat={(text) => {
          if (!connected()) {
            return false;
          }

          sent.push(text);

          return true;
        }}
      />
    ));

    const draft = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Chat message",
    });

    const button = screen.getByRole("button", { name: "Send" });
    const feedback = screen.getByRole("status", { name: "" });
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.input(draft, { target: { value: "  " } });
    flush();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.input(draft, { target: { value: "  Good game! " } });
    flush();
    button.click();
    flush();
    expect({
      draft: draft.value,
      feedback: feedback.textContent,
      sent,
    }).toStrictEqual({
      draft: "  Good game! ",
      feedback: "Message not sent. Try again when reconnected.",
      sent: [],
    });

    setConnected(true);
    flush();
    button.click();
    flush();
    expect(draft).toHaveValue("");
    expect({
      disabled: button.getAttribute("aria-disabled"),
      feedback: feedback.textContent,
      sent,
    }).toStrictEqual({ disabled: "true", feedback: "", sent: ["Good game!"] });
  });

  it("keeps existing events quiet when a new snapshot repeats them", async () => {
    const [log, setLog] = createSignal(entries(2));

    render(() => <GameLog log={log()} playerId="p0" onChat={() => true} />);
    const first = screen.getByText("Player 0 stayed");

    const { artifact } = await captureScenario(() => {
      for (let count = 3; count <= 8; count += 1) {
        setLog(entries(count));
        flush();
      }
    }, "game-log-snapshots");

    expectNoDiagnostics(artifact);
    expect(screen.getByText("Player 0 stayed")).toBe(first);
    expect(screen.getByText("Player 7 stayed")).toBeInTheDocument();
  });
});
