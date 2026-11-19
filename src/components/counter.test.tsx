import {
  captureArtifact,
  expectNoDiagnostics,
  expectRerunBudget,
} from "@solidjs/diagnostics";
import { fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import Counter from "./counter";

describe("<Counter />", () => {
  it("increments on click", () => {
    const view = render(() => <Counter />);
    const button = view.getByRole("button");
    expect(button).toHaveTextContent("Clicks: 0");
    fireEvent.click(button);
    flush();
    expect(button).toHaveTextContent("Clicks: 1");
  });

  it("re-runs one scope per click and trips no diagnostic", async () => {
    const { artifact } = await captureArtifact(
      () => {
        const view = render(() => <Counter />);
        const button = view.getByRole("button");
        fireEvent.click(button);
        flush();
        expect(button).toHaveTextContent("Clicks: 1");
      },
      { scenario: "counter-click" }
    );

    expectNoDiagnostics(artifact);
    expectRerunBudget(artifact, 1);
  });
});
