import {
  CARD_BACK_MARK_PATH,
  CARD_BACK_MARK_VIEW_BOX,
} from "../components/card-back-mark";

const FLIGHT_EASING = "cubic-bezier(0.25, 0.8, 0.3, 1)";

const GROW_EASING = "cubic-bezier(0.45, 0, 0.25, 1)";
const FLIGHT_TILT_DEG = -8;
const TILT_PEAK = 0.2;
const FLIP_START = 0.4;
const SETTLE_GRACE_MS = 250;
const SETTLE_MS = 120;

interface Flight {
  /** Where the card starts: the deck, or a card already on the table. */
  from: DOMRect;
  /** The card in its final place, hidden until the flight lands. */
  to: HTMLElement;
  faceDown: boolean;
  emphasize?: boolean;
  duration: number;
  signal: AbortSignal;
  /** A fixed, full-viewport layer the flying copy is drawn in. */
  layer: Element;
}

const centre = (rect: DOMRect) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
});

const cardFace = (card: HTMLElement) => {
  const face = card.cloneNode(true);

  if (!(face instanceof HTMLElement)) {
    throw new TypeError("A card clone should be an element.");
  }

  delete face.dataset.incoming;
  delete face.dataset.flown;
  face.style.setProperty("--card-w", `${card.offsetWidth}px`);
  face.classList.add("flying-card-face");

  return face;
};

const SVG_NS = "http://www.w3.org/2000/svg";

const cardBack = () => {
  const back = document.createElement("div");
  back.className = "card-back flying-card-back";

  const mark = document.createElementNS(SVG_NS, "svg");
  mark.setAttribute("viewBox", CARD_BACK_MARK_VIEW_BOX);
  mark.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", CARD_BACK_MARK_PATH);
  path.setAttribute("fill", "currentColor");

  mark.replaceChildren(path);
  back.replaceChildren(mark);

  return back;
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
    faces.push(cardBack());
  }

  inner.replaceChildren(...faces);
  ghost.replaceChildren(inner);

  return { ghost, inner };
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
  emphasize,
  duration,
  layer,
  signal,
}: Flight) => {
  const target = to.getBoundingClientRect();

  if (target.width === 0) {
    return;
  }

  const { ghost, inner } = buildGhost(to, target, faceDown);
  layer.replaceChildren(ghost);

  try {
    const start = centre(from);
    const end = centre(target);
    const scale = from.width / target.width;

    const offset = { x: start.x - end.x, y: start.y - end.y };
    const peakScale = Math.max(1.15, scale, 72 / target.width);

    const animations = [
      ghost.animate(
        [
          { translate: `${offset.x}px ${offset.y}px` },
          ...(emphasize === true
            ? [
                {
                  offset: 0.45,
                  translate: `${offset.x * 0.4}px ${offset.y * 0.4}px`,
                },
              ]
            : []),
          { translate: "0px 0px" },
        ],
        { duration, easing: FLIGHT_EASING }
      ),
      ghost.animate(
        [
          { scale: `${scale}` },
          ...(emphasize === true
            ? [{ offset: 0.45, scale: `${peakScale}` }]
            : []),
          { scale: "1" },
        ],
        { duration, easing: GROW_EASING }
      ),
      ghost.animate(
        [
          { rotate: "0deg" },
          { offset: TILT_PEAK, rotate: `${FLIGHT_TILT_DEG}deg` },
          { rotate: "0deg" },
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

const PX = /px$/u;
const SCORE_MODIFIER = "[data-score-modifier]";

const pixels = (value: string) => Number(value.replace(PX, "")) || 0;

const startMargin = (element: Element | null) =>
  element ? pixels(getComputedStyle(element).marginInlineStart) : 0;

const separatorChange = (card: Element) => {
  const previous = card.previousElementSibling;
  const next = card.nextElementSibling;
  const nextMargin = startMargin(next);

  const separatedAfter =
    next?.matches(SCORE_MODIFIER) === true &&
    previous !== null &&
    !previous.matches(SCORE_MODIFIER);

  const marginAfter = separatedAfter ? nextMargin || startMargin(card) : 0;

  return nextMargin - marginAfter;
};

const closeSlot = (card: Element, duration: number) => {
  const row = card.parentElement;

  if (
    !(
      card instanceof HTMLElement &&
      row?.classList.contains("seat-extras") === true
    )
  ) {
    return null;
  }

  const gap = pixels(getComputedStyle(row).columnGap);
  const before = card.previousElementSibling !== null;
  const after = card.nextElementSibling !== null;
  const side = before || !after ? "marginInlineStart" : "marginInlineEnd";

  const width =
    card.offsetWidth + (before || after ? gap : 0) + separatorChange(card);

  const from = getComputedStyle(card)[side];

  return card.animate(
    [
      { [side]: from },
      { offset: 0.3, [side]: from },
      { [side]: `${-width}px` },
    ],
    { duration, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }
  );
};

/** Lifts cards off the table and fades them out, as when Second Chance is used. */
export const discardCards = async (
  cards: Element[],
  duration: number,
  signal: AbortSignal
) => {
  if (cards.length === 0) {
    return;
  }

  const lifts = cards.map((card) =>
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
      { duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
    )
  );

  const closes = cards.flatMap((card) => closeSlot(card, duration) ?? []);

  await settle([...lifts, ...closes], duration, signal);
};

/** Shrinks a card into the badge it sits on, as when a Flip Three is played. */
export const absorbCard = async (
  card: Element,
  duration: number,
  signal: AbortSignal
) => {
  await settle(
    [
      card.animate(
        [
          { opacity: 1, scale: "1" },
          { offset: 0.4, opacity: 1, scale: "0.8" },
          { opacity: 0, scale: "0.35" },
        ],
        { duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
      ),
    ],
    duration,
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

const SWEEP_MS = 240;
const SWEEP_SPREAD_MS = 90;
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
        easing: "cubic-bezier(0.77, 0, 0.175, 1)",
        fill: "forwards",
      }
    );
  });

  await settle(animations, SWEEP_MS + SWEEP_SPREAD_MS, signal);
};
