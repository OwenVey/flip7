import { Title } from "@solidjs/meta";
import type { RouteSectionProps } from "@solidjs/router";
import { createRouter, memoryHistory } from "@solidjs/router";
import { cleanup, render } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addPlayer, createGame, startGame } from "../../game/engine";
import { waitingOn } from "../../game/moves";
import type { ServerMessage } from "../../game/protocol";
import { toStateMessage } from "../../game/protocol";
import RoomPage from "./[code]";

class TestSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static current: TestSocket | undefined;
  readyState: number = TestSocket.OPEN;
  readonly sent: string[] = [];

  constructor() {
    super();
    TestSocket.current = this;
  }

  close() {
    this.readyState = TestSocket.CLOSED;
  }

  send(frame: string) {
    this.sent.push(frame);
  }
}

const roomCode = "ABCDE";
const roomTitle = `Room ${roomCode} · Flip 7`;
const moveTitle = `Your move · ${roomTitle}`;
const iconSelector = 'link[rel="icon"][type="image/svg+xml"]';

const receive = (socket: EventTarget, message: ServerMessage) => {
  socket.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify(message) })
  );
};

const advanceTime = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  flush();
};

describe(RoomPage, () => {
  afterEach(() => {
    cleanup();
    document.head.querySelector(iconSelector)?.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the room title and favicon in sync as the move alert blinks", async () => {
    vi.useFakeTimers();
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", () =>
      Object.assign(new EventTarget(), { matches: false })
    );
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- Supply Worker frames at the browser transport boundary in jsdom.
    vi.stubGlobal("WebSocket", TestSocket);
    const visibility = vi.spyOn(document, "visibilityState", "get");

    const setVisibility = (state: DocumentVisibilityState) => {
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom has no tab switch to change document visibility.
      visibility.mockReturnValue(state);
      document.dispatchEvent(new Event("visibilitychange"));
      flush();
    };

    setVisibility("visible");
    document.head.insertAdjacentHTML(
      "beforeend",
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'
    );
    const icon = document.head.querySelector(iconSelector);

    const expectAlert = (title: string, hasDot: boolean) => {
      expect(document.title).toBe(title);
      const favicon = decodeURIComponent(icon?.getAttribute("href") ?? "");
      expect(favicon).toMatch(/^data:image\/svg\+xml,<svg/u);
      expect(favicon.includes("<circle")).toBe(hasDot);
    };

    const history = memoryHistory(`/room/${roomCode}`);

    const Router = createRouter({
      history,
      routes: [
        {
          component: (props: Omit<RouteSectionProps, "children">) => (
            <RoomPage {...props} params={{ code: props.params.code ?? "" }} />
          ),
          path: "/room/:code",
        },
        { component: () => <Title>Home</Title>, path: "/" },
      ],
    });

    render(() => <Router>{(props) => props.children}</Router>);
    flush();

    await advanceTime(0);
    const socket = TestSocket.current;

    if (socket === undefined) {
      throw new Error("Expected the room to connect");
    }

    socket.dispatchEvent(new Event("open"));

    const game = createGame();
    addPlayer(game, "ada", "Ada", 1);
    addPlayer(game, "ben", "Ben", 2);
    startGame(game, "ada", () => 0.5);
    const playerId = waitingOn(game)?.playerId;

    if (playerId === undefined) {
      throw new Error("Expected a player to move");
    }

    receive(socket, { playerId, token: "test-token", type: "welcome" });
    receive(socket, toStateMessage(roomCode, game));
    await advanceTime(0);
    expectAlert(moveTitle, true);

    setVisibility("hidden");
    await advanceTime(0);
    expectAlert("⚡ Your move!", true);
    await advanceTime(1000);
    expectAlert(moveTitle, false);
    await advanceTime(1000);
    expectAlert("⚡ Your move!", true);

    setVisibility("visible");
    await advanceTime(1000);
    expectAlert(moveTitle, true);

    setVisibility("hidden");
    history.set({ replace: false, scroll: false, value: "/" });
    await advanceTime(1000);
    expect(document.title).toBe("Home");
    expect(icon?.getAttribute("href")).toBe("/favicon.svg");
  });
});
