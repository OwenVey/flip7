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
import { INSTALL_DISMISSED_KEY } from "../lib/install-prompt";
import { rememberRoom, tokenKey } from "../lib/recent-rooms";

const rpcResponse = (value: boolean | string) =>
  Response.json(value, { headers: { "X-Server-Function-Format": "8" } });

const renderHome = (path = "/") => {
  const history = memoryHistory(path);

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
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("fills the slots from a pasted room link", async () => {
    configureServerFunctionsClient({
      fetch: (_, request) => rpcResponse(request.body === "FGHJK"),
    });
    const history = renderHome();
    const code = screen.getByRole("textbox", { name: "Room code" });

    code.focus();
    flush();

    const pasted = fireEvent.paste(code, {
      clipboardData: {
        getData: () => "https://flip7.example/room/fghjk",
      },
    });

    flush();

    expect(pasted).toBeFalsy();
    expect(code).toHaveValue("FGHJK");
    expect(code).toBeValid();
    screen.getByRole("button", { name: "Join room" }).click();
    await waitFor(() => {
      expect(history.get()).toBe("/room/FGHJK");
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

  it("offers to rejoin saved rooms that still exist", async () => {
    for (const code of ["ABCDE", "FGHJK"]) {
      localStorage.setItem(tokenKey(code), `token-${code}`);
    }

    rememberRoom(localStorage, "ABCDE", Date.now() - 2 * 3_600_000);
    rememberRoom(localStorage, "FGHJK", Date.now() - 60_000);
    configureServerFunctionsClient({
      fetch: (_, request) => rpcResponse(request.body === "ABCDE"),
    });
    const history = renderHome();

    const rejoin = await screen.findByRole("button", {
      name: "Rejoin room ABCDE",
    });

    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rejoin room FGHJK" })
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(tokenKey("FGHJK"))).toBeNull();

    rejoin.click();
    await waitFor(() => {
      expect(history.get()).toBe("/room/ABCDE");
    });
  });

  it("focuses the room code from the Join room home screen shortcut", async () => {
    const history = renderHome("/?action=join");
    const code = screen.getByRole("textbox", { name: "Room code" });

    await waitFor(() => {
      expect(code).toHaveFocus();
    });
    expect(history.get()).toBe("/");
  });

  it("creates a room from the New room home screen shortcut", async () => {
    configureServerFunctionsClient({ fetch: () => rpcResponse("ABCDE") });
    const history = renderHome("/?action=create");

    await waitFor(() => {
      expect(history.get()).toBe("/room/ABCDE");
    });
  });

  it("shows iOS install steps until they are dismissed", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom reports a desktop user agent; the iOS steps need an iPhone.
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
    );
    renderHome();

    const offer = await screen.findByRole("complementary", {
      name: "Install Flip 7",
    });

    expect(offer).toHaveTextContent("Add to Home Screen");

    screen.getByRole("button", { name: "Don't show again" }).click();
    flush();

    expect(
      screen.queryByRole("complementary", { name: "Install Flip 7" })
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe("true");
  });

  it("offers no install steps on a desktop browser without a prompt", () => {
    renderHome();
    flush();

    expect(
      screen.queryByRole("complementary", { name: "Install Flip 7" })
    ).not.toBeInTheDocument();
  });
});
