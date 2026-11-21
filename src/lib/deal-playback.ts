/* oxlint-disable eslint/no-await-in-loop -- Card flights and Room updates must play in order. */

import { waitingOn } from "../game/moves";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { roomCues } from "./room-cues";
import type { RoomCue } from "./room-cues";

const FLIGHT_MS = 460;
const FLIP_FLIGHT_MS = 560;
const HURRIED_FLIGHT_MS = 220;
const PAUSE_MS = 70;
const FLIP_PAUSE_MS = 260;
const FLIP_LEAD_IN_MS = 320;

export interface DealMotion {
  allowed: () => boolean;
  captureFlight: (
    step: DealStep,
    duration: number
  ) => ((signal: AbortSignal) => Promise<void>) | null;
  land: (step: DealStep, signal: AbortSignal) => Promise<void>;
  reshuffle: () => void;
  sweep: (signal: AbortSignal) => Promise<void>;
}

interface PlaybackInput {
  canAct: boolean;
  playerId: string;
  room: RoomView;
}

interface Frame {
  dealing: boolean;
  incomingCardId: number | null;
  room: RoomView | null;
  step: DealStep | null;
}

export interface DealPlaybackView extends Frame {
  actionsDisabled: boolean;
  myMove: boolean;
}

const emptyFrame: Frame = {
  dealing: false,
  incomingCardId: null,
  room: null,
  step: null,
};

export const initialDealPlayback: DealPlaybackView = {
  ...emptyFrame,
  actionsDisabled: true,
  myMove: false,
};

const wait = async (ms: number, signal: AbortSignal) => {
  if (ms === 0 || signal.aborted) {
    return;
  }

  const { promise, resolve } = Promise.withResolvers<undefined>();

  const done = () => {
    resolve(undefined);
  };

  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
  await promise;

  clearTimeout(timer);
  signal.removeEventListener("abort", done);
};

const flightTime = (step: DealStep, hurry: boolean) => {
  if (hurry) {
    return HURRIED_FLIGHT_MS;
  }

  return step.flip ? FLIP_FLIGHT_MS : FLIGHT_MS;
};

const pauseAfter = (step: DealStep, hurry: boolean) => {
  if (hurry) {
    return 0;
  }

  return step.flip ? FLIP_PAUSE_MS : PAUSE_MS;
};

const ownMove = ({ room, playerId }: PlaybackInput) => {
  if (waitingOn(room)?.playerId !== playerId) {
    return null;
  }

  if (room.choice) {
    return `${room.round}:choice:${room.choice.card.id}`;
  }

  return `${room.round}:turn:${room.drawSeq}`;
};

const reshuffled = (previous: RoomView, current: RoomView) =>
  current.round === previous.round &&
  current.deckCount > previous.deckCount &&
  current.discardCount < previous.discardCount;

export const createDealPlayback = (
  motion: DealMotion,
  publish: (view: DealPlaybackView) => void,
  cue: (cue: RoomCue) => void
) => {
  const queue: RoomView[] = [];
  let latest: PlaybackInput | null = null;
  let settled: RoomView | null = null;
  let run: AbortController | null = null;
  let frame = emptyFrame;
  let moveCuePending = false;

  const show = (patch: Partial<Frame> = {}, sounds: RoomCue[] = []) => {
    frame = { ...frame, ...patch };

    const actionsDisabled = run !== null || latest?.canAct !== true;

    const myMove =
      !actionsDisabled && latest !== null && ownMove(latest) !== null;

    publish({ ...frame, actionsDisabled, myMove });

    for (const sound of sounds) {
      cue(sound);
    }

    if (myMove && moveCuePending) {
      moveCuePending = false;
      cue("turn");
    }
  };

  const playSteps = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    signal: AbortSignal
  ) => {
    for (const [index, step] of steps.entries()) {
      if (signal.aborted) {
        return;
      }

      const hurry = queue.length > 0;
      const announced = index > 0 && steps.at(index - 1)?.to.kind === "played";

      if (step.flip?.index === 1 && !hurry && !announced) {
        show({ step: { ...step, flip: { ...step.flip, index: 0 } } });
        await wait(FLIP_LEAD_IN_MS, signal);
      }

      if (signal.aborted) {
        return;
      }

      const fly = motion.captureFlight(step, flightTime(step, hurry));
      show({
        incomingCardId: step.card.id,
        room: dealFrame(previous, current, steps, index + 1),
        step,
      });
      await fly?.(signal);

      if (signal.aborted) {
        return;
      }

      show({ incomingCardId: null });
      cue("reveal");
      await motion.land(step, signal);
      await wait(pauseAfter(step, hurry), signal);
    }
  };

  const playTransition = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    signal: AbortSignal
  ) => {
    show({ dealing: true });
    const newRound = roundStarted(previous, current);

    if (newRound) {
      cue("deal");
    }

    if (newRound && previous.phase !== "lobby" && queue.length === 0) {
      await motion.sweep(signal);
    }

    await playSteps(previous, current, steps, signal);
  };

  const drain = async (signal: AbortSignal) => {
    for (let current = queue.shift(); current; current = queue.shift()) {
      const previous = settled;
      settled = current;
      let sounds: RoomCue[] = [];

      if (previous && latest) {
        const animate = motion.allowed();
        const steps = animate ? planDeal(previous, current) : [];

        if (animate && reshuffled(previous, current)) {
          motion.reshuffle();
        }

        if (steps.length > 0) {
          await playTransition(previous, current, steps, signal);
        }

        if (signal.aborted) {
          return;
        }

        sounds = roomCues(previous, current, latest.playerId).filter(
          (sound) =>
            steps.length === 0 || (sound !== "deal" && sound !== "reveal")
        );
      }

      const caughtUp = queue.length === 0;

      if (caughtUp) {
        run = null;
      }

      show(
        { dealing: !caughtUp && frame.dealing, room: current, step: null },
        sounds
      );
    }
  };

  const reset = () => {
    run?.abort();
    run = null;
    queue.length = 0;
    latest = null;
    settled = null;
    frame = emptyFrame;
    moveCuePending = false;
  };

  return {
    dispose: reset,
    update: (next: PlaybackInput | null) => {
      if (!next) {
        if (latest) {
          reset();
          show();
        }

        return;
      }

      if (
        latest &&
        (latest.room.code !== next.room.code ||
          latest.playerId !== next.playerId)
      ) {
        reset();
      }

      const previous = latest;
      latest = next;
      const move = ownMove(next);

      if (move !== (previous && ownMove(previous))) {
        moveCuePending = move !== null;
      }

      if (previous?.room === next.room) {
        if (previous.canAct !== next.canAct && run === null) {
          show();
        }

        return;
      }

      queue.push(next.room);

      if (!run) {
        run = new AbortController();
        void drain(run.signal);
      }
    },
  };
};
