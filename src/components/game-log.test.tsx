import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import type { LogEntry } from "../game/engine";
import GameLog from "./game-log";

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    cue: "bank",
    game: 1,
    id: index + 1,
    round: 1,
    text: `Player ${index} stayed and banked ${index + 1} points.`,
  })) satisfies LogEntry[];

describe("<GameLog />", () => {
  afterEach(cleanup);

  it("keeps existing events quiet when a new snapshot repeats them", async () => {
    const [log, setLog] = createSignal(entries(2));

    render(() => <GameLog log={log()} playerId="p0" onChat={() => true} />);
    const first = screen.getByText("Player 0 stayed");

    const { artifact } = await captureArtifact(
      () => {
        for (let count = 3; count <= 8; count += 1) {
          setLog(entries(count));
          flush();
        }
      },
      { scenario: "game-log-snapshots" }
    );

    expectNoDiagnostics(artifact);
    expect(screen.getByText("Player 0 stayed")).toBe(first);
    expect(screen.getByText("Player 7 stayed")).toBeInTheDocument();
  });
});
