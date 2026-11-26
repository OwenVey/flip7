import { describe, expect, it } from "vitest";

import { LOG_LIMIT, MAX_PLAYERS } from "../game/engine";
import { DATASETS, PHASES, stressRoom } from "./stress-rooms";

describe("stress rooms", () => {
  it.each(
    DATASETS.flatMap((dataset) =>
      PHASES.map((phase) => [dataset, phase] as const)
    )
  )("builds the %s data at %s", (dataset, phase) => {
    const { room, playerId } = stressRoom(dataset, phase, "player");

    expect(room.phase).toBe(phase);
    expect(room.players.some(({ id }) => id === playerId)).toBeTruthy();
  });

  it("fills the room and its log to the limits", () => {
    const { room } = stressRoom("full", "playing", "player");

    expect(room.players).toHaveLength(MAX_PLAYERS);
    expect(room.log).toHaveLength(LOG_LIMIT);
  });

  it("puts the viewer on the move mid-round", () => {
    const { room, playerId } = stressRoom("worst", "playing", "player");

    expect(room.turnId).toBe(playerId);
  });
});
