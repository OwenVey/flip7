/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Card flights and Room updates must play in order. */

import { calculateRoundScore, isActionCard } from "../game/cards";
import type { Player } from "../game/engine";
import { waitingOn } from "../game/moves";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { roomCues } from "./room-cues";
import type { RoomCue } from "./room-cues";
import {
  flipThreeHaptic,
  landedHaptic,
  settledHaptic,
} from "./room-haptic-cues";
import type { HapticOutcome } from "./room-haptic-cues";

interface QueuedRoom {
  room: RoomView;
  deals: boolean;
  hapticSyncId: number | null;
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
  hapticsVisible: boolean;
  syncId: number;
  playerId: string | null;
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
  player: Player,
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

/** A player's round points as the table shows them, or 0 for a Spectator. */
export const pointsOf = (
  roundPoints: DealPlaybackView["roundPoints"],
  playerId: string | null
) => (playerId === null ? 0 : (roundPoints.get(playerId) ?? 0));

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
  cue: (cue: RoomCue) => void,
  haptic: (cue: HapticOutcome | "turn") => void
) => {
  const queue: QueuedRoom[] = [];
  let latest: PlaybackInput | null = null;
  let settled: RoomView | null = null;
  let run: AbortController | null = null;
  let pause: AbortController | null = null;
  let frame = emptyFrame;
  let moveCuePending = false;
  let moveHapticPending = false;

  const hapticPlayer = (item: QueuedRoom) =>
    latest && item.hapticSyncId === latest.syncId ? latest.playerId : null;

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

  const show = (
    patch: Partial<Frame> = {},
    sounds: RoomCue[] = [],
    outcome?: HapticOutcome | null
  ) => {
    frame = { ...frame, ...patch };

    const actionsDisabled = run !== null || latest?.canAct !== true;

    const myMove =
      !actionsDisabled && latest !== null && ownMove(latest) !== null;

    publish({ ...displayOf(frame), actionsDisabled, myMove });

    for (const sound of sounds) {
      cue(sound);
    }

    let alert: "turn" | undefined;

    if (myMove && moveCuePending) {
      moveCuePending = false;
      cue("turn");

      if (moveHapticPending) {
        alert = "turn";
        moveHapticPending = false;
      }
    }

    const feedback = outcome ?? alert;

    if (feedback) {
      haptic(feedback);
    }
  };

  const playSteps = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    newRound: boolean,
    item: QueuedRoom,
    signal: AbortSignal
  ) => {
    const bulkDeal =
      newRound && steps.filter(isDeckToHand).length >= BULK_DEAL_MIN_CARDS;

    for (const [index, step] of steps.entries()) {
      if (signal.aborted) {
        return;
      }

      const announced = steps[index - 1]?.to.kind === "played";
      const flipHaptic = flipThreeHaptic(step, current, hapticPlayer(item));
      const firstFlip = step.flip?.index === 1 ? step.flip : null;
      const leadIn = firstFlip !== null && !behind() && !announced;

      if (leadIn) {
        show(
          { step: { ...step, flip: { ...firstFlip, index: 0 } } },
          [],
          flipHaptic
        );
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

      show(
        {
          incomingCardId: step.card.id,
          room: dealFrame(previous, current, steps, index + 1),
          step,
        },
        [],
        leadIn ? undefined : flipHaptic
      );
      await fly?.(signal);

      if (signal.aborted) {
        return;
      }

      show(
        { incomingCardId: null },
        [],
        landedHaptic(step, hapticPlayer(item))
      );
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
    item: QueuedRoom,
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

    await playSteps(previous, current, steps, newRound, item, signal);
  };

  const drain = async (signal: AbortSignal) => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { room: current } = item;

      const previous = settled;
      settled = current;
      let sounds: RoomCue[] = [];
      let outcome: HapticOutcome | null = null;

      if (previous && latest) {
        const animate = motion.allowed();
        const steps = animate ? planDeal(previous, current) : [];

        if (animate && reshuffled(previous, current)) {
          motion.reshuffle();
        }

        if (steps.length > 0) {
          await playTransition(previous, current, steps, item, signal);
        }

        if (signal.aborted) {
          return;
        }

        const playerId = hapticPlayer(item);

        if (playerId !== null) {
          outcome = settledHaptic(previous, current, playerId, steps);
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
        sounds,
        outcome
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
    moveHapticPending = false;
  };

  const updateMoveCue = (
    previous: PlaybackInput | null,
    next: PlaybackInput,
    live: boolean
  ) => {
    moveHapticPending &&= live;
    const move = ownMove(next);

    if (move !== (previous && ownMove(previous))) {
      moveCuePending = move !== null;
      moveHapticPending = moveCuePending && live;
    }
  };

  return {
    dispose: reset,
    syncMotion: (visible: boolean) => {
      moveHapticPending &&= visible;

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
      const live = previous?.syncId === next.syncId && next.hapticsVisible;
      updateMoveCue(previous, next, live);

      if (previous?.room === next.room) {
        if (previous.canAct !== next.canAct && run === null) {
          show();
        }

        return;
      }

      const target = queue.at(-1)?.room ?? settled;

      const deals = target !== null && planDeal(target, next.room).length > 0;

      queue.push({
        deals,
        hapticSyncId: live ? next.syncId : null,
        room: next.room,
      });

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
