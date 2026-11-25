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

export type PlaybackMoment =
  | { kind: "reshuffle" }
  | { kind: "flipSeven"; playerId: string }
  | { kind: "bust"; playerId: string }
  | { kind: "freeze"; playerId: string; byId: string | null }
  | { kind: "stay"; playerId: string; points: number }
  | { kind: "saved"; playerId: string }
  | { kind: "secondChanceGiven"; playerId: string }
  | { kind: "outOfCards" };

const FLIGHT_MS = 280;
const HURRIED_FLIGHT_MS = 140;
const BULK_DEAL_MIN_CARDS = 5;
const BULK_SETTLE_MS = 140;
const PAUSE_MS = 40;
const FLIP_PAUSE_MS = 220;
const FLIP_START_PAUSE_MS = 200;
const FLIP_LEAD_IN_MS = 220;
const SAVE_HOLD_MS = 320;
const SAVE_SETTLE_MS = 450;
const DISCARD_HOLD_MS = 300;
const CHOICE_SHOW_MS = 380;
const FREEZE_SETTLE_MS = 520;
const BUST_SETTLE_MS = 640;
const STAY_SETTLE_MS = 460;
const FLIP_SEVEN_SETTLE_MS = 1400;
const GIFT_SETTLE_MS = 320;
const OUT_OF_CARDS_SETTLE_MS = 500;
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

interface StepEventCounts {
  bust: number;
  flipThree: number;
  freeze: number;
  secondChance: number;
}

interface TransitionTracker {
  counts: StepEventCounts;
  events: readonly GameEvent[];
  played: StepEventCounts;
  reshuffled: boolean;
}

interface TrailingSettle {
  cue: RoomCue | null;
  duration: number;
  moment: PlaybackMoment;
}

const countStepEvents = (events: readonly GameEvent[]) =>
  ({
    bust: events.filter((event) => event.type === "busted").length,
    flipThree: events.filter((event) => event.type === "flipThreeStarted")
      .length,
    freeze: events.filter((event) => event.type === "frozen").length,
    secondChance: events.filter((event) => event.type === "secondChanceUsed")
      .length,
  }) satisfies StepEventCounts;

const trailingSettle = (
  events: readonly GameEvent[],
  counts: StepEventCounts,
  played: StepEventCounts,
  current: RoomView,
  hasSteps: boolean
) => {
  const flipSeven = events.findLast((event) => event.type === "flipSeven");

  if (flipSeven) {
    return {
      cue: "flipSeven",
      duration: FLIP_SEVEN_SETTLE_MS,
      moment: { kind: "flipSeven", playerId: flipSeven.player.id },
    } satisfies TrailingSettle;
  }

  const busted = events.findLast((event) => event.type === "busted");

  if (busted && played.bust < counts.bust) {
    return {
      cue: "bust",
      duration: BUST_SETTLE_MS,
      moment: { kind: "bust", playerId: busted.player.id },
    } satisfies TrailingSettle;
  }

  const frozen = events.findLast((event) => event.type === "frozen");

  if (frozen && played.freeze < counts.freeze) {
    return {
      cue: "freeze",
      duration: FREEZE_SETTLE_MS,
      moment: {
        byId: frozen.by?.id ?? null,
        kind: "freeze",
        playerId: frozen.target.id,
      },
    } satisfies TrailingSettle;
  }

  const saved = events.findLast((event) => event.type === "secondChanceUsed");

  if (saved && played.secondChance < counts.secondChance) {
    return {
      cue: "secondChance",
      duration: SAVE_SETTLE_MS,
      moment: { kind: "saved", playerId: saved.player.id },
    } satisfies TrailingSettle;
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
    } satisfies TrailingSettle;
  }

  const gifted = events.findLast((event) => event.type === "secondChanceGiven");

  if (gifted) {
    return {
      cue: hasSteps ? null : "reveal",
      duration: GIFT_SETTLE_MS,
      moment: { kind: "secondChanceGiven", playerId: gifted.target.id },
    } satisfies TrailingSettle;
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
    } satisfies TrailingSettle;
  }

  return null;
};

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

const cueAlreadyPlayed = (
  sound: RoomCue,
  tracker: TransitionTracker,
  hasSteps: boolean
) => {
  if (hasSteps && (sound === "deal" || sound === "reveal")) {
    return true;
  }

  const played: Partial<Record<RoomCue, boolean>> = {
    bust: tracker.played.bust > 0 && tracker.played.bust >= tracker.counts.bust,
    flipThree:
      tracker.played.flipThree > 0 &&
      tracker.played.flipThree >= tracker.counts.flipThree,
    freeze:
      tracker.played.freeze > 0 &&
      tracker.played.freeze >= tracker.counts.freeze,
    secondChance:
      tracker.played.secondChance > 0 &&
      tracker.played.secondChance >= tracker.counts.secondChance,
    shuffle: tracker.reshuffled,
  };

  return played[sound] ?? false;
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
  let pause: AbortController | null = null;
  let frame = emptyFrame;
  let moveCuePending = false;
  let moveSoundPending = false;
  let moveHapticPending = false;

  const hapticPlayer = (item: QueuedRoom) =>
    latest && item.hapticSyncId === latest.syncId ? latest.playerId : null;

  const behind = () => queue.some((queued) => queued.deals);

  const waitForPause = async (
    ms: number,
    signal: AbortSignal,
    kind: "deal" | "effect" = "deal"
  ) => {
    if (signal.aborted || (kind === "deal" && behind())) {
      return;
    }

    const controller = kind === "deal" ? new AbortController() : null;
    pause = controller;

    const pauseSignal = controller
      ? AbortSignal.any([signal, controller.signal])
      : signal;

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

  interface StepContext {
    bulkCard: boolean;
    current: RoomView;
    index: number;
    item: QueuedRoom;
    previous: RoomView;
    signal: AbortSignal;
    step: DealStep;
    steps: DealStep[];
    tracker: TransitionTracker;
  }

  const landDiscard = async (
    step: DealStep,
    discardMs: number,
    tracker: TransitionTracker,
    signal: AbortSignal
  ) => {
    const saved = step.partnerId !== null;
    await waitForPause(
      saved ? SAVE_HOLD_MS : DISCARD_HOLD_MS,
      signal,
      "effect"
    );

    if (signal.aborted) {
      return;
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

  const settleMidBatch = async ({
    current,
    index,
    previous,
    signal,
    step,
    steps,
    tracker,
  }: StepContext) => {
    await waitForPause(PAUSE_MS, signal);

    if (signal.aborted) {
      return;
    }

    const landedRoom = dealFrame(previous, current, steps, index + 1, {
      landed: true,
    });

    if (step.to.kind === "bust") {
      tracker.played.bust += 1;
      show(
        {
          moment: { kind: "bust", playerId: step.to.playerId },
          room: landedRoom,
          step: null,
        },
        ["bust"]
      );
      await waitForPause(BUST_SETTLE_MS, signal, "effect");

      return;
    }

    if (step.to.kind === "hand") {
      const frozenEvents = tracker.events.filter(
        (event) => event.type === "frozen"
      );

      const byId = frozenEvents[tracker.played.freeze]?.by?.id ?? null;
      tracker.played.freeze += 1;
      show(
        {
          moment: { byId, kind: "freeze", playerId: step.to.playerId },
          room: landedRoom,
          step: null,
        },
        ["freeze"]
      );
      await waitForPause(FREEZE_SETTLE_MS, signal, "effect");
    }
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
      await landDiscard(step, discardMs, tracker, signal);

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

  const playLeadIn = async (
    step: DealStep,
    current: RoomView,
    item: QueuedRoom,
    tracker: TransitionTracker,
    signal: AbortSignal
  ) => {
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

  const playSteps = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    newRound: boolean,
    item: QueuedRoom,
    tracker: TransitionTracker,
    signal: AbortSignal
  ) => {
    const bulkDeal = isBulkDeal(steps, newRound);

    for (const [index, step] of steps.entries()) {
      if (signal.aborted) {
        return;
      }

      const leadIn = needsLeadIn(step, steps[index - 1], behind());

      if (leadIn) {
        await playLeadIn(step, current, item, tracker, signal);

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

      await landStep({
        bulkCard,
        current,
        index,
        item,
        previous,
        signal,
        step,
        steps,
        tracker,
      });
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

  const playTransition = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    reshuffle: boolean,
    item: QueuedRoom,
    tracker: TransitionTracker,
    signal: AbortSignal
  ) => {
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
      await playSteps(
        previous,
        current,
        steps,
        newRound,
        item,
        tracker,
        signal
      );
    }
  };

  const prepareTurn = (previous: RoomView, current: RoomView) => {
    const animate = motion.allowed();
    const steps = animate ? planDeal(previous, current) : [];
    const events = newLogEntries(previous, current);

    const gameEvents = events.flatMap((entry) =>
      isChat(entry) ? [] : [entry.event]
    );

    const reshuffle = didReshuffle(previous, current, gameEvents);

    const tracker: TransitionTracker = {
      counts: countStepEvents(gameEvents),
      events: gameEvents,
      played: { bust: 0, flipThree: 0, freeze: 0, secondChance: 0 },
      reshuffled: false,
    };

    return { animate, events, gameEvents, reshuffle, steps, tracker };
  };

  const resolveTurn = (
    previous: RoomView,
    current: RoomView,
    viewerId: string | null,
    item: QueuedRoom,
    setup: ReturnType<typeof prepareTurn>
  ) => {
    const { animate, events, gameEvents, steps, tracker } = setup;
    const playerId = hapticPlayer(item);

    const outcome: HapticOutcome | null =
      playerId === null
        ? null
        : settledHaptic(previous, current, playerId, steps);

    const settle = animate
      ? trailingSettle(
          gameEvents,
          tracker.counts,
          tracker.played,
          current,
          steps.length > 0
        )
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
    settle: TrailingSettle;
    signal: AbortSignal;
  }) => {
    const stage1Sounds: RoomCue[] = [
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
      stage1Sounds,
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
            previous,
            current,
            setup.steps,
            setup.reshuffle,
            item,
            setup.tracker,
            signal
          );
        }

        if (signal.aborted) {
          return;
        }

        const resolved = resolveTurn(previous, current, viewerId, item, setup);
        ({ outcome, sounds } = resolved);

        if (resolved.settle !== null) {
          const settledResult = await settleTrailing({
            chat: resolved.chat,
            current,
            finale: resolved.finale,
            outcome,
            playerId: resolved.playerId,
            settle: resolved.settle,
            signal,
          });

          if (!settledResult) {
            return;
          }

          ({ outcome, sounds } = settledResult);
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

    const keepsPlaying =
      previous !== null &&
      previousMove !== null &&
      previous.room.round === next.room.round &&
      previous.room.choice === null &&
      (next.room.choice === null || next.room.choice.card.kind === "freeze");

    moveCuePending = move !== null;
    moveSoundPending = moveCuePending && (moveSoundPending || !keepsPlaying);
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
