import { createRoot, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { createRoomSounds, pickVariant } from "./room-sounds";

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

describe(pickVariant, () => {
  it("never repeats the recording played last", () => {
    const draws = [0, 0.3, 0.6, 0.99];

    expect(
      [0, 1, 2, 3].flatMap((last) =>
        draws.map((draw) => pickVariant(4, last, () => draw) === last)
      )
    ).not.toContain(true);
  });

  it("can reach every other recording and handles a single one", () => {
    const reached = new Set(
      [0, 0.4, 0.8].map((draw) => pickVariant(4, 2, () => draw))
    );

    expect({
      first: pickVariant(4, undefined, () => 0.99),
      reached: [...reached].toSorted((a, b) => a - b),
      single: pickVariant(1, 0, () => 0.5),
    }).toStrictEqual({ first: 3, reached: [0, 1, 3], single: 0 });
  });
});
