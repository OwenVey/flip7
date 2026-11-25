import { access } from "node:fs/promises";
import path from "node:path";

import { createRoot, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { createRoomSounds, nextTake } from "./room-sounds";

const CUES = [
  "bank",
  "bust",
  "deal",
  "error",
  "flipSeven",
  "freeze",
  "join",
  "message",
  "reveal",
  "round",
  "special",
  "turn",
  "win",
];

const KEYS = [
  "flip7:sound-muted",
  "flip7:effects-volume",
  "flip7:music-volume",
];

const setup = () =>
  createRoot((dispose) => {
    const sounds = createRoomSounds();
    flush();

    return { ...sounds, dispose };
  });

describe(createRoomSounds, () => {
  afterEach(() => {
    for (const key of KEYS) {
      localStorage.removeItem(key);
    }
  });

  it("restores saved settings and ignores ones out of range", () => {
    localStorage.setItem("flip7:sound-muted", "true");
    localStorage.setItem("flip7:effects-volume", "40");
    localStorage.setItem("flip7:music-volume", "250");
    const sounds = setup();

    expect({
      effects: sounds.effectsVolume(),
      music: sounds.musicVolume(),
      muted: sounds.muted(),
    }).toStrictEqual({ effects: 40, music: 25, muted: true });
    sounds.dispose();
  });

  it("saves changes and shares them with another view of the room", () => {
    const first = setup();
    const second = setup();

    first.toggle();
    first.changeEffectsVolume(60);
    first.changeMusicVolume(0);
    flush();

    expect({
      effects: second.effectsVolume(),
      music: second.musicVolume(),
      muted: second.muted(),
      saved: KEYS.map((key) => localStorage.getItem(key)),
    }).toStrictEqual({
      effects: 60,
      music: 0,
      muted: true,
      saved: ["true", "60", "0"],
    });
    first.dispose();
    second.dispose();
  });
});

describe(nextTake, () => {
  it("never repeats the take just played when there is another", () => {
    const picks = [0, 0.6, 0.99].map((roll) => nextTake(3, 1, () => roll));

    expect(picks).toStrictEqual([0, 2, 2]);
  });

  it("picks any take first, and the only take when there is one", () => {
    expect([
      nextTake(3, -1, () => 0),
      nextTake(3, -1, () => 0.99),
      nextTake(1, 0),
    ]).toStrictEqual([0, 2, 0]);
  });
});

describe("sound files", () => {
  it("ships each cue and the button tap in both formats", async () => {
    const folder = path.resolve(import.meta.dirname, "../../public/sounds");

    const files = [...CUES, "tap"].flatMap((name) => [
      `${name}.m4a`,
      `${name}.opus`,
    ]);

    await expect(
      Promise.all(
        files.map(async (file) => {
          await access(path.join(folder, file));
        })
      )
    ).resolves.toBeDefined();
  });
});
