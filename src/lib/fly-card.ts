const FLIGHT_EASING = "cubic-bezier(0.25, 0.8, 0.3, 1)";
const FLIGHT_TILT_DEG = -8;
const FLIP_START = 0.4;
const SETTLE_GRACE_MS = 250;
const SETTLE_MS = 120;
const LIFT_SHADOW = "0 0.75rem 1.5rem rgb(4 20 14 / 0.45)";

interface Flight {
  /** Where the card starts: the deck, or a card already on the table. */
  from: DOMRect;
  /** The card in its final place, hidden until the flight lands. */
  to: HTMLElement;
  faceDown: boolean;
  duration: number;
  signal: AbortSignal;
  /** A fixed, full-viewport layer the flying copy is drawn in. */
  layer: Element;
}

const centre = (rect: DOMRect) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const CONTEXT_STYLES = [
  "display",
  "font-size",
  "width",
  "height",
  "padding",
  "border-radius",
  "filter",
] as const;

const copyContextStyles = (source: Element, copy: Element) => {
  if (!(copy instanceof HTMLElement || copy instanceof SVGElement)) {
    return;
  }

  const computed = getComputedStyle(source);

  for (const property of CONTEXT_STYLES) {
    copy.style.setProperty(property, computed.getPropertyValue(property));
  }
};

const matchPlacement = (source: Element, copy: Element) => {
  copyContextStyles(source, copy);
  const sources = source.querySelectorAll("*");
  const copies = copy.querySelectorAll("*");

  for (const [index, element] of sources.entries()) {
    copyContextStyles(element, copies.item(index));
  }
};

const cardFace = (card: HTMLElement) => {
  const face = card.cloneNode(true);

  if (!(face instanceof HTMLElement)) {
    throw new TypeError("A card clone should be an element.");
  }

  delete face.dataset.incoming;
  delete face.dataset.flown;
  matchPlacement(card, face);
  face.style.removeProperty("width");
  face.style.removeProperty("height");
  face.classList.add("flying-card-face");

  return face;
};

const buildGhost = (card: HTMLElement, rect: DOMRect, faceDown: boolean) => {
  const ghost = document.createElement("div");
  ghost.className = "flying-card";
  ghost.setAttribute("aria-hidden", "true");
  placeAt(ghost, rect);

  const inner = document.createElement("div");
  inner.className = "flying-card-inner";
  const face = cardFace(card);
  const faces: HTMLElement[] = [face];

  if (faceDown) {
    const back = document.createElement("div");
    back.className = "flying-card-back";
    faces.push(back);
  }

  inner.replaceChildren(...faces);
  ghost.replaceChildren(inner);

  return { face, ghost, inner };
};

const placeAt = (element: HTMLElement, rect: DOMRect) => {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
};

const settle = async (
  animations: Animation[],
  timeout: number,
  signal: AbortSignal
) => {
  const cancel = () => {
    for (const animation of animations) {
      animation.cancel();
    }
  };

  const { promise, resolve } = Promise.withResolvers<undefined>();

  const timer = setTimeout(() => {
    resolve(undefined);
  }, timeout + SETTLE_GRACE_MS);

  signal.addEventListener("abort", cancel, { once: true });

  try {
    await Promise.race([
      Promise.all(
        animations.map(async (animation) => await animation.finished)
      ),
      promise,
    ]);
  } catch {
    cancel();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
};

const moved = (from: DOMRect, to: DOMRect) =>
  Math.abs(from.left - to.left) > 1 ||
  Math.abs(from.top - to.top) > 1 ||
  Math.abs(from.width - to.width) > 1;

const glideTo = async (
  ghost: HTMLElement,
  from: DOMRect,
  to: DOMRect,
  signal: AbortSignal
) => {
  placeAt(ghost, to);

  const animation = ghost.animate(
    [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`,
        transformOrigin: "0 0",
      },
      { transform: "none", transformOrigin: "0 0" },
    ],
    { duration: SETTLE_MS, easing: "ease-out" }
  );

  await settle([animation], SETTLE_MS, signal);
};

/**
 * Flies a copy of `to` from `from` into its place, turning it face up on the
 * way when it starts face down. Resolves once it lands, even when the browser
 * pauses animations in a background tab.
 */
export const flyCard = async ({
  from,
  to,
  faceDown,
  duration,
  layer,
  signal,
}: Flight) => {
  const target = to.getBoundingClientRect();

  if (target.width === 0) {
    return;
  }

  const { face, ghost, inner } = buildGhost(to, target, faceDown);
  const restingShadow = getComputedStyle(to).boxShadow;
  layer.replaceChildren(ghost);

  try {
    const start = centre(from);
    const end = centre(target);
    const scale = from.width / target.width;

    const animations = [
      ghost.animate(
        [
          {
            transform: `translate(${start.x - end.x}px, ${start.y - end.y}px) scale(${scale}) rotate(${FLIGHT_TILT_DEG}deg)`,
          },
          { transform: "none" },
        ],
        { duration, easing: FLIGHT_EASING }
      ),
      face.animate(
        [
          { boxShadow: `${restingShadow}, ${LIFT_SHADOW}` },
          { boxShadow: `${restingShadow}, ${LIFT_SHADOW}`, offset: 0.7 },
          { boxShadow: restingShadow },
        ],
        { duration, easing: "ease-out" }
      ),
    ];

    if (faceDown) {
      animations.push(
        inner.animate(
          [
            { transform: "rotateY(180deg)" },
            { offset: FLIP_START, transform: "rotateY(180deg)" },
            { transform: "rotateY(0deg)" },
          ],
          { duration, easing: "ease-in-out" }
        )
      );
    }

    await settle(animations, duration, signal);
    const landed = to.getBoundingClientRect();

    if (!signal.aborted && landed.width > 0 && moved(target, landed)) {
      await glideTo(ghost, target, landed, signal);
    }
  } finally {
    ghost.remove();
  }
};

const DISCARD_MS = 520;

/** Lifts cards off the table and fades them out, as when Second Chance is used. */
export const discardCards = async (cards: Element[], signal: AbortSignal) => {
  if (cards.length === 0) {
    return;
  }

  await settle(
    cards.map((card) =>
      card.animate(
        [
          { opacity: 1, transform: "none" },
          {
            offset: 0.35,
            opacity: 1,
            transform: "translateY(-0.5rem) rotate(6deg)",
          },
          {
            opacity: 0,
            transform: "translateY(-1.25rem) rotate(-10deg) scale(0.85)",
          },
        ],
        { duration: DISCARD_MS, easing: "ease-in", fill: "forwards" }
      )
    ),
    DISCARD_MS,
    signal
  );
};

/** Gives the deck a quick riffle when the discard pile is shuffled back in. */
export const riffleDeck = (deck: Element) => {
  deck.animate(
    [
      { transform: "none" },
      { transform: "translateX(-0.25rem) rotate(-6deg)" },
      { transform: "translateX(0.25rem) rotate(6deg)" },
      { transform: "none" },
    ],
    { duration: 480, easing: "ease-in-out" }
  );
};

const SWEEP_MS = 420;
const SWEEP_SPREAD_MS = 360;
const SWEEP_STEP_MS = 30;

/**
 * Gathers every card off the table toward the deck, one after another, so a
 * new round reads as a fresh deal instead of hands vanishing at once.
 */
export const sweepCards = async (
  cards: Element[],
  toward: DOMRect,
  signal: AbortSignal
) => {
  if (cards.length === 0) {
    return;
  }

  const step = Math.min(SWEEP_STEP_MS, SWEEP_SPREAD_MS / cards.length);
  const end = centre(toward);

  const animations = cards.map((card, index) => {
    const start = centre(card.getBoundingClientRect());

    return card.animate(
      [
        { opacity: 1, transform: "none" },
        {
          offset: 0.25,
          opacity: 1,
          transform: "translateY(-0.375rem) rotate(-4deg)",
        },
        {
          opacity: 0,
          transform: `translate(${end.x - start.x}px, ${end.y - start.y}px) rotate(-12deg) scale(0.5)`,
        },
      ],
      {
        delay: index * step,
        duration: SWEEP_MS,
        easing: "cubic-bezier(0.5, 0, 0.75, 0)",
        fill: "forwards",
      }
    );
  });

  await settle(animations, SWEEP_MS + SWEEP_SPREAD_MS, signal);
};
