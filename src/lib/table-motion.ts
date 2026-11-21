import { motionAllowed } from "./motion";

const SLIDE_MS = 420;
const SLIDE_EASING = "cubic-bezier(0.25, 0.8, 0.3, 1)";
const CHIP_MS = 520;
const POP_MS = 320;
const BUMP_MS = 380;
const NUDGE_MS = 520;

/** A quick swell, as when a number ticks over. */
export const pop = (element: Element | undefined, scale = 1.25) => {
  if (!(element && motionAllowed())) {
    return;
  }

  element.animate([{ scale: 1 }, { offset: 0.35, scale }, { scale: 1 }], {
    duration: POP_MS,
    easing: "ease-out",
  });
};

/** Knocks a seat back a little, as when an action card lands on it. */
export const bump = (element: Element | null) => {
  if (!(element && motionAllowed())) {
    return;
  }

  element.animate(
    [
      { scale: 1 },
      { offset: 0.25, scale: "0.97", translate: "0 3px" },
      { scale: 1, translate: "0 0" },
    ],
    { duration: BUMP_MS, easing: "cubic-bezier(0.3, 1.6, 0.5, 1)" }
  );
};

/** Lifts the action bar to say it's your move. */
export const nudge = (element: Element | null) => {
  if (!(element && motionAllowed())) {
    return;
  }

  element.animate(
    [
      { translate: "0 0" },
      { offset: 0.3, translate: "0 -6px" },
      { offset: 0.6, translate: "0 1px" },
      { translate: "0 0" },
    ],
    { duration: NUDGE_MS, easing: "ease-out" }
  );
};

/** Brings your own seat into view, clear of the action bar, so you see your cards as you decide. */
export const revealSeat = (element: Element | null) => {
  element?.scrollIntoView({
    behavior: motionAllowed() ? "smooth" : "auto",
    block: "nearest",
  });
};

/**
 * Slides each keyed child of `list` from where it sat last time to where it
 * sits now, so a reordered table shows who moved. Returns the new positions
 * to pass back on the next change.
 */
export const slideRows = (
  list: Element | undefined,
  before: ReadonlyMap<string, number>
) => {
  const after = new Map<string, number>();

  if (!list) {
    return after;
  }

  const rows = [...list.children].filter(
    (row): row is HTMLElement => row instanceof HTMLElement
  );

  for (const row of rows) {
    const { key } = row.dataset;

    if (key !== undefined) {
      after.set(key, row.offsetTop);
    }
  }

  if (!motionAllowed()) {
    return after;
  }

  for (const row of rows) {
    const key = row.dataset.key ?? "";
    const from = before.get(key);
    const to = after.get(key);

    if (from !== undefined && to !== undefined && from !== to) {
      row.animate([{ translate: `0 ${from - to}px` }, { translate: "0 0" }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASING,
      });
    }
  }

  return after;
};

/** Where the dealer chip sits, relative to its seat. */
export interface ChipSpot {
  seatId: string;
  x: number;
  y: number;
}

const seatOf = (seatId: string) =>
  document.querySelector(`[data-seat="${CSS.escape(seatId)}"]`);

const flyChip = (chip: HTMLElement, from: DOMRect, to: DOMRect) => {
  const copy = chip.cloneNode(true);

  if (!(copy instanceof HTMLElement)) {
    return;
  }

  Object.assign(copy.style, {
    left: `${to.left}px`,
    margin: "0",
    pointerEvents: "none",
    position: "fixed",
    top: `${to.top}px`,
    zIndex: "11",
  });
  const layer = document.querySelector("[data-chip-layer]");

  if (!layer) {
    return;
  }

  chip.style.visibility = "hidden";
  layer.replaceChildren(copy);

  const flight = copy.animate(
    [
      {
        rotate: "0deg",
        scale: 1,
        translate: `${from.left - to.left}px ${from.top - to.top}px`,
      },
      { offset: 0.5, rotate: "180deg", scale: 1.4 },
      { rotate: "360deg", scale: 1, translate: "0 0" },
    ],
    { duration: CHIP_MS, easing: SLIDE_EASING }
  );

  const land = () => {
    copy.remove();
    chip.style.removeProperty("visibility");
  };

  flight.addEventListener("finish", land);
  flight.addEventListener("cancel", land);
};

/**
 * Rolls the dealer chip from the last dealer's seat to the new one. Returns
 * where it now sits, to pass back on the next change.
 */
export const passDealerChip = (
  dealerId: string | null,
  previous: ChipSpot | null
) => {
  const seat = dealerId === null ? null : seatOf(dealerId);
  const chip = seat?.querySelector(".dealer-chip");

  if (!(dealerId !== null && seat && chip instanceof HTMLElement)) {
    return previous;
  }

  const seatRect = seat.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();

  const spot: ChipSpot = {
    seatId: dealerId,
    x: chipRect.left - seatRect.left,
    y: chipRect.top - seatRect.top,
  };

  const oldSeat =
    previous && previous.seatId !== dealerId ? seatOf(previous.seatId) : null;

  if (previous && oldSeat && motionAllowed()) {
    const oldRect = oldSeat.getBoundingClientRect();

    const from = new DOMRect(
      oldRect.left + previous.x,
      oldRect.top + previous.y,
      chipRect.width,
      chipRect.height
    );

    flyChip(chip, from, chipRect);
  }

  return spot;
};
