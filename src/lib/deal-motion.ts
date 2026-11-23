import { leavesTable } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import type { DealMotion } from "./deal-playback";
import {
  absorbCard,
  discardCards,
  flyCard,
  riffleDeck,
  sweepCards,
} from "./fly-card";
import { motionAllowed } from "./motion";
import { bump, pop } from "./table-motion";

const cardAt = (cardId: number) => ` [data-card-id="${cardId}"]`;

const handCard = (root: Element, playerId: string, cardId: number | null) =>
  cardId === null
    ? null
    : root.querySelector(
        `[data-seat="${playerId}"] :is(.hand, .seat-extras, .flip-run-card)${cardAt(cardId)}`
      );

const destination = (root: Element, step: DealStep) => {
  const { to } = step;

  if (to.kind === "choice") {
    return root.querySelector(`[data-choice-card]${cardAt(step.card.id)}`);
  }

  if (to.kind === "held") {
    return root.querySelector(`[data-held]${cardAt(step.card.id)}`);
  }

  return handCard(root, to.playerId, step.card.id);
};

const deckBack = "[data-deck] .card-back";

const origin = (root: Element, step: DealStep) => {
  const selectors = {
    choice: `[data-choice-card]${cardAt(step.card.id)}`,
    deck: deckBack,
    held: `[data-held]${cardAt(step.card.id)}`,
  };

  return root.querySelector(selectors[step.from]);
};

export const createDealMotion: (
  table: () => HTMLElement | undefined
) => DealMotion = (table) => ({
  allowed: () => "animate" in Element.prototype && motionAllowed(),
  captureFlight: (step, duration) => {
    const root = table();
    const start = root ? origin(root, step) : null;
    const discarded = leavesTable(step.to) && step.to.kind !== "played";

    if (!(root && start) || (step.from === "held" && discarded)) {
      return null;
    }

    const from = start.getBoundingClientRect();

    return async (signal) => {
      const to = destination(root, step);
      const layer = root.querySelector("[data-flight-layer]");

      if (!(layer && to instanceof HTMLElement)) {
        return;
      }

      to.dataset.incoming = "";

      try {
        await flyCard({
          duration,
          emphasize: step.from === "choice" || step.from === "held",
          faceDown: step.from === "deck",
          from,
          layer,
          signal,
          to,
        });

        if (!signal.aborted) {
          to.dataset.flown = "";
        }
      } finally {
        delete to.dataset.incoming;
      }
    };
  },
  land: async (step, discardDuration, signal) => {
    const root = table();

    if (!root) {
      return;
    }

    if (step.from === "choice" && step.to.kind !== "choice") {
      bump(root.querySelector(`[data-seat="${step.to.playerId}"]`));
    }

    if (step.to.kind === "played") {
      const card = handCard(root, step.to.playerId, step.card.id);

      if (card) {
        await absorbCard(card, discardDuration, signal);
        pop(card.closest(".flip-run") ?? undefined, 1.12);
      }

      return;
    }

    if (!leavesTable(step.to)) {
      return;
    }

    const cards =
      step.from === "held"
        ? [origin(root, step)]
        : [
            handCard(root, step.to.playerId, step.card.id),
            handCard(root, step.to.playerId, step.partnerId),
          ];

    await discardCards(
      cards.filter((card) => card !== null),
      discardDuration,
      signal
    );
  },
  reshuffle: () => {
    const deck = table()?.querySelector(deckBack);

    if (deck) {
      riffleDeck(deck);
    }
  },
  sweep: async (signal) => {
    const root = table();
    const deck = root?.querySelector(deckBack);

    if (root && deck) {
      await sweepCards(
        [...root.querySelectorAll(".seat .card")],
        deck.getBoundingClientRect(),
        signal
      );
    }
  },
});
