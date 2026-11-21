import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

globalThis.__UI_SDK_STRICT__ = true;

if (typeof document !== "undefined") {
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe = vi.fn<ResizeObserver["observe"]>();
    unobserve = vi.fn<ResizeObserver["unobserve"]>();
    disconnect = vi.fn<ResizeObserver["disconnect"]>();
  };
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () =>
      Object.assign(new EventTarget(), {
        cancel: vi.fn<Animation["cancel"]>(),
        finished: Promise.resolve(),
        pause: vi.fn<Animation["pause"]>(),
        play: vi.fn<Animation["play"]>(),
      }),
  });
  HTMLElement.prototype.showPopover = vi.fn<() => void>();
  HTMLElement.prototype.hidePopover = vi.fn<() => void>();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = vi.fn<() => void>();
  Element.prototype.checkVisibility = () => true;
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
  document.head.insertAdjacentHTML(
    "beforeend",
    "<style>[popover] { display: block !important }</style>"
  );
}
