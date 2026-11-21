import { createAudio } from "@nkzw/audio";
import type { Audio, Sound as AudioSound } from "@nkzw/audio";
import { createSignal, onSettled } from "solid-js";

import type { GameCue, LogEntry } from "../game/engine";
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

const waitingOn = (room: RoomView) =>
  room.phase === "playing" ? (room.choice?.chooserId ?? room.turnId) : null;

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
    waitingOn(current) === playerId &&
    (waitingOn(previous) !== playerId ||
      newChoice ||
      roundStarted(previous, current))
  ) {
    cues.push("turn");
  }

  return cues;
};

const readSetting = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const readVolume = (key: string, fallback: number) => {
  const stored = readSetting(key);
  const volume = stored === null ? fallback : Number(stored);

  return Number.isInteger(volume) && volume >= 0 && volume <= MAX_PERCENT
    ? volume
    : fallback;
};

const saveSetting = (key: string, value: boolean | number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // WARNING: Browser privacy settings can deny access to local storage.
  }
};

export const createRoomSounds = () => {
  const [muted, setMuted] = createSignal(false);
  const [effectsVolume, setEffectsVolume] = createSignal(MAX_PERCENT);
  const [musicVolume, setMusicVolume] = createSignal(DEFAULT_MUSIC_VOLUME);

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
    setMuted(readSetting(MUTE_KEY) === "true");
    setEffectsVolume(readVolume(EFFECTS_VOLUME_KEY, MAX_PERCENT));
    setMusicVolume(readVolume(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME));
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

      saveSetting(EFFECTS_VOLUME_KEY, volume);
    },
    changeMusicVolume: (volume: number) => {
      setMusicVolume(volume);
      saveSetting(MUSIC_VOLUME_KEY, volume);
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

      saveSetting(MUTE_KEY, next);
    },
  };
};
