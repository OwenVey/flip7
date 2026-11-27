import { createAudio } from "@nkzw/audio";
import type { Audio, Sound as AudioSound } from "@nkzw/audio";
import { createLocalStorage, createPreference } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/solid/preferences";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";

import { listenForButtonSounds } from "./button-sounds";

const SOUND_VOLUMES = [
  ["bank", 0.7],
  ["bust", 0.85],
  ["deal", 0.5],
  ["error", 0.5],
  ["flipSeven", 0.9],
  ["flipThree", 0.65],
  ["freeze", 0.7],
  ["join", 0.5],
  ["leave", 0.4],
  ["lose", 0.7],
  ["message", 0.5],
  ["press", 0.3],
  ["release", 0.22],
  ["reveal", 0.5],
  ["round", 0.6],
  ["secondChance", 0.7],
  ["shuffle", 0.5],
  ["turn", 0.6],
  ["win", 0.9],
] as const;

type Sound = (typeof SOUND_VOLUMES)[number][0];

const PITCH_VARIED_CUES = new Set<Sound>([
  "deal",
  "press",
  "release",
  "reveal",
  "shuffle",
]);

const PITCH_DRIFT = 0.12;

const SOUND_VARIANTS: Partial<Record<Sound, number>> = { reveal: 4 };

const filesOf = (name: Sound) => {
  const count = SOUND_VARIANTS[name];

  return count === undefined
    ? [`/sounds/${name}.m4a`]
    : Array.from(
        { length: count },
        (_, index) => `/sounds/${name}-${index + 1}.m4a`
      );
};

/** Picks one of `count` recordings at random, never the one played last. */
export const pickVariant = (
  count: number,
  last: number | undefined,
  random = Math.random
) => {
  if (count < 2 || last === undefined) {
    return Math.floor(random() * count);
  }

  const offset = 1 + Math.floor(random() * (count - 1));

  return (last + offset) % count;
};

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

export const createRoomSounds = (
  createMixer: typeof createAudio = createAudio
) => {
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

  const [ready, setReady] = createSignal(false);

  let mixer: Audio | undefined;
  let track: AudioSound | undefined;
  let unlocked = false;
  let seated = false;
  let musicPlaying = false;
  const sounds = new Map<Sound, AudioSound[]>();
  const lastVariant = new Map<Sound, number>();

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

  const ensureMixer = (silent: boolean) => {
    if (mixer) {
      return mixer;
    }

    const audio = createMixer();
    mixer = audio;
    audio.mute(silent);
    track = audio.sound({
      loop: true,
      preload: false,
      src: ["/sounds/table-loop.m4a", "/sounds/table-loop.opus"],
    });
    track.once("unlock", () => {
      unlocked = true;
      syncMusic(musicVolume(), muted());
    });

    return audio;
  };

  const loadEffects = (silent: boolean, volume: number) => {
    if (sounds.size > 0) {
      return;
    }

    const audio = ensureMixer(silent);

    for (const [name, gain] of SOUND_VOLUMES) {
      sounds.set(
        name,
        filesOf(name).map((file) =>
          audio.sound({
            src: [file],
            volume: (volume / MAX_PERCENT) * gain,
          })
        )
      );
    }
  };

  createEffect(
    () => [ready(), muted(), effectsVolume(), musicVolume() > 0] as const,
    ([canLoad, silent, volume, hasMusic]) => {
      if (!canLoad || silent) {
        return;
      }

      if (volume > 0) {
        loadEffects(silent, volume);
      } else if (hasMusic) {
        ensureMixer(silent);
      }
    }
  );

  createEffect(muted, (silent) => {
    mixer?.mute(silent);

    if (silent) {
      for (const sound of [...sounds.values()].flat()) {
        sound.stop();
      }
    }
  });

  createEffect(effectsVolume, (volume) => {
    for (const [name, gain] of SOUND_VOLUMES) {
      for (const sound of sounds.get(name) ?? []) {
        sound.volume((volume / MAX_PERCENT) * gain);
      }
    }
  });

  onSettled(() => {
    const preloadTimer = setTimeout(() => {
      setReady(true);
    }, 0);

    const stopButtonSounds = listenForButtonSounds(document, (cue) => {
      play(cue);
    });

    return () => {
      clearTimeout(preloadTimer);
      setReady(false);
      stopButtonSounds();
      void mixer?.dispose();
      mixer = undefined;
      track = undefined;
      unlocked = false;
      musicPlaying = false;
      sounds.clear();
      lastVariant.clear();
    };
  });

  const effectsEnabled = () => !muted() && effectsVolume() > 0;

  const play = (cue: Sound, enabled = effectsEnabled()) => {
    const recordings = unlocked && enabled ? sounds.get(cue) : undefined;

    if (!recordings) {
      return;
    }

    const variant = pickVariant(recordings.length, lastVariant.get(cue));
    lastVariant.set(cue, variant);
    const sound = recordings[variant];
    const voice = sound?.play();

    if (
      sound &&
      voice !== null &&
      voice !== undefined &&
      PITCH_VARIED_CUES.has(cue)
    ) {
      sound.rate(1 + (Math.random() - 0.5) * PITCH_DRIFT, voice);
    }
  };

  return {
    changeEffectsVolume: setEffectsVolume,
    changeMusicVolume: setMusicVolume,
    effectsEnabled,
    effectsVolume,
    musicVolume,
    muted,
    play,
    setSeated: (joined: boolean, volume: number, silent: boolean) => {
      seated = joined;
      syncMusic(volume, silent);
    },
    toggle: () => {
      const next = !muted();
      mutedPreference.set(next ? "true" : "false");

      if (!next && effectsVolume() > 0) {
        loadEffects(false, effectsVolume());
        mixer?.mute(false);
        sounds.get("turn")?.[0]?.play();
      }
    },
  };
};
