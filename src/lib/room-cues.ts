import type { GameCue, LogEntry } from "../game/engine";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";

const GAME_CUE_PRIORITY = [
  "flipSeven",
  "bust",
  "freeze",
  "special",
  "bank",
  "join",
] as const satisfies readonly GameCue[];

export type RoomCue =
  | (typeof GAME_CUE_PRIORITY)[number]
  | "deal"
  | "message"
  | "reveal"
  | "round"
  | "turn"
  | "win";

const isChatFromOthers = (entry: LogEntry, playerId: string) =>
  entry.from !== undefined && entry.from.id !== playerId;

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
    return eventCue;
  }

  if (current.phase === "roundOver" && previous.phase !== "roundOver") {
    return "round";
  }

  if (roundStarted(previous, current)) {
    return "deal";
  }

  if (current.drawSeq > previous.drawSeq) {
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
  const cues: RoomCue[] = [];
  const cue = tableCue(previous, current, events);

  if (cue) {
    cues.push(cue);
  }

  if (events.some((entry) => isChatFromOthers(entry, playerId))) {
    cues.push("message");
  }

  return cues;
};
