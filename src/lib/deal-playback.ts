import { createEffect, createSignal, flush, onSettled } from "solid-js";

import type { RoomView } from "../game/protocol";
import { dealFrame, leavesTable, planDeal } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import { discardCards, flyCard, riffleDeck } from "./fly-card";

const FLIGHT_MS = 460;
const FLIP_FLIGHT_MS = 560;
const HURRIED_FLIGHT_MS = 220;
const PAUSE_MS = 70;
const FLIP_PAUSE_MS = 260;
const FLIP_LEAD_IN_MS = 320;

interface DealHooks {
  /** A card landed in its place. */
  onCardLanded?: (step: DealStep) => void;
  /** The table caught up with a room update, after dealing `dealt` cards. */
  onSettled?: (previous: RoomView, current: RoomView, dealt: number) => void;
  /** A room update with cards to deal arrived at the front of the queue. */
  onDealStart?: (previous: RoomView, current: RoomView) => void;
}

const wait = async (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  setTimeout(resolve, ms);
  await promise;
};

const motionAllowed = () =>
  document.visibilityState === "visible" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

const cardAt = (cardId: number | null) =>
  cardId === null ? "" : ` [data-card-id="${cardId}"]`;

const handCard = (playerId: string, cardId: number | null) =>
  cardId === null
    ? null
    : document.querySelector(
        `[data-seat="${playerId}"] .hand${cardAt(cardId)}`
      );

const destination = (step: DealStep) => {
  const { to } = step;

  if (to.kind === "choice") {
    return document.querySelector(`[data-choice-card]${cardAt(step.card.id)}`);
  }

  if (to.kind === "held") {
    return document.querySelector(
      `[data-seat="${to.playerId}"] [data-held]${cardAt(step.card.id)}`
    );
  }

  return handCard(to.playerId, step.card.id);
};

const origin = (step: DealStep) => {
  const selectors = {
    choice: `[data-choice-card]${cardAt(step.card.id)}`,
    deck: "[data-deck] .card-back",
    held: `[data-held]${cardAt(step.card.id)}`,
  } as const;

  return document.querySelector(selectors[step.from]);
};

const reshuffled = (previous: RoomView, current: RoomView) =>
  current.round === previous.round &&
  current.deckCount > previous.deckCount &&
  current.discardCount < previous.discardCount;

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

const fly = async (step: DealStep, from: DOMRect, hurry: boolean) => {
  const to = destination(step);
  const layer = document.querySelector("[data-flight-layer]");

  if (!(layer && to instanceof HTMLElement)) {
    return;
  }

  to.dataset.incoming = "";
  await flyCard({
    duration: flightTime(step, hurry),
    faceDown: step.from === "deck",
    from,
    layer,
    to,
  });
  to.dataset.flown = "";
  delete to.dataset.incoming;
};

const discardAfterLanding = async (step: DealStep) => {
  if (!leavesTable(step.to)) {
    return;
  }

  const cards =
    step.from === "held"
      ? [origin(step)]
      : [
          handCard(step.to.playerId, step.card.id),
          handCard(step.to.playerId, step.partnerId),
        ];

  await discardCards(cards.filter((card) => card !== null));
};

/**
 * Plays room updates back as a dealer would: each new card leaves the deck
 * and flies into its place one at a time, and the rest of the update shows
 * once the last card lands. Updates that arrive meanwhile wait their turn and
 * deal faster so the table never falls far behind.
 */
export const createDealPlayback = (
  source: () => RoomView | null,
  hooks: DealHooks = {}
) => {
  const [room, setRoom] = createSignal<RoomView | null>(null);
  const [step, setStep] = createSignal<DealStep | null>(null);
  const [dealing, setDealing] = createSignal(false);
  const [incoming, setIncoming] = createSignal<number | null>(null);
  const queue: RoomView[] = [];
  let settled: RoomView | null = null;
  let running = false;
  let generation = 0;

  const show = (view: RoomView | null) => {
    setRoom(view);
    flush();
  };

  const dealFrom = async (
    previous: RoomView,
    current: RoomView,
    steps: DealStep[],
    index: number,
    run: number
  ) => {
    const next = steps.at(index);

    if (next === undefined || run !== generation) {
      return;
    }

    const hurry = queue.length > 0;

    const announced = index > 0 && steps.at(index - 1)?.to.kind === "played";

    const startsFlip = next.flip?.index === 1 && !hurry && !announced;

    if (startsFlip && next.flip) {
      setStep({ ...next, flip: { ...next.flip, index: 0 } });
      flush();
      await wait(FLIP_LEAD_IN_MS);
    }

    const from = origin(next)?.getBoundingClientRect();
    const flies = next.from !== "held" || !leavesTable(next.to);
    setStep(next);
    setIncoming(next.card.id);
    show(dealFrame(previous, current, steps, index + 1));

    if (from && flies) {
      await fly(next, from, hurry);
    }

    if (run !== generation) {
      return;
    }

    setIncoming(null);
    flush();
    hooks.onCardLanded?.(next);
    await discardAfterLanding(next);
    await wait(pauseAfter(next, hurry));
    await dealFrom(previous, current, steps, index + 1, run);
  };

  const playNext = async (run: number) => {
    const current = queue.shift();

    if (!current) {
      return;
    }

    const previous = settled;
    settled = current;

    if (!previous) {
      show(current);

      return;
    }

    const deck = document.querySelector("[data-deck] .card-back");

    if (deck && motionAllowed() && reshuffled(previous, current)) {
      riffleDeck(deck);
    }

    const steps = motionAllowed() ? planDeal(previous, current) : [];

    if (steps.length > 0) {
      setDealing(true);
      hooks.onDealStart?.(previous, current);
      await dealFrom(previous, current, steps, 0, run);
    }

    if (run === generation) {
      setStep(null);
      show(current);
      hooks.onSettled?.(previous, current, steps.length);
    }
  };

  const playQueue = async (run: number) => {
    if (queue.length === 0 || run !== generation) {
      return;
    }

    await playNext(run);
    await playQueue(run);
  };

  const drain = async () => {
    if (running) {
      return;
    }

    running = true;
    const run = generation;
    await playQueue(run);

    if (run === generation) {
      running = false;
      setDealing(false);
    }
  };

  const reset = () => {
    generation += 1;
    queue.length = 0;
    settled = null;
    running = false;
    setStep(null);
    setIncoming(null);
    setDealing(false);
    show(null);
  };

  createEffect(source, (next) => {
    queueMicrotask(() => {
      if (next === null) {
        reset();

        return;
      }

      queue.push(next);
      void drain();
    });
  });

  onSettled(() => () => {
    generation += 1;
    queue.length = 0;
  });

  return { dealing, incoming, room, step };
};
