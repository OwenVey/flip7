import { vi } from "vitest";

export const mockMatchMedia = (matches: boolean) => {
  const query = Object.assign(new EventTarget(), { matches });
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
  vi.stubGlobal("matchMedia", () => query);

  return (next: boolean) => {
    query.matches = next;
    query.dispatchEvent(new Event("change"));
  };
};
