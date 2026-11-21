import { createAudio } from "@nkzw/audio";
import type { Audio, Sound as AudioSound } from "@nkzw/audio";
import { makePersisted } from "@solid-primitives/storage";
import { createSignal, onSettled } from "solid-js";

import type { GameCue, LogEntry } from "../game/engine";
import { waitingOn } from "../game/moves";
import type { RoomView } from "../game/protocol";

const GAME_CUE_PRIORITY = [
  "streak",
  "bust",
  "freeze",
  "special",
  "bank",
  "join",
] as const satisfies readonly GameCue[];

const SOUND_VOLUMES = [
  ["bank", 0.72],
  ["bust", 0.72],
  ["deal", 0.65],
  ["error", 0.65],
  ["freeze", 0.65],
  ["join", 0.55],
  ["message", 0.6],
  ["reveal", 0.65],
  ["round", 0.65],
  ["special", 0.65],
  ["streak", 0.75],
  ["turn", 0.55],
  ["win", 0.75],
] as const;

type Sound = (typeof SOUND_VOLUMES)[number][0];

const MUTE_KEY = "hot-streak:sound-muted";
const EFFECTS_VOLUME_KEY = "hot-streak:effects-volume";
const MUSIC_VOLUME_KEY = "hot-streak:music-volume";
const MAX_PERCENT = 100;
const DEFAULT_MUSIC_VOLUME = 25;
const MUSIC_GAIN = 0.35;

const waitingOnId = (room: RoomView) => waitingOn(room)?.playerId ?? null;

const isChatFromOthers = (entry: LogEntry, playerId: string) =>
  entry.from !== undefined && entry.from.id !== playerId;

export const roundStarted = (previous: RoomView, current: RoomView) =>
  current.phase !== "lobby" &&
  (previous.phase === "lobby" || current.round !== previous.round);

const tableCue = (
  previous: RoomView,
  current: RoomView,
  events: LogEntry[]
) => {
  const eventCue = GAME_CUE_PRIORITY.find((cue) =>
    events.some((entry) => entry.cue === cue)
  );

  if (current.phase === "gameOver" && previous.phase !== "gameOver") {
    return "win";
  }

  if (eventCue) {
    return eventCue satisfies Sound;
  }

  if (current.phase === "roundOver" && previous.phase !== "roundOver") {
    return "round";
  }

  if (roundStarted(previous, current)) {
    return "deal";
  }

  if ((current.drawSeq ?? 0) > (previous.drawSeq ?? 0)) {
    return "reveal";
  }

  return null;
};

export const roomCues = (
  previous: RoomView,
  current: RoomView,
  playerId: string
) => {
  const lastId = previous.log.at(-1)?.id ?? 0;
  const events = current.log.filter((entry) => entry.id > lastId);
  const cues: Sound[] = [];
  const cue = tableCue(previous, current, events);

  if (cue) {
    cues.push(cue);
  }

  if (events.some((entry) => isChatFromOthers(entry, playerId))) {
    cues.push("message");
  }

  const newChoice =
    current.choice !== null &&
    current.choice.card.id !== previous.choice?.card.id;

  if (
    waitingOnId(current) === playerId &&
    (waitingOnId(previous) !== playerId ||
      newChoice ||
      roundStarted(previous, current))
  ) {
    cues.push("turn");
  }

  return cues;
};

const preferenceStorage = {
  getItem(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // WARNING: Browsers can deny preference writes even after a successful read.
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // WARNING: Browsers can deny storage removal in private sessions.
    }
  },
};

const persistedVolume = (name: string, fallback: number) =>
  makePersisted(createSignal(fallback, { ownedWrite: true }), {
    name,
    storage: preferenceStorage,
    deserialize: (stored) => {
      const volume = Number(stored);

      return Number.isInteger(volume) && volume >= 0 && volume <= MAX_PERCENT
        ? volume
        : fallback;
    },
  });

export const createRoomSounds = () => {
  const [muted, setMuted] = makePersisted(
    createSignal(false, { ownedWrite: true }),
    {
      name: MUTE_KEY,
      storage: preferenceStorage,
      deserialize: (stored) => stored === "true",
    }
  );

  const [effectsVolume, setEffectsVolume] = persistedVolume(
    EFFECTS_VOLUME_KEY,
    MAX_PERCENT
  );

  const [musicVolume, setMusicVolume] = persistedVolume(
    MUSIC_VOLUME_KEY,
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
    changeEffectsVolume: (volume: number) => {
      setEffectsVolume(volume);

      for (const [name, gain] of SOUND_VOLUMES) {
        sounds.get(name)?.volume((volume / MAX_PERCENT) * gain);
      }
    },
    changeMusicVolume: (volume: number) => {
      setMusicVolume(volume);
    },
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
      setMuted(next);
      mixer?.mute(next);

      if (next) {
        for (const sound of sounds.values()) {
          sound.stop();
        }
      } else if (effectsVolume() > 0) {
        sounds.get("turn")?.play();
      }
    },
  };
};
