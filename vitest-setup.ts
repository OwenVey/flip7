import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

globalThis.__UI_SDK_STRICT__ = true;

if (typeof document !== "undefined") {
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
