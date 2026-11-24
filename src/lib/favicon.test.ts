import { beforeEach, describe, expect, it } from "vitest";

import plainSvg from "../../public/favicon.svg?raw";
import { restoreFavicon, showFaviconDot } from "./favicon";

const svgIcon = () => document.head.querySelector('link[type="image/svg+xml"]');

const iconHref = () => svgIcon()?.getAttribute("href") ?? "";

const embeddedIcon = () => decodeURIComponent(iconHref());

const resetHead = () => {
  document.head.innerHTML = `
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  `;
};

describe(showFaviconDot, () => {
  beforeEach(resetHead);

  it("adds the dot to the site icon during a move alert", () => {
    showFaviconDot(true);

    expect(embeddedIcon()).toContain(
      plainSvg.trimEnd().replace("</svg>", "<circle")
    );
    expect(
      document.head.querySelector('link[sizes="32x32"]')?.getAttribute("href")
    ).toBe("/favicon.ico");
  });

  it("shows the plain icon between blinks", () => {
    showFaviconDot(true);
    showFaviconDot(false);

    expect(embeddedIcon()).toBe(`data:image/svg+xml,${plainSvg}`);
  });

  it("does nothing when the page has no SVG icon", () => {
    document.head.innerHTML = "";

    expect(() => {
      showFaviconDot(true);
    }).not.toThrow();
  });
});

describe(restoreFavicon, () => {
  beforeEach(resetHead);

  it("puts back the site's own icon link", () => {
    showFaviconDot(true);
    restoreFavicon();

    expect(iconHref()).toBe("/favicon.svg");
  });
});
