import { createRoot, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import { createRoomSounds } from "./room-sounds";

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
