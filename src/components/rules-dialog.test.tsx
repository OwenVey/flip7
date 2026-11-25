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

const stubBrowser = (mobile: boolean) => {
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
};

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
      stubBrowser(mobile);
      render(() => <RulesDialog targetScore={300} />);

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
      expect(
        screen.getByText(
          /the sole leader wins if they have at least 300 points/u
        )
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Close rules" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(trigger).toHaveFocus();
      });
    }
  );

  it("explains held action cards, a spare Second Chance, and the win condition", async () => {
    stubBrowser(false);
    render(() => <RulesDialog targetScore={200} />);

    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    const rules = await screen.findByRole("region", { name: "Game rules" });

    expect(rules).toHaveTextContent(
      "A Freeze or Flip Three drawn meanwhile is held. If they survive all three, they assign each held card in the order drawn. A held card whose target is no longer active is discarded."
    );
    expect(rules).toHaveTextContent(
      "If you already have one, give the extra to an active player without one, or discard it if nobody can take it."
    );
    expect(rules).toHaveTextContent(
      "At the end of a round, the sole leader wins if they have at least 200 points. A tie for first plays on."
    );
    expect(rules).not.toHaveTextContent(/waits/u);
  });
});
