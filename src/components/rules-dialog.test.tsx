import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import RulesDialog from "./rules-dialog";

const agent = createAgent();

describe(RulesDialog, () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    { mobile: false, presentation: "dialog" },
    { mobile: true, presentation: "sheet" },
  ])(
    "opens the rules as a $presentation and restores focus on close",
    async ({ mobile, presentation }) => {
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
      vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom does not implement scrolling.
      vi.stubGlobal("scrollTo", () => {});
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks IntersectionObserver.
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe = vi.fn<IntersectionObserver["observe"]>();
          unobserve = vi.fn<IntersectionObserver["unobserve"]>();
          disconnect = vi.fn<IntersectionObserver["disconnect"]>();
        }
      );
      render(() => <RulesDialog targetScore={250} />);

      const trigger = screen.getByRole("button", { name: "Rules" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(agent.snapshot().map((entry) => entry.label)).toContain("Rules");

      trigger.focus();

      const result = await agent.act({
        steps: [{ action: "press", ref: "Rules" }],
      });

      expect(result.error).toBeUndefined();
      const dialog = await screen.findByRole("dialog", { name: "How to play" });
      expect(dialog).toHaveAttribute("data-presentation", presentation);
      expect(screen.getByText(/someone at 250 or more/u)).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Close rules" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(trigger).toHaveFocus();
      });
    }
  );
});
