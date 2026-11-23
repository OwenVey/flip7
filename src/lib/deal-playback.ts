/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Card flights and Room updates must play in order. */

import { calculateRoundScore, isActionCard } from "../game/cards";
import { waitingOn } from "../game/moves";
import { roundStarted } from "../game/protocol";
import type { PlayerView, RoomView } from "../game/protocol";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { roomCues } from "./room-cues";
import type { RoomCue } from "./room-cues";

interface QueuedRoom {
  room: RoomView;
  deals: boolean;
}

const FLIGHT_MS = 280;
const HURRIED_FLIGHT_MS = 140;
const BULK_DEAL_MIN_CARDS = 5;
const PAUSE_MS = 40;
const FLIP_PAUSE_MS = 100;
const FLIP_LEAD_IN_MS = 150;
const DISCARD_MS = 240;
const HURRIED_DISCARD_MS = 160;

export interface DealMotion {
  allowed: () => boolean;
  captureFlight: (
    step: DealStep,
    duration: number
  ) => ((signal: AbortSignal) => Promise<void>) | null;
  land: (
    step: DealStep,
    discardDuration: number,
    signal: AbortSignal
  ) => Promise<void>;
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

export interface DealPlaybackView extends Omit<Frame, "incomingCardId"> {
  actionsDisabled: boolean;
  myMove: boolean;
  roundPoints: ReadonlyMap<string, number>;
}

const emptyFrame: Frame = {
  dealing: false,
  incomingCardId: null,
  room: null,
  step: null,
};

const visibleRoundPoints = (
  player: PlayerView,
  phase: RoomView["phase"],
  incomingCardId: Frame["incomingCardId"]
) => {
  if (phase !== "playing") {
    return player.lastRound?.total ?? 0;
  }

  if (player.status === "busted" || player.status === "out") {
    return 0;
  }

  const hand =
    incomingCardId === null
      ? player.hand
      : player.hand.filter((card) => card.id !== incomingCardId);

  return calculateRoundScore(hand).total;
};

/** Each player's round points as the table shows them. A card in flight counts once it lands. */
export const roundPointsFor = (
  room: RoomView,
  incomingCardId: Frame["incomingCardId"] = null
) =>
  new Map<string, number>(
    room.players.map((player) => [
      player.id,
      visibleRoundPoints(player, room.phase, incomingCardId),
    ])
  );

const displayOf = ({ incomingCardId, room, ...display }: Frame) => ({
  ...display,
  room,
  roundPoints: room
    ? roundPointsFor(room, incomingCardId)
    : new Map<string, number>(),
});

export const initialDealPlayback: DealPlaybackView = {
  ...displayOf(emptyFrame),
  actionsDisabled: true,
  myMove: false,
};

const isDeckToHand = (step: DealStep) =>
  step.from === "deck" && step.to.kind === "hand";

const isOrdinaryDealCard = (step: DealStep) =>
  isDeckToHand(step) && !step.flip && !isActionCard(step.card);

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
  const queue: QueuedRoom[] = [];
  let latest: PlaybackInput | null = null;
  let settled: RoomView | null = null;
  let run: AbortController | null = null;
  let pause: AbortController | null = null;
  let frame = emptyFrame;
  let moveCuePending = false;

  const behind = () => queue.some((queued) => queued.deals);

  const waitForPause = async (ms: number, signal: AbortSignal) => {
    if (behind() || signal.aborted) {
      return;
    }

    const controller = new AbortController();
    pause = controller;
    const pauseSignal = AbortSignal.any([signal, controller.signal]);
    const { promise, resolve } = Promise.withResolvers<undefined>();

    const done = () => {
      resolve(undefined);
    };

    const timer = setTimeout(done, ms);
    pauseSignal.addEventListener("abort", done, { once: true });
    await promise;

    clearTimeout(timer);
    pauseSignal.removeEventListener("abort", done);

    if (pause === controller) {
      pause = null;
    }
  };

  const show = (patch: Partial<Frame> = {}, sounds: RoomCue[] = []) => {
    frame = { ...frame, ...patch };

    const actionsDisabled = run !== null || latest?.canAct !== true;

    const myMove =
      !actionsDisabled && latest !== null && ownMove(latest) !== null;

    publish({ ...displayOf(frame), actionsDisabled, myMove });

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
    newRound: boolean,
    signal: AbortSignal
  ) => {
    const bulkDeal =
      newRound && steps.filter(isDeckToHand).length >= BULK_DEAL_MIN_CARDS;

    for (const [index, step] of steps.entries()) {
      if (signal.aborted) {
        return;
      }

      const announced = steps[index - 1]?.to.kind === "played";

      if (step.flip?.index === 1 && !behind() && !announced) {
        show({ step: { ...step, flip: { ...step.flip, index: 0 } } });
        await waitForPause(FLIP_LEAD_IN_MS, signal);
      }

      if (signal.aborted) {
        return;
      }

      const bulkCard = bulkDeal && isOrdinaryDealCard(step);

      const fly = motion.captureFlight(
        step,
        bulkCard || behind() ? HURRIED_FLIGHT_MS : FLIGHT_MS
      );

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
      await motion.land(
        step,
        behind() ? HURRIED_DISCARD_MS : DISCARD_MS,
        signal
      );

      if (!bulkCard) {
        await waitForPause(step.flip ? FLIP_PAUSE_MS : PAUSE_MS, signal);
      }
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

    if (newRound && previous.phase !== "lobby" && !behind()) {
      await motion.sweep(signal);
    }

    await playSteps(previous, current, steps, newRound, signal);
  };

  const drain = async (signal: AbortSignal) => {
    for (
      let current = queue.shift()?.room;
      current;
      current = queue.shift()?.room
    ) {
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

  const stopRun = () => {
    run?.abort();
    run = null;
    pause = null;
    queue.length = 0;
  };

  const reset = () => {
    stopRun();
    latest = null;
    settled = null;
    frame = emptyFrame;
    moveCuePending = false;
  };

  return {
    dispose: reset,
    syncMotion: () => {
      if (!run || !latest || motion.allowed()) {
        return;
      }

      stopRun();
      settled = latest.room;
      show({ ...emptyFrame, room: settled });
    },
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

      const target = queue.at(-1)?.room ?? settled;

      const deals = target !== null && planDeal(target, next.room).length > 0;

      queue.push({ deals, room: next.room });

      if (deals) {
        pause?.abort();
      }

      if (!run) {
        run = new AbortController();
        void drain(run.signal);
      }
    },
  };
};
