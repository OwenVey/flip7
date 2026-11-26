/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Card flights and Room updates must play in order. */

import { calculateRoundScore, isActionCard } from "../game/cards";
import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { readTransition, SAVE_SETTLE_MS } from "./deal-beats";
import type {
  CardBeat,
  DealBeats,
  HapticOutcome,
  MomentSettle,
  PlaybackMoment,
} from "./deal-beats";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import type { RoomCue } from "./room-cues";

interface QueuedRoom {
  room: RoomView;
  deals: boolean;
  hapticSyncId: number | null;
}

const FLIGHT_MS = 280;
const HURRIED_FLIGHT_MS = 140;
const BULK_DEAL_MIN_CARDS = 5;
const BULK_SETTLE_MS = 140;
const PAUSE_MS = 40;
const FLIP_PAUSE_MS = 220;
const FLIP_START_PAUSE_MS = 200;
const FLIP_LEAD_IN_MS = 220;
const SAVE_HOLD_MS = 320;
const DISCARD_HOLD_MS = 300;
const CHOICE_SHOW_MS = 380;
const DISCARD_MS = 240;
const HURRIED_DISCARD_MS = 160;

const SETTLE_BACKLOG = 2;

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
  reshuffle: (signal: AbortSignal) => Promise<void>;
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
  moment: PlaybackMoment | null;
  room: RoomView | null;
  step: DealStep | null;
}

export interface DealPlaybackView extends Omit<Frame, "incomingCardId"> {
  actionsDisabled: boolean;
  roundPoints: ReadonlyMap<string, number>;
}

const emptyFrame: Frame = {
  dealing: false,
  incomingCardId: null,
  moment: null,
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
};

const isDeckToHand = (step: DealStep) =>
  step.from === "deck" && step.to.kind === "hand";

const isOrdinaryDealCard = (step: DealStep) =>
  isDeckToHand(step) && !step.flip && !isActionCard(step.card);

const isBulkDeal = (steps: DealStep[], newRound: boolean) =>
  newRound && steps.filter(isDeckToHand).length >= BULK_DEAL_MIN_CARDS;

const holdsBeforeDiscard = (step: DealStep) =>
  step.partnerId !== null || step.card.kind === "secondChance";

interface Transition {
  beats: DealBeats;
  current: RoomView;
  item: QueuedRoom;
  previous: RoomView;
  signal: AbortSignal;
  steps: DealStep[];
}

interface CardContext extends Transition {
  beat: CardBeat;
  bulkCard: boolean;
  index: number;
}

type PauseKind = "deal" | "effect";

export const createDealPlayback = (
  motion: DealMotion,
  publish: (view: DealPlaybackView) => void,
  cue: (cue: RoomCue) => void,
  haptic: (cue: HapticOutcome) => void
) => {
  const queue: QueuedRoom[] = [];
  let latest: PlaybackInput | null = null;
  let settled: RoomView | null = null;
  let run: AbortController | null = null;
  let pause: { controller: AbortController; kind: PauseKind } | null = null;
  let frame = emptyFrame;

  const felt = (item: QueuedRoom, outcome: HapticOutcome | null) =>
    latest && item.hapticSyncId === latest.syncId ? outcome : null;

  const behind = () => queue.some((queued) => queued.deals);
  const backlogged = () => queue.length >= SETTLE_BACKLOG;

  const cutsShort = (kind: PauseKind) =>
    kind === "deal" ? behind() : backlogged();

  const waitForPause = async (
    ms: number,
    signal: AbortSignal,
    kind: PauseKind = "deal"
  ) => {
    if (signal.aborted || cutsShort(kind)) {
      return;
    }

    const controller = new AbortController();
    pause = { controller, kind };
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

    if (pause?.controller === controller) {
      pause = null;
    }
  };

  const show = (
    patch: Partial<Frame> = {},
    sounds: RoomCue[] = [],
    outcome?: HapticOutcome | null
  ) => {
    frame = { ...frame, ...patch };

    for (const sound of sounds) {
      cue(sound);
    }

    if (outcome) {
      haptic(outcome);
    }

    publish({
      ...displayOf(frame),
      actionsDisabled: run !== null || latest?.canAct !== true,
    });
  };

  const landDiscard = async (
    step: DealStep,
    discardMs: number,
    signal: AbortSignal
  ) => {
    const saved = step.partnerId !== null;

    if (holdsBeforeDiscard(step)) {
      await waitForPause(
        saved ? SAVE_HOLD_MS : DISCARD_HOLD_MS,
        signal,
        "effect"
      );

      if (signal.aborted) {
        return;
      }
    }

    if (saved) {
      cue("secondChance");
    }

    await motion.land(step, discardMs, signal);

    if (!signal.aborted) {
      await waitForPause(
        saved ? SAVE_SETTLE_MS : PAUSE_MS,
        signal,
        saved ? "effect" : "deal"
      );
    }
  };

  const settleMidBatch = async (
    { current, index, previous, signal, steps }: CardContext,
    settle: MomentSettle
  ) => {
    await waitForPause(PAUSE_MS, signal);

    if (signal.aborted) {
      return;
    }

    show(
      {
        moment: settle.moment,
        room: dealFrame(previous, current, steps, index + 1, { landed: true }),
        step: null,
      },
      settle.cue ? [settle.cue] : []
    );
    await waitForPause(settle.duration, signal, "effect");
  };

  const landStep = async (context: CardContext) => {
    const { beat, bulkCard, item, signal } = context;
    const { step } = beat;
    const discardMs = behind() ? HURRIED_DISCARD_MS : DISCARD_MS;
    show({ incomingCardId: null }, [], felt(item, beat.landHaptic));
    cue(beat.landCue);

    if (step.to.kind === "played") {
      await motion.land(step, discardMs, signal);

      if (!signal.aborted) {
        await waitForPause(FLIP_START_PAUSE_MS, signal, "effect");
      }

      return;
    }

    if (step.to.kind === "discard") {
      await landDiscard(step, discardMs, signal);

      return;
    }

    await motion.land(step, discardMs, signal);

    if (signal.aborted) {
      return;
    }

    if (beat.settle) {
      await settleMidBatch(context, beat.settle);

      return;
    }

    if (!bulkCard) {
      await waitForPause(step.flip ? FLIP_PAUSE_MS : PAUSE_MS, signal);
    }
  };

  const playLeadIn = async (beat: CardBeat, { item, signal }: Transition) => {
    const { flip } = beat.step;

    if (!flip) {
      return;
    }

    show(
      { moment: null, step: { ...beat.step, flip: { ...flip, index: 0 } } },
      beat.leadIn?.cue ? [beat.leadIn.cue] : [],
      felt(item, beat.flipHaptic)
    );
    await waitForPause(FLIP_LEAD_IN_MS, signal, "effect");
  };

  const flyCard = async (context: CardContext, leadIn: boolean, ms: number) => {
    const { beat, current, index, item, previous, signal, steps } = context;
    const { step } = beat;
    const fly = motion.captureFlight(step, ms);

    show(
      {
        incomingCardId: step.card.id,
        moment: null,
        room: dealFrame(previous, current, steps, index + 1),
        step,
      },
      !leadIn && beat.leadIn?.cue ? [beat.leadIn.cue] : [],
      leadIn ? undefined : felt(item, beat.flipHaptic)
    );
    await fly?.(signal);
  };

  const playCards = async (transition: Transition) => {
    const { beats, signal, steps } = transition;
    const bulkDeal = isBulkDeal(steps, beats.newRound);

    for (const [index, beat] of beats.cards.entries()) {
      if (signal.aborted) {
        return;
      }

      const leadIn = beat.leadIn !== null && !behind();

      if (leadIn) {
        await playLeadIn(beat, transition);

        if (signal.aborted) {
          return;
        }
      }

      const bulkCard = bulkDeal && isOrdinaryDealCard(beat.step);
      const context = { ...transition, beat, bulkCard, index };
      await flyCard(
        context,
        leadIn,
        bulkCard || behind() ? HURRIED_FLIGHT_MS : FLIGHT_MS
      );

      if (signal.aborted) {
        return;
      }

      await landStep(context);
    }

    const lastStep = steps.at(-1);

    if (
      !signal.aborted &&
      bulkDeal &&
      lastStep !== undefined &&
      isOrdinaryDealCard(lastStep)
    ) {
      await waitForPause(BULK_SETTLE_MS, signal);
    }
  };

  const playTransition = async (transition: Transition) => {
    const { beats, previous, signal, steps } = transition;
    show({ dealing: true, moment: null });

    if (beats.newRound) {
      cue("deal");
    }

    if (beats.newRound && previous.phase !== "lobby" && !behind()) {
      await motion.sweep(signal);

      if (signal.aborted) {
        return;
      }
    }

    if (beats.reshuffle) {
      show({ dealing: true, moment: { kind: "reshuffle" }, step: null }, [
        "shuffle",
      ]);
      await motion.reshuffle(signal);

      if (signal.aborted) {
        return;
      }
    }

    if (steps.length > 0) {
      await playCards(transition);
    }
  };

  const holdOtherChoice = async ({
    current,
    outcome,
    signal,
    sounds,
  }: {
    current: RoomView;
    outcome: HapticOutcome | null;
    signal: AbortSignal;
    sounds: RoomCue[];
  }) => {
    show(
      { dealing: false, moment: null, room: current, step: null },
      sounds,
      outcome
    );
    await waitForPause(CHOICE_SHOW_MS, signal, "effect");
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

        const beats = readTransition(
          previous,
          current,
          latest.playerId,
          animate
        );

        const steps = beats.cards.map(({ step }) => step);

        if (animate && (steps.length > 0 || beats.reshuffle)) {
          await playTransition({
            beats,
            current,
            item,
            previous,
            signal,
            steps,
          });
        }

        if (signal.aborted) {
          return;
        }

        const { end, settle } = beats;
        outcome = felt(item, end.haptic);
        sounds = end.cues;

        if (settle) {
          show(
            { dealing: true, moment: settle.moment, room: current, step: null },
            settle.cues,
            felt(item, settle.haptic)
          );
          await waitForPause(settle.duration, signal, "effect");

          if (signal.aborted) {
            return;
          }
        }

        if (beats.holdsOtherChoice) {
          await holdOtherChoice({ current, outcome, signal, sounds });

          if (signal.aborted) {
            return;
          }

          sounds = [];
          outcome = null;
        }
      }

      const caughtUp = queue.length === 0;

      if (caughtUp) {
        run = null;
      }

      show(
        {
          dealing: !caughtUp && frame.dealing,
          moment: null,
          room: current,
          step: null,
        },
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
      const live = previous?.syncId === next.syncId && next.hapticsVisible;

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

      if (pause && cutsShort(pause.kind)) {
        pause.controller.abort();
      }

      if (!run) {
        run = new AbortController();
        void drain(run.signal);
      }
    },
  };
};
