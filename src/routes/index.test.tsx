import { createRouter, memoryHistory } from "@solidjs/router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import Home from ".";

const renderHome = () => {
  const history = memoryHistory("/");

  const Router = createRouter({
    history,
    routes: [{ component: Home, path: "/" }],
  });

  render(() => <Router>{(props) => props.children}</Router>);

  return history;
};

describe(Home, () => {
  afterEach(cleanup);

  it("blocks submission when the room code is empty or incomplete", async () => {
    renderHome();
    const code = screen.getByRole("textbox", { name: "Room code" });
    const join = screen.getByRole("button", { name: "Join room" });

    expect(code).toBeInvalid();
    join.click();
    expect(code).toBeInTheDocument();

    const result = await createAgent().act({
      steps: [{ action: "setValue", args: ["ab"], ref: "Room code" }],
    });

    expect(result.error).toBeUndefined();
    expect(code).toBeInvalid();
    join.click();
    expect(code).toBeInTheDocument();
  });

  it("fills the five slots and joins with the normalized code", async () => {
    const history = renderHome();
    const code = screen.getByRole("textbox", { name: "Room code" });

    code.focus();
    flush();

    fireEvent.input(code, { target: { value: "abcde" } });
    flush();

    expect(code).toHaveAttribute("autocomplete", "off");
    expect(code).toHaveValue("abcde");
    expect(code).toBeValid();
    expect(
      document.querySelectorAll('[data-slot="otp-input-slot"][data-filled]')
    ).toHaveLength(5);
    screen.getByRole("button", { name: "Join room" }).click();
    await waitFor(() => {
      expect(history.get()).toBe("/room/ABCDE");
    });
  });
});
