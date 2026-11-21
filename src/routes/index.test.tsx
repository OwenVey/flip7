import { createRouter, memoryHistory } from "@solidjs/router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { configureServerFunctionsClient } from "@solidjs/web/server-functions/client";
import { createAgent } from "@ui-sdk/solid/agent";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from ".";

const rpcResponse = (value: boolean | string) =>
  Response.json(value, { headers: { "X-Server-Function-Format": "8" } });

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
  beforeEach(() => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia, which the footer's rules dialog reads.
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    configureServerFunctionsClient({ fetch: null });
  });

  it("blocks submission when the room code is empty or incomplete", async () => {
    renderHome();
    const code = screen.getByRole("textbox", { name: "Room code" });
    const join = screen.getByRole("button", { name: "Join room" });

    join.click();
    flush();
    expect(code).toHaveAccessibleDescription("Enter the 5-letter room code.");

    const result = await createAgent().act({
      steps: [{ action: "setValue", args: ["ab"], ref: "Room code" }],
    });

    expect(result.error).toBeUndefined();
    join.click();
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription("Enter the 5-letter room code.");
    });
  });

  it("fills the five slots and joins with the normalized code", async () => {
    configureServerFunctionsClient({
      fetch: (_, request) => rpcResponse(request.body === "ABCDE"),
    });
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

  it("shows an inline error for a missing room and allows correction", async () => {
    const history = renderHome();
    const reply = Promise.withResolvers<Response>();
    configureServerFunctionsClient({ fetch: async () => await reply.promise });
    const code = screen.getByRole("textbox", { name: "Room code" });

    fireEvent.input(code, { target: { value: "abcde" } });
    flush();
    screen.getByRole("button", { name: "Join room" }).click();
    flush();
    expect(
      screen.getByRole("button", { name: "Checking room…" })
    ).toBeDisabled();

    reply.resolve(rpcResponse(false));
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription(
        "Room not found. Check the code and try again."
      );
    });
    expect(history.get()).toBe("/");
    fireEvent.input(code, { target: { value: "abcdf" } });
    flush();
    expect(code).toBeValid();
  });

  it("opens the room page when the room check fails", async () => {
    configureServerFunctionsClient({
      fetch: () => new Response(null, { status: 503 }),
    });
    const history = renderHome();
    const code = screen.getByRole("textbox", { name: "Room code" });

    fireEvent.input(code, { target: { value: "abcde" } });
    flush();
    screen.getByRole("button", { name: "Join room" }).click();
    await waitFor(() => {
      expect(code).not.toHaveAccessibleDescription(
        "Couldn't check that room. Try again."
      );
      expect(history.get()).toBe("/room/ABCDE");
    });
  });

  it("prevents another room creation while the first is pending", async () => {
    const history = renderHome();
    const reply = Promise.withResolvers<Response>();
    let requests = 0;
    configureServerFunctionsClient({
      fetch: async () => {
        requests += 1;

        return await reply.promise;
      },
    });
    const create = screen.getByRole("button", { name: "Create room" });

    create.click();
    flush();
    expect(create).toHaveAccessibleName("Creating room…");
    expect(create).toBeDisabled();
    create.click();
    expect(requests).toBe(1);

    reply.resolve(rpcResponse("ABCDE"));
    await waitFor(() => {
      expect(history.get()).toBe("/room/ABCDE");
    });
  });
});
