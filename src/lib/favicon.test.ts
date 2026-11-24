import { beforeEach, describe, expect, it } from "vitest";

import { showFaviconDot } from "./favicon";

const svgIcon = () => document.head.querySelector('link[type="image/svg+xml"]');

describe(showFaviconDot, () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    `;
  });

  it("swaps the SVG icon for the dotted one during a move alert", () => {
    showFaviconDot(true);

    expect(svgIcon()?.getAttribute("href")).toBe("/favicon-dot.svg");
    expect(
      document.head.querySelector('link[sizes="32x32"]')?.getAttribute("href")
    ).toBe("/favicon.ico");
  });

  it("puts the plain icon back when the move alert ends", () => {
    showFaviconDot(true);
    showFaviconDot(false);

    expect(svgIcon()?.getAttribute("href")).toBe("/favicon.svg");
  });

  it("does nothing when the page has no SVG icon", () => {
    document.head.innerHTML = "";

    expect(() => {
      showFaviconDot(true);
    }).not.toThrow();
  });
});
