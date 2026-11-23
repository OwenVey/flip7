import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoomConnecting, { SLOW_CONNECTION_MS } from "./room-connecting";

const agent = createAgent();

const waitOutSlowConnection = () => {
  vi.advanceTimersByTime(SLOW_CONNECTION_MS);
  flush();
};

describe("<RoomConnecting />", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("names the room and waits quietly at first", () => {
    render(() => <RoomConnecting code="PRJRN" online onRetry={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "Finding your table" })
    ).toBeTruthy();
    expect(screen.getByText("PRJRN")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers a way home once the connection is slow", () => {
    render(() => <RoomConnecting code="PRJRN" online onRetry={() => {}} />);
    waitOutSlowConnection();

    expect(
      screen.getByText("Taking longer than usual", { exact: false })
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
  });

  it("retries and starts the slow wait over", () => {
    const onRetry = vi.fn<() => void>();
    render(() => <RoomConnecting code="PRJRN" online onRetry={onRetry} />);
    waitOutSlowConnection();

    const tryAgain = screen.getByRole("button", { name: "Try again" });
    tryAgain.focus();
    fireEvent.click(tryAgain);
    flush();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText("Connecting", { exact: false })).toBeTruthy();
    expect(document.activeElement).toBe(tryAgain);
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();

    waitOutSlowConnection();
    expect(
      screen.getByText("Taking longer than usual", { exact: false })
    ).toBeTruthy();
  });

  it("lets an agent retry a slow connection", async () => {
    const onRetry = vi.fn<() => void>();
    render(() => <RoomConnecting code="PRJRN" online onRetry={onRetry} />);
    waitOutSlowConnection();

    // WARNING: the agent waits on its own timers, which the fake clock holds until advanced.
    const acting = agent.act({
      steps: [{ action: "press", ref: "Try again" }],
    });

    await vi.advanceTimersByTimeAsync(1000);
    const result = await acting;

    flush();
    expect(result.error).toBeUndefined();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("waits for the device to come back online instead of retrying", () => {
    const onRetry = vi.fn<() => void>();
    render(() => (
      <RoomConnecting code="PRJRN" online={false} onRetry={onRetry} />
    ));
    waitOutSlowConnection();

    expect(
      screen.getByText("Waiting for a connection", { exact: false })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
  });
});
