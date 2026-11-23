import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeSteadyHeartbeat } from "./heartbeat";

const INTERVAL_MS = 10_000;
const WAIT_MS = 5000;
const CHAT_GAP_MS = 4000;
const CHAT_MESSAGES = 7;

const fakeSocket = () => {
  const target = new EventTarget();
  const sent: string[] = [];
  let missedReplies = 0;

  const socket = {
    addEventListener: (type: string, listener: () => void) => {
      target.addEventListener(type, listener);
    },
    send: (message: string) => {
      sent.push(message);
    },
  };

  return {
    emit: (type: string) => target.dispatchEvent(new Event(type)),
    missedReplies: () => missedReplies,
    onMissedReply: () => {
      missedReplies += 1;
    },
    sent,
    socket,
  };
};

describe(makeSteadyHeartbeat, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps pinging through sustained room traffic", () => {
    const { emit, missedReplies, onMissedReply, sent, socket } = fakeSocket();
    makeSteadyHeartbeat(
      socket,
      { interval: INTERVAL_MS, message: "ping", wait: WAIT_MS },
      onMissedReply
    );
    emit("open");

    for (let index = 0; index < CHAT_MESSAGES; index += 1) {
      vi.advanceTimersByTime(CHAT_GAP_MS);
      emit("message");
    }

    expect(sent).toStrictEqual(["ping", "ping"]);
    expect(missedReplies()).toBe(0);
  });

  it("reports once when a socket stops answering", () => {
    const { emit, missedReplies, onMissedReply, socket } = fakeSocket();
    makeSteadyHeartbeat(
      socket,
      { interval: INTERVAL_MS, message: "ping", wait: WAIT_MS },
      onMissedReply
    );
    emit("open");

    vi.advanceTimersByTime(INTERVAL_MS + WAIT_MS);
    expect(missedReplies()).toBe(1);

    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(missedReplies()).toBe(1);
  });

  it("stops pinging once the socket closes", () => {
    const { emit, onMissedReply, sent, socket } = fakeSocket();
    makeSteadyHeartbeat(
      socket,
      { interval: INTERVAL_MS, message: "ping", wait: WAIT_MS },
      onMissedReply
    );
    emit("open");
    emit("close");

    vi.advanceTimersByTime(INTERVAL_MS * 3);
    expect(sent).toStrictEqual([]);
  });
});
