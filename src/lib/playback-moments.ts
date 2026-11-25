import type { GameEvent } from "../game/game-events";
import type { RoomView } from "../game/protocol";
import type { RoomCue } from "./room-cues";

/** A key result Deal playback holds on the table before play moves on. */
export type PlaybackMoment =
  | { kind: "reshuffle" }
  | { kind: "flipSeven"; playerId: string }
  | { kind: "bust"; playerId: string }
  | { kind: "freeze"; playerId: string; byId: string | null }
  | { kind: "stay"; playerId: string; points: number }
  | { kind: "saved"; playerId: string }
  | { kind: "secondChanceGiven"; playerId: string }
  | { kind: "outOfCards" };

/** A moment to show, the sound it plays and how long it holds. */
export interface MomentSettle {
  cue: RoomCue | null;
  duration: number;
  moment: PlaybackMoment;
}

const FLIP_SEVEN_SETTLE_MS = 1400;
const BUST_SETTLE_MS = 640;
const FREEZE_SETTLE_MS = 520;
export const SAVE_SETTLE_MS = 450;
const STAY_SETTLE_MS = 460;
const GIFT_SETTLE_MS = 320;
const OUT_OF_CARDS_SETTLE_MS = 500;

export const bustSettle = (playerId: string) =>
  ({
    cue: "bust",
    duration: BUST_SETTLE_MS,
    moment: { kind: "bust", playerId },
  }) satisfies MomentSettle;

export const freezeSettle = (playerId: string, byId: string | null) =>
  ({
    cue: "freeze",
    duration: FREEZE_SETTLE_MS,
    moment: { byId, kind: "freeze", playerId },
  }) satisfies MomentSettle;

const STEP_EVENTS = ["bust", "flipThree", "freeze", "secondChance"] as const;

/** An event whose sound plays as its card lands, during the deal. */
type StepEvent = (typeof STEP_EVENTS)[number];

type StepEventCounts = Record<StepEvent, number>;

const STEP_EVENT_OF: Partial<Record<GameEvent["type"], StepEvent>> = {
  busted: "bust",
  flipThreeStarted: "flipThree",
  frozen: "freeze",
  secondChanceUsed: "secondChance",
};

const isStepEvent = (cue: RoomCue): cue is StepEvent =>
  STEP_EVENTS.some((event) => event === cue);

/** What one Room update's events hold, and which of their sounds have played. */
export interface TransitionTracker {
  counts: StepEventCounts;
  events: readonly GameEvent[];
  played: StepEventCounts;
  reshuffled: boolean;
}

const noStepEvents = () =>
  ({
    bust: 0,
    flipThree: 0,
    freeze: 0,
    secondChance: 0,
  }) satisfies StepEventCounts;

export const trackTransition = (events: readonly GameEvent[]) => {
  const counts = noStepEvents();

  for (const event of events) {
    const stepEvent = STEP_EVENT_OF[event.type];

    if (stepEvent !== undefined) {
      counts[stepEvent] += 1;
    }
  }

  return {
    counts,
    events,
    played: noStepEvents(),
    reshuffled: false,
  } satisfies TransitionTracker;
};

const unplayed = (tracker: TransitionTracker, event: StepEvent) =>
  tracker.played[event] < tracker.counts[event];

/** True when the deal already played this sound for every event that calls for it. */
export const cueAlreadyPlayed = (
  sound: RoomCue,
  tracker: TransitionTracker,
  hasSteps: boolean
) => {
  if (hasSteps && (sound === "deal" || sound === "reveal")) {
    return true;
  }

  if (sound === "shuffle") {
    return tracker.reshuffled;
  }

  return (
    isStepEvent(sound) && tracker.played[sound] > 0 && !unplayed(tracker, sound)
  );
};

/**
 * The moment to hold once a Room update's cards have landed, or null when
 * nothing needs to settle. Mid-batch busts, freezes and saves already settled
 * as their cards landed, so they only count here when one is still unplayed.
 */
export const trailingSettle = (
  tracker: TransitionTracker,
  current: RoomView,
  hasSteps: boolean
) => {
  const { events } = tracker;
  const flipSeven = events.findLast((event) => event.type === "flipSeven");

  if (flipSeven) {
    return {
      cue: "flipSeven",
      duration: FLIP_SEVEN_SETTLE_MS,
      moment: { kind: "flipSeven", playerId: flipSeven.player.id },
    } satisfies MomentSettle;
  }

  const busted = events.findLast((event) => event.type === "busted");

  if (busted && unplayed(tracker, "bust")) {
    return bustSettle(busted.player.id);
  }

  const frozen = events.findLast((event) => event.type === "frozen");

  if (frozen && unplayed(tracker, "freeze")) {
    return freezeSettle(frozen.target.id, frozen.by?.id ?? null);
  }

  const saved = events.findLast((event) => event.type === "secondChanceUsed");

  if (saved && unplayed(tracker, "secondChance")) {
    return {
      cue: "secondChance",
      duration: SAVE_SETTLE_MS,
      moment: { kind: "saved", playerId: saved.player.id },
    } satisfies MomentSettle;
  }

  const stayed = events.findLast((event) => event.type === "stayed");

  if (stayed) {
    return {
      cue: "bank",
      duration: STAY_SETTLE_MS,
      moment: {
        kind: "stay",
        playerId: stayed.player.id,
        points: stayed.points,
      },
    } satisfies MomentSettle;
  }

  const gifted = events.findLast((event) => event.type === "secondChanceGiven");

  if (gifted) {
    return {
      cue: hasSteps ? null : "reveal",
      duration: GIFT_SETTLE_MS,
      moment: { kind: "secondChanceGiven", playerId: gifted.target.id },
    } satisfies MomentSettle;
  }

  const emptied = events.some((event) => event.type === "outOfCards");

  if (
    emptied &&
    (current.phase === "roundOver" || current.phase === "gameOver")
  ) {
    return {
      cue: current.phase === "roundOver" ? "round" : null,
      duration: OUT_OF_CARDS_SETTLE_MS,
      moment: { kind: "outOfCards" },
    } satisfies MomentSettle;
  }

  return null;
};
