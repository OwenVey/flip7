/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Card flights and Room updates must play in order. */

import { calculateRoundScore, isActionCard } from "../game/cards";
import { isChat } from "../game/engine";
import type { Player } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { availableMoves, waitingOn } from "../game/moves";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { dealFrame, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import {
  bustSettle,
  cueAlreadyPlayed,
  freezeSettle,
  SAVE_SETTLE_MS,
  trackTransition,
  trailingSettle,
} from "./playback-moments";
import type {
  MomentSettle,
  PlaybackMoment,
  TransitionTracker,
} from "./playback-moments";
import { chatCue, gameOverCue, newLogEntries, roomCues } from "./room-cues";
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
  myMove: boolean;
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

const didReshuffle = (
  previous: RoomView,
  current: RoomView,
  events: readonly GameEvent[]
) =>
  events.some((event) => event.type === "deckReshuffled") ||
  reshuffled(previous, current);

const isOtherChoice = (
  animate: boolean,
  current: RoomView,
  steps: DealStep[],
  viewerId: string | null
) =>
  animate &&
  current.choice !== null &&
  steps.some((step) => step.to.kind === "choice") &&
  availableMoves(current, viewerId).choice === null;

const needsLeadIn = (
  step: DealStep,
  previousStep: DealStep | undefined,
  isBehind: boolean
) => step.flip?.index === 1 && !isBehind && previousStep?.to.kind !== "played";

const isMidBatchOutcome = (step: DealStep, index: number, total: number) =>
  index < total - 1 &&
  (step.to.kind === "bust" ||
    (step.to.kind === "hand" && step.card.kind === "freeze"));

const isBulkDeal = (steps: DealStep[], newRound: boolean) =>
  newRound && steps.filter(isDeckToHand).length >= BULK_DEAL_MIN_CARDS;

interface Transition {
  current: RoomView;
  item: QueuedRoom;
  previous: RoomView;
  signal: AbortSignal;
  steps: DealStep[];
  tracker: TransitionTracker;
}

interface StepContext extends Transition {
  bulkCard: boolean;
  index: number;
  step: DealStep;
}

type PauseKind = "deal" | "effect";

const holdsBeforeDiscard = (step: DealStep) =>
  step.partnerId !== null || step.card.kind === "secondChance";

const midBatchSettle = ({ step, tracker }: StepContext) => {
  if (step.to.kind === "bust") {
    tracker.played.bust += 1;

    return bustSettle(step.to.playerId);
  }

  if (step.to.kind !== "hand") {
    return null;
  }

  const frozenEvents = tracker.events.filter(
    (event) => event.type === "frozen"
  );

  const byId = frozenEvents[tracker.played.freeze]?.by?.id ?? null;
  tracker.played.freeze += 1;

  return freezeSettle(step.to.playerId, byId);
};

export const createDealPlayback = (
  motion: DealMotion,
  publish: (view: DealPlaybackView) => void,
  cue: (cue: RoomCue, audible?: boolean) => void,
  haptic: (cue: HapticOutcome | "turn") => void
) => {
  const queue: QueuedRoom[] = [];
  let latest: PlaybackInput | null = null;
  let settled: RoomView | null = null;
  let run: AbortController | null = null;
  let pause: { controller: AbortController; kind: PauseKind } | null = null;
  let frame = emptyFrame;
  let moveCuePending = false;
  let moveSoundPending = false;
  let moveHapticPending = false;

  const hapticPlayer = (item: QueuedRoom) =>
    latest && item.hapticSyncId === latest.syncId ? latest.playerId : null;

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
      cue("turn", moveSoundPending);
      moveSoundPending = false;

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

  const landDiscard = async (
    step: DealStep,
    discardMs: number,
    { signal, tracker }: Transition
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
      tracker.played.secondChance += 1;
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

  const settleMidBatch = async (context: StepContext) => {
    const { current, index, previous, signal, steps } = context;
    await waitForPause(PAUSE_MS, signal);

    if (signal.aborted) {
      return;
    }

    const settle = midBatchSettle(context);

    if (settle === null) {
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

  const landStep = async (context: StepContext) => {
    const { bulkCard, index, item, signal, step, steps, tracker } = context;
    const discardMs = behind() ? HURRIED_DISCARD_MS : DISCARD_MS;
    show({ incomingCardId: null }, [], landedHaptic(step, hapticPlayer(item)));

    if (step.to.kind === "played") {
      cue("flipThree");
      tracker.played.flipThree += 1;
      await motion.land(step, discardMs, signal);

      if (!signal.aborted) {
        await waitForPause(FLIP_START_PAUSE_MS, signal, "effect");
      }

      return;
    }

    cue("reveal");

    if (step.to.kind === "discard") {
      await landDiscard(step, discardMs, context);

      return;
    }

    await motion.land(step, discardMs, signal);

    if (signal.aborted) {
      return;
    }

    if (isMidBatchOutcome(step, index, steps.length)) {
      await settleMidBatch(context);

      return;
    }

    if (!bulkCard) {
      await waitForPause(step.flip ? FLIP_PAUSE_MS : PAUSE_MS, signal);
    }
  };

  const playLeadIn = async (step: DealStep, transition: Transition) => {
    const { current, item, signal, tracker } = transition;
    const firstFlip = step.flip;

    if (!firstFlip) {
      return;
    }

    const sounds: RoomCue[] = [];

    if (tracker.counts.flipThree > tracker.played.flipThree) {
      tracker.played.flipThree += 1;
      sounds.push("flipThree");
    }

    show(
      {
        moment: null,
        step: { ...step, flip: { ...firstFlip, index: 0 } },
      },
      sounds,
      flipThreeHaptic(step, current, hapticPlayer(item))
    );
    await waitForPause(FLIP_LEAD_IN_MS, signal, "effect");
  };

  const playSteps = async (transition: Transition, newRound: boolean) => {
    const { current, item, previous, signal, steps } = transition;
    const bulkDeal = isBulkDeal(steps, newRound);

    for (const [index, step] of steps.entries()) {
      if (signal.aborted) {
        return;
      }

      const leadIn = needsLeadIn(step, steps[index - 1], behind());

      if (leadIn) {
        await playLeadIn(step, transition);

        if (signal.aborted) {
          return;
        }
      }

      const bulkCard = bulkDeal && isOrdinaryDealCard(step);
      const ms = bulkCard || behind() ? HURRIED_FLIGHT_MS : FLIGHT_MS;
      const fly = motion.captureFlight(step, ms);

      show(
        {
          incomingCardId: step.card.id,
          moment: null,
          room: dealFrame(previous, current, steps, index + 1),
          step,
        },
        [],
        leadIn ? undefined : flipThreeHaptic(step, current, hapticPlayer(item))
      );
      await fly?.(signal);

      if (signal.aborted) {
        return;
      }

      await landStep({ ...transition, bulkCard, index, step });
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

  const playTransition = async (transition: Transition, reshuffle: boolean) => {
    const { current, previous, signal, steps, tracker } = transition;
    show({ dealing: true, moment: null });
    const newRound = roundStarted(previous, current);

    if (newRound) {
      cue("deal");
    }

    if (newRound && previous.phase !== "lobby" && !behind()) {
      await motion.sweep(signal);

      if (signal.aborted) {
        return;
      }
    }

    if (reshuffle) {
      show({ dealing: true, moment: { kind: "reshuffle" }, step: null }, [
        "shuffle",
      ]);
      tracker.reshuffled = true;
      await motion.reshuffle(signal);

      if (signal.aborted) {
        return;
      }
    }

    if (steps.length > 0) {
      await playSteps(transition, newRound);
    }
  };

  const prepareTurn = (previous: RoomView, current: RoomView) => {
    const animate = motion.allowed();
    const steps = animate ? planDeal(previous, current) : [];
    const events = newLogEntries(previous, current);

    const gameEvents = events.flatMap((entry) =>
      isChat(entry) ? [] : [entry.event]
    );

    return {
      animate,
      events,
      reshuffle: didReshuffle(previous, current, gameEvents),
      steps,
      tracker: trackTransition(gameEvents),
    };
  };

  const resolveTurn = (
    previous: RoomView,
    current: RoomView,
    viewerId: string | null,
    item: QueuedRoom,
    setup: ReturnType<typeof prepareTurn>
  ) => {
    const { animate, events, steps, tracker } = setup;
    const playerId = hapticPlayer(item);

    const outcome: HapticOutcome | null =
      playerId === null
        ? null
        : settledHaptic(previous, current, playerId, steps);

    const settle = animate
      ? trailingSettle(tracker, current, steps.length > 0)
      : null;

    const sounds =
      settle === null
        ? roomCues(previous, current, viewerId).filter(
            (sound) => !cueAlreadyPlayed(sound, tracker, steps.length > 0)
          )
        : ([] satisfies RoomCue[]);

    return {
      chat: chatCue(events, viewerId),
      finale: gameOverCue(previous, current, viewerId),
      outcome,
      playerId,
      settle,
      sounds,
    };
  };

  const settleTrailing = async ({
    chat,
    current,
    finale,
    outcome,
    playerId,
    settle,
    signal,
  }: {
    chat: RoomCue | null;
    current: RoomView;
    finale: "win" | "lose" | null;
    outcome: HapticOutcome | null;
    playerId: string | null;
    settle: MomentSettle;
    signal: AbortSignal;
  }) => {
    const momentSounds: RoomCue[] = [
      ...(settle.cue ? [settle.cue] : []),
      ...(chat ? [chat] : []),
    ];

    const winnerCelebrates =
      finale !== null &&
      outcome === "celebrate" &&
      !(
        settle.moment.kind === "flipSeven" &&
        settle.moment.playerId === playerId
      );

    show(
      { dealing: true, moment: settle.moment, room: current, step: null },
      momentSounds,
      winnerCelebrates ? null : outcome
    );
    await waitForPause(settle.duration, signal, "effect");

    if (signal.aborted) {
      return null;
    }

    return {
      outcome: winnerCelebrates ? outcome : null,
      sounds: finale ? [finale] : [],
    };
  };

  const holdChoiceIfOther = async ({
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
        const viewerId = latest.playerId;
        const setup = prepareTurn(previous, current);

        if (setup.animate && (setup.steps.length > 0 || setup.reshuffle)) {
          await playTransition(
            {
              current,
              item,
              previous,
              signal,
              steps: setup.steps,
              tracker: setup.tracker,
            },
            setup.reshuffle
          );
        }

        if (signal.aborted) {
          return;
        }

        const resolved = resolveTurn(previous, current, viewerId, item, setup);
        ({ outcome, sounds } = resolved);

        if (resolved.settle !== null) {
          const afterSettle = await settleTrailing({
            chat: resolved.chat,
            current,
            finale: resolved.finale,
            outcome,
            playerId: resolved.playerId,
            settle: resolved.settle,
            signal,
          });

          if (!afterSettle) {
            return;
          }

          ({ outcome, sounds } = afterSettle);
        }

        if (isOtherChoice(setup.animate, current, setup.steps, viewerId)) {
          await holdChoiceIfOther({ current, outcome, signal, sounds });

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
    moveCuePending = false;
    moveSoundPending = false;
    moveHapticPending = false;
  };

  const updateMoveCue = (
    previous: PlaybackInput | null,
    next: PlaybackInput,
    live: boolean
  ) => {
    moveHapticPending &&= live;
    const move = ownMove(next);

    const previousMove = previous && ownMove(previous);

    if (move === previousMove) {
      return;
    }

    const sameMoveContinues =
      previous !== null &&
      previousMove !== null &&
      previous.room.round === next.room.round &&
      previous.room.choice === null &&
      (next.room.choice === null || next.room.choice.card.kind === "freeze");

    moveCuePending = move !== null;
    moveSoundPending =
      moveCuePending && (moveSoundPending || !sameMoveContinues);
    moveHapticPending = moveCuePending && live;
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
