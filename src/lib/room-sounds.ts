import { createAudio } from "@nkzw/audio";
import type { Audio, Sound as AudioSound } from "@nkzw/audio";
import { createLocalStorage, createPreference } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/solid/preferences";
import { createEffect, createMemo, onSettled } from "solid-js";

const SOUND_VOLUMES = [
  ["bank", 0.72],
  ["bust", 0.72],
  ["deal", 0.65],
  ["error", 0.65],
  ["flipSeven", 0.75],
  ["freeze", 0.65],
  ["join", 0.55],
  ["message", 0.6],
  ["reveal", 0.65],
  ["round", 0.65],
  ["special", 0.65],
  ["turn", 0.55],
  ["win", 0.75],
] as const;

type Sound = (typeof SOUND_VOLUMES)[number][0];

const MUTE_KEY = "flip7:sound-muted";
const MAX_PERCENT = 100;
const DEFAULT_MUSIC_VOLUME = 25;
const MUSIC_GAIN = 0.35;

const PERCENTS = Array.from({ length: MAX_PERCENT + 1 }, (_, percent) =>
  String(percent)
);

const savedVolume = (name: string, fallback: number) => {
  const preference = createPreference({
    attribute: `data-${name}`,
    defaultValue: String(fallback),
    storage: createLocalStorage(`flip7:${name}`),
    values: PERCENTS,
  });

  const state = usePreference(preference);

  return [
    createMemo(() => Number(state().value)),
    (volume: number) => {
      preference.set(String(volume));
    },
  ] as const;
};

export const createRoomSounds = () => {
  const mutedPreference = createPreference({
    attribute: "data-sound-muted",
    defaultValue: "false",
    storage: createLocalStorage(MUTE_KEY),
    values: ["false", "true"],
  });

  const mutedState = usePreference(mutedPreference);
  const muted = createMemo(() => mutedState().value === "true");

  const [effectsVolume, setEffectsVolume] = savedVolume(
    "effects-volume",
    MAX_PERCENT
  );

  const [musicVolume, setMusicVolume] = savedVolume(
    "music-volume",
    DEFAULT_MUSIC_VOLUME
  );

  let mixer: Audio | undefined;
  let track: AudioSound | undefined;
  let unlocked = false;
  let seated = false;
  let musicPlaying = false;
  const sounds = new Map<Sound, AudioSound>();

  const syncMusic = (volume: number, silent: boolean) => {
    if (!track) {
      return;
    }

    const shouldPlay = unlocked && seated && !silent && volume > 0;
    track.volume((volume / MAX_PERCENT) * MUSIC_GAIN);

    if (shouldPlay === musicPlaying) {
      return;
    }

    musicPlaying = shouldPlay;

    if (shouldPlay) {
      track.play();
    } else {
      track.pause();
    }
  };

  const preloadSounds = () => {
    const audio = createAudio();
    mixer = audio;
    audio.mute(muted());

    for (const [name, gain] of SOUND_VOLUMES) {
      sounds.set(
        name,
        audio.sound({
          src: [`/sounds/${name}.wav`],
          volume: (effectsVolume() / MAX_PERCENT) * gain,
        })
      );
    }

    track = audio.sound({
      loop: true,
      preload: false,
      src: ["/sounds/table-loop.m4a", "/sounds/table-loop.opus"],
    });

    sounds.get("turn")?.once("unlock", () => {
      unlocked = true;
      syncMusic(musicVolume(), muted());
    });
  };

  createEffect(muted, (silent) => {
    mixer?.mute(silent);

    if (silent) {
      for (const sound of sounds.values()) {
        sound.stop();
      }
    }
  });

  createEffect(effectsVolume, (volume) => {
    for (const [name, gain] of SOUND_VOLUMES) {
      sounds.get(name)?.volume((volume / MAX_PERCENT) * gain);
    }
  });

  onSettled(() => {
    const preloadTimer = setTimeout(preloadSounds, 0);

    return () => {
      clearTimeout(preloadTimer);
      void mixer?.dispose();
      mixer = undefined;
      track = undefined;
      sounds.clear();
    };
  });

  const effectsEnabled = () => !muted() && effectsVolume() > 0;

  return {
    changeEffectsVolume: setEffectsVolume,
    changeMusicVolume: setMusicVolume,
    effectsEnabled,
    effectsVolume,
    musicVolume,
    muted,
    play: (cue: Sound, enabled = effectsEnabled()) => {
      if (unlocked && enabled) {
        sounds.get(cue)?.play();
      }
    },
    setSeated: (joined: boolean, volume: number, silent: boolean) => {
      seated = joined;
      syncMusic(volume, silent);
    },
    toggle: () => {
      const next = !muted();
      mutedPreference.set(next ? "true" : "false");

      if (!next && effectsVolume() > 0) {
        mixer?.mute(false);
        sounds.get("turn")?.play();
      }
    },
  };
};
