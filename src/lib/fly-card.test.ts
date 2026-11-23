import { describe, expect, it } from "vitest";

import { measureHeader, openSlot } from "./fly-card";

describe("mini-card slots", () => {
  it("retargets a mini-card slide from its visible position and cancels it on abort", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<article id="slot-test-seat"><header class="seat-header"><ul class="seat-extras"></ul></header></article>'
    );
    const seat = document.querySelector("#slot-test-seat");
    const row = seat?.querySelector(".seat-extras");

    if (!(seat && row)) {
      throw new Error("Expected a mini-card row.");
    }

    const piece = document.createElement("li");
    row.replaceChildren(piece);
    const first = document.createElement("li");
    const second = document.createElement("li");
    const slides: (Keyframe[] | PropertyIndexedKeyframes | null)[] = [];
    const signal = new AbortController();
    let left = 100;
    let translation = 0;
    let cancellations = 0;

    Object.defineProperties(piece, {
      animate: {
        value: (keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
          slides.push(keyframes);
          const { promise, reject } = Promise.withResolvers<undefined>();

          return {
            cancel: () => {
              cancellations += 1;
              translation = 0;
              reject(new DOMException("Animation canceled", "AbortError"));
            },
            finished: promise,
          };
        },
      },
      getBoundingClientRect: {
        value: () => new DOMRect(left + translation, 0, 20, 30),
      },
    });

    try {
      const beforeFirst = measureHeader(seat);
      row.replaceChildren(piece, first);
      left = 80;
      openSlot(first, beforeFirst, signal.signal);
      expect(slides[0]).toStrictEqual([
        { translate: "20px 0px" },
        { translate: "0 0" },
      ]);

      translation = 8;
      const beforeSecond = measureHeader(seat);
      row.replaceChildren(piece, first, second);
      left = 60;
      openSlot(second, beforeSecond, signal.signal);
      expect(cancellations).toBe(1);
      expect(slides[1]).toStrictEqual([
        { translate: "28px 0px" },
        { translate: "0 0" },
      ]);

      await Promise.resolve();
      signal.abort();
      expect(cancellations).toBe(2);
    } finally {
      signal.abort();
      seat.remove();
    }
  });
});
