import { createAudio } from "@nkzw/audio";
import type { Audio, Sound as AudioSound } from "@nkzw/audio";
import { createLocalStorage, createPreference } from "@ui-sdk/core";
import { usePreference } from "@ui-sdk/solid/preferences";
import { createEffect, createMemo, onSettled } from "solid-js";

type Take = readonly [startMs: number, lengthMs: number];

const TAKES = {
  bank: [
    [200, 192],
    [512, 190],
    [823, 273],
    [1216, 213],
    [1549, 208],
  ],
  bust: [
    [200, 640],
    [960, 640],
    [1720, 640],
  ],
  deal: [
    [200, 798],
    [1118, 880],
  ],
  error: [
    [200, 554],
    [874, 488],
    [1482, 493],
    [2096, 461],
  ],
  flipSeven: [[200, 974]],
  freeze: [
    [200, 334],
    [654, 322],
    [1096, 366],
    [1582, 327],
  ],
  join: [
    [200, 335],
    [655, 359],
    [1135, 366],
    [1621, 384],
  ],
  message: [
    [200, 323],
    [643, 332],
    [1095, 314],
    [1529, 325],
  ],
  reveal: [
    [200, 320],
    [640, 320],
  ],
  round: [
    [200, 661],
    [981, 675],
    [1776, 680],
  ],
  special: [
    [200, 500],
    [820, 500],
    [1440, 500],
    [2060, 500],
  ],
  turn: [[200, 364]],
  win: [[200, 1075]],
} as const satisfies Record<string, readonly Take[]>;

const TAP_TAKES = [
  [
    [200, 108],
    [428, 107],
  ],
  [
    [655, 112],
    [887, 116],
  ],
  [
    [1123, 124],
    [1367, 121],
  ],
  [
    [1608, 138],
    [1866, 103],
  ],
  [
    [2089, 102],
    [2311, 99],
  ],
] as const satisfies readonly (readonly [press: Take, release: Take])[];

type Sound = keyof typeof TAKES;

const CUES = Object.keys(TAKES).filter((key): key is Sound => key in TAKES);

const EFFECTS_GAIN = 0.8;

const MAX_PITCH_SHIFT = 0.05;
const TAP_SELECTOR = "[data-game-tap]:not(:disabled):not([aria-disabled=true])";

/** Picks a take other than the last one played (-1 for none), when there is a choice. */
export const nextTake = (count: number, last: number, random = Math.random) => {
  if (last < 0 || count < 2) {
    return Math.floor(random() * count);
  }

  const take = Math.floor(random() * (count - 1));

  return take >= last ? take + 1 : take;
};

const spritesOf = (takes: readonly Take[], prefix = "") =>
  Object.fromEntries(takes.map((take, index) => [`${prefix}${index}`, take]));

const playSprite = (sound: AudioSound | undefined, sprite: string) => {
  const id = sound?.play(sprite);

  if (id !== null && id !== undefined) {
    sound?.rate(1 + (Math.random() * 2 - 1) * MAX_PITCH_SHIFT, id);
  }
};

const sources = (name: string) => [
  `/sounds/${name}.m4a`,
  `/sounds/${name}.opus`,
];

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
  let tap: AudioSound | undefined;
  let pressedTake = -1;
  const sounds = new Map<Sound, AudioSound>();
  const lastTakes = new Map<Sound | "tap", number>();

  const effectsGain = () => (effectsVolume() / MAX_PERCENT) * EFFECTS_GAIN;

  const pickTake = (cue: Sound | "tap", count: number) => {
    const take = nextTake(count, lastTakes.get(cue) ?? -1);
    lastTakes.set(cue, take);

    return take;
  };

  const playCue = (cue: Sound) => {
    playSprite(sounds.get(cue), String(pickTake(cue, TAKES[cue].length)));
  };

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

    for (const cue of CUES) {
      sounds.set(
        cue,
        audio.sound({
          sprite: spritesOf(TAKES[cue]),
          src: sources(cue),
          volume: effectsGain(),
        })
      );
    }

    tap = audio.sound({
      sprite: {
        ...spritesOf(
          TAP_TAKES.map(([press]) => press),
          "press"
        ),
        ...spritesOf(
          TAP_TAKES.map(([, release]) => release),
          "release"
        ),
      },
      src: sources("tap"),
      volume: effectsGain(),
    });

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

      tap?.stop();
    }
  });

  createEffect(effectsGain, (gain) => {
    for (const sound of sounds.values()) {
      sound.volume(gain);
    }

    tap?.volume(gain);
  });

  const effectsEnabled = () => !muted() && effectsVolume() > 0;
  const canPlay = () => unlocked && effectsEnabled();

  const press = (event: PointerEvent) => {
    if (
      event.button === 0 &&
      event.target instanceof Element &&
      event.target.closest(TAP_SELECTOR) &&
      canPlay()
    ) {
      pressedTake = pickTake("tap", TAP_TAKES.length);
      playSprite(tap, `press${pressedTake}`);
    }
  };

  const release = () => {
    if (pressedTake >= 0 && canPlay()) {
      playSprite(tap, `release${pressedTake}`);
    }

    pressedTake = -1;
  };

  const keyPress = (event: MouseEvent) => {
    if (
      event.detail === 0 &&
      event.target instanceof Element &&
      event.target.closest(TAP_SELECTOR) &&
      canPlay()
    ) {
      playSprite(tap, `press${pickTake("tap", TAP_TAKES.length)}`);
    }
  };

  onSettled(() => {
    const preloadTimer = setTimeout(preloadSounds, 0);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("click", keyPress, true);

    return () => {
      clearTimeout(preloadTimer);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("click", keyPress, true);
      void mixer?.dispose();
      mixer = undefined;
      track = undefined;
      tap = undefined;
      sounds.clear();
    };
  });

  return {
    changeEffectsVolume: setEffectsVolume,
    changeMusicVolume: setMusicVolume,
    effectsEnabled,
    effectsVolume,
    musicVolume,
    muted,
    play: (cue: Sound, enabled = effectsEnabled()) => {
      if (unlocked && enabled) {
        playCue(cue);
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
        playCue("turn");
      }
    },
  };
};
