import { isChat } from "../game/engine";
import type { GameEvent } from "../game/game-events";
import { availableMoves } from "../game/moves";
import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { chatCue, gameOverCue, newLogEntries, roomCues } from "./room-cues";
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

/** Outcomes at the viewer's seat that Deal playback reports as a vibration. */
export type HapticOutcome =
  | "bust"
  | "celebrate"
  | "flipThree"
  | "freeze"
  | "saved";

/** A moment to show, the sound it plays and how long it holds. */
export interface MomentSettle {
  cue: RoomCue | null;
  duration: number;
  moment: PlaybackMoment;
}

/** One dealt card and everything that happens around it. */
export interface CardBeat {
  step: DealStep;
  /**
   * The Flip Three opens on this card: show the lead-in before it flies, with
   * this sound, unless playback is behind and plays the sound with the flight.
   */
  leadIn: { cue: RoomCue | null } | null;
  /** Felt as the Flip Three opens, at the lead-in or else as the card flies. */
  flipHaptic: HapticOutcome | null;
  /** Felt as the card lands at the viewer's seat. */
  landHaptic: HapticOutcome | null;
  /** Played as the card lands. A saved card adds the Second Chance sound once it holds. */
  landCue: "flipThree" | "reveal";
  /** A bust or freeze in the middle of the batch, held before the next card. */
  settle: MomentSettle | null;
}

/** The sounds played and the vibration felt as one beat shows. */
export interface BeatFeedback {
  cues: RoomCue[];
  /** For the viewer; playback drops it when the update didn't arrive live. */
  haptic: HapticOutcome | null;
}

/** The moment held after the last card, before the room settles. */
export interface SettleBeat extends BeatFeedback {
  moment: PlaybackMoment;
  duration: number;
}

/** Everything Deal playback shows for one Room update, in order. */
export interface DealBeats {
  newRound: boolean;
  /** The discard pile went back into the deck before the cards were dealt. */
  reshuffle: boolean;
  cards: CardBeat[];
  /** The moment held after the last card, or null to go straight to the room. */
  settle: SettleBeat | null;
  /** As the room settles: after the trailing moment, or straight after the cards. */
  end: BeatFeedback;
  /** Someone else is choosing who gets a dealt action card, so the table holds on it. */
  holdsOtherChoice: boolean;
}

const FLIP_SEVEN_SETTLE_MS = 1400;
const BUST_SETTLE_MS = 640;
const FREEZE_SETTLE_MS = 520;
export const SAVE_SETTLE_MS = 450;
const STAY_SETTLE_MS = 460;
const GIFT_SETTLE_MS = 320;
const OUT_OF_CARDS_SETTLE_MS = 500;

const STEP_EVENTS = ["bust", "flipThree", "freeze", "secondChance"] as const;

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

const noStepEvents = () =>
  ({
    bust: 0,
    flipThree: 0,
    freeze: 0,
    secondChance: 0,
  }) satisfies StepEventCounts;

interface Tally {
  counts: StepEventCounts;
  events: readonly GameEvent[];
  played: StepEventCounts;
  reshuffled: boolean;
}

const tallyOf = (events: readonly GameEvent[], reshuffledDeck: boolean) => {
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
    reshuffled: reshuffledDeck,
  } satisfies Tally;
};

const unplayed = (tally: Tally, event: StepEvent) =>
  tally.played[event] < tally.counts[event];

const cueAlreadyPlayed = (sound: RoomCue, tally: Tally, hasSteps: boolean) => {
  if (hasSteps && (sound === "deal" || sound === "reveal")) {
    return true;
  }

  if (sound === "shuffle") {
    return tally.reshuffled;
  }

  return (
    isStepEvent(sound) && tally.played[sound] > 0 && !unplayed(tally, sound)
  );
};

const bustSettle = (playerId: string) =>
  ({
    cue: "bust",
    duration: BUST_SETTLE_MS,
    moment: { kind: "bust", playerId },
  }) satisfies MomentSettle;

const freezeSettle = (playerId: string, byId: string | null) =>
  ({
    cue: "freeze",
    duration: FREEZE_SETTLE_MS,
    moment: { byId, kind: "freeze", playerId },
  }) satisfies MomentSettle;

const trailingSettle = (tally: Tally, current: RoomView, hasSteps: boolean) => {
  const { events } = tally;
  const flipSeven = events.findLast((event) => event.type === "flipSeven");

  if (flipSeven) {
    return {
      cue: "flipSeven",
      duration: FLIP_SEVEN_SETTLE_MS,
      moment: { kind: "flipSeven", playerId: flipSeven.player.id },
    } satisfies MomentSettle;
  }

  const busted = events.findLast((event) => event.type === "busted");

  if (busted && unplayed(tally, "bust")) {
    return bustSettle(busted.player.id);
  }

  const frozen = events.findLast((event) => event.type === "frozen");

  if (frozen && unplayed(tally, "freeze")) {
    return freezeSettle(frozen.target.id, frozen.by?.id ?? null);
  }

  const saved = events.findLast((event) => event.type === "secondChanceUsed");

  if (saved && unplayed(tally, "secondChance")) {
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

const landedHaptic = (step: DealStep, playerId: string | null) => {
  const { to, card } = step;

  if (to.kind !== "choice" && to.playerId === playerId) {
    if (to.kind === "bust") {
      return "bust";
    }

    if (to.kind === "discard" && card.kind === "number") {
      return "saved";
    }

    if (to.kind === "hand" && card.kind === "freeze") {
      return "freeze";
    }
  }

  return null;
};

const settledHaptic = (
  previous: RoomView,
  current: RoomView,
  playerId: string,
  steps: DealStep[]
) => {
  const before = previous.players.find(({ id }) => id === playerId);
  const player = current.players.find(({ id }) => id === playerId);
  const priorStatus = roundStarted(previous, current) ? null : before?.status;

  if (
    (current.phase === "gameOver" &&
      previous.phase !== "gameOver" &&
      current.winnerIds.includes(playerId)) ||
    (player?.status === "flipSeven" && priorStatus !== "flipSeven")
  ) {
    return "celebrate";
  }

  const froze = player?.status === "frozen" && priorStatus !== "frozen";

  if (steps.length > 0) {
    return froze &&
      !steps.some((step) => landedHaptic(step, playerId) === "freeze")
      ? "freeze"
      : null;
  }

  const draws = current.dealHistory.flatMap((event) =>
    event.type === "draw" &&
    event.seq > previous.dealSeq &&
    event.playerId === playerId
      ? [event]
      : []
  );

  if (draws.some((event) => event.outcome === "bust")) {
    return "bust";
  }

  if (draws.some((event) => event.outcome === "saved")) {
    return "saved";
  }

  if (froze) {
    return "freeze";
  }

  return draws.some(({ flip }) => flip?.index === 1) ? "flipThree" : null;
};

const flipThreeHaptic = (
  step: DealStep,
  room: RoomView,
  playerId: string | null
) => {
  const target =
    step.to.kind === "choice" ? room.choice?.chooserId : step.to.playerId;

  return step.flip?.index === 1 && target === playerId ? "flipThree" : null;
};

const reshuffled = (previous: RoomView, current: RoomView) =>
  current.round === previous.round &&
  current.deckCount > previous.deckCount &&
  current.discardCount < previous.discardCount;

const opensFlipThree = (step: DealStep, previousStep: DealStep | undefined) =>
  step.flip?.index === 1 && previousStep?.to.kind !== "played";

const isMidBatchOutcome = (step: DealStep, index: number, total: number) =>
  index < total - 1 &&
  (step.to.kind === "bust" ||
    (step.to.kind === "hand" && step.card.kind === "freeze"));

const midBatchSettle = (step: DealStep, tally: Tally) => {
  if (step.to.kind === "bust") {
    tally.played.bust += 1;

    return bustSettle(step.to.playerId);
  }

  if (step.to.kind !== "hand") {
    return null;
  }

  const frozenEvents = tally.events.filter((event) => event.type === "frozen");
  const byId = frozenEvents[tally.played.freeze]?.by?.id ?? null;
  tally.played.freeze += 1;

  return freezeSettle(step.to.playerId, byId);
};

const cardBeat = (
  steps: DealStep[],
  index: number,
  step: DealStep,
  current: RoomView,
  viewerId: string | null,
  tally: Tally
) => {
  let leadIn: CardBeat["leadIn"] = null;

  if (opensFlipThree(step, steps[index - 1])) {
    const sounds = unplayed(tally, "flipThree");

    if (sounds) {
      tally.played.flipThree += 1;
    }

    leadIn = { cue: sounds ? "flipThree" : null };
  }

  const landCue = step.to.kind === "played" ? "flipThree" : "reveal";

  if (step.to.kind === "played") {
    tally.played.flipThree += 1;
  }

  if (step.to.kind === "discard" && step.partnerId !== null) {
    tally.played.secondChance += 1;
  }

  return {
    flipHaptic: flipThreeHaptic(step, current, viewerId),
    landCue,
    landHaptic: landedHaptic(step, viewerId),
    leadIn,
    settle: isMidBatchOutcome(step, index, steps.length)
      ? midBatchSettle(step, tally)
      : null,
    step,
  } satisfies CardBeat;
};

const celebratesAtEnd = (
  settle: MomentSettle,
  finale: "win" | "lose" | null,
  outcome: HapticOutcome | null,
  viewerId: string | null
) =>
  finale !== null &&
  outcome === "celebrate" &&
  !(settle.moment.kind === "flipSeven" && settle.moment.playerId === viewerId);

const endFeedback = ({
  cues,
  finale,
  outcome,
  settle,
  viewerId,
}: {
  cues: RoomCue[];
  finale: "win" | "lose" | null;
  outcome: HapticOutcome | null;
  settle: MomentSettle | null;
  viewerId: string | null;
}) => {
  if (settle === null) {
    return { cues, haptic: outcome } satisfies BeatFeedback;
  }

  return {
    cues: finale ? [finale] : [],
    haptic: celebratesAtEnd(settle, finale, outcome, viewerId) ? outcome : null,
  } satisfies BeatFeedback;
};

/**
 * Reads one Room update into what Deal playback shows the viewer, in order:
 * each dealt card with its sounds, vibrations and any moment it settles, then
 * the moment that holds after the last card and the sounds as the room
 * settles. A sound plays once for each event that calls for it, whether a
 * card plays it as it lands or the room plays it at the end. With `animate`
 * off no cards fly, so the room's sounds all play as it settles. Vibrations
 * are for `viewerId`; playback drops them when the update didn't arrive live.
 * A game the viewer wins celebrates as the room settles, unless the trailing
 * moment is their own Flip 7, which celebrates it there.
 */
export const readTransition = (
  previous: RoomView,
  current: RoomView,
  viewerId: string | null,
  animate: boolean
) => {
  const steps = animate ? planDeal(previous, current) : [];
  const entries = newLogEntries(previous, current);

  const events = entries.flatMap((entry) =>
    isChat(entry) ? [] : [entry.event]
  );

  const hasSteps = steps.length > 0;

  const reshuffle =
    events.some((event) => event.type === "deckReshuffled") ||
    reshuffled(previous, current);

  const tally = tallyOf(events, animate && reshuffle);

  const cards = steps.map((step, index) =>
    cardBeat(steps, index, step, current, viewerId, tally)
  );

  const settle = animate ? trailingSettle(tally, current, hasSteps) : null;
  const chat = chatCue(entries, viewerId);
  const finale = gameOverCue(previous, current, viewerId);

  const outcome =
    viewerId === null
      ? null
      : settledHaptic(previous, current, viewerId, steps);

  const beats: DealBeats = {
    cards,
    end: endFeedback({
      cues: roomCues(previous, current, viewerId).filter(
        (sound) => !cueAlreadyPlayed(sound, tally, hasSteps)
      ),
      finale,
      outcome,
      settle,
      viewerId,
    }),
    holdsOtherChoice:
      animate &&
      current.choice !== null &&
      steps.some((step) => step.to.kind === "choice") &&
      availableMoves(current, viewerId).choice === null,
    newRound: roundStarted(previous, current),
    reshuffle,
    settle: settle && {
      cues: [...(settle.cue ? [settle.cue] : []), ...(chat ? [chat] : [])],
      duration: settle.duration,
      haptic: celebratesAtEnd(settle, finale, outcome, viewerId)
        ? null
        : outcome,
      moment: settle.moment,
    },
  };

  return beats;
};
