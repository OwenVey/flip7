import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomView } from "../game/protocol";
import { createTableOpening } from "./table-motion";

type Phase = RoomView["phase"] | null;

const page = () => {
  const root = document.createElement("main");
  root.innerHTML = `
    <div class="seat" data-seat="b"></div>
    <div class="seat" data-seat="a" data-me=""></div>
  `;
  document.body.replaceChildren(root);

  const seat = root.querySelector(".seat[data-me]");

  if (!seat) {
    throw new Error("The page should have your seat.");
  }

  return { root, scroll: vi.spyOn(seat, "scrollIntoView") };
};

const play = (phases: Phase[]) => {
  const { root, scroll } = page();
  const show = createTableOpening(() => root);

  for (const phase of phases) {
    show(phase);
  }

  return scroll;
};

describe(createTableOpening, () => {
  beforeEach(() => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia; this player allows motion.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("jumps to your own seat when the table replaces the lobby", () => {
    const scroll = play(["lobby", "lobby", "playing"]);

    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      behavior: "auto",
      block: "nearest",
    });
  });

  it("jumps again when a new game starts from the lobby", () => {
    const scroll = play(["lobby", "playing", "gameOver", "lobby", "playing"]);

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Phase[]]>([
    ["later rounds", ["playing", "roundOver", "playing"]],
    ["loading a game under way", [null, "playing"]],
    ["rejoining a game under way", ["playing", null, "playing"]],
    ["staying in the lobby", [null, "lobby", "lobby"]],
  ])("leaves the scroll alone for %s", (_, phases) => {
    expect(play(phases)).not.toHaveBeenCalled();
  });
});
