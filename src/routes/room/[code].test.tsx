import { Title } from "@solidjs/meta";
import type { RouteSectionProps } from "@solidjs/router";
import { createRouter, memoryHistory } from "@solidjs/router";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import faviconUrl from "../../assets/favicon.svg?url";
import { parseClientMessage } from "../../game/client-message";
import {
  addPlayer,
  chat,
  createGame,
  hit,
  reactToChat,
  startGame,
} from "../../game/engine";
import { waitingOn } from "../../game/moves";
import type { ServerMessage } from "../../game/protocol";
import { toStateMessage } from "../../game/protocol";
import { MOTION_PREFERENCE_QUERY } from "../../lib/motion";
import { gameAtFirstTurn, random } from "../../test/deal-game";
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

const stubRoomBrowser = (animate = false) => {
  vi.useFakeTimers();
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
  vi.stubGlobal("matchMedia", (query: string) =>
    Object.assign(new EventTarget(), {
      matches: animate && query === MOTION_PREFERENCE_QUERY,
    })
  );
  // oxlint-disable-next-line landmines-testing/no-test-doubles -- Supply Worker frames at the browser transport boundary in jsdom.
  vi.stubGlobal("WebSocket", TestSocket);
};

const renderRoom = (history: ReturnType<typeof memoryHistory>) => {
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
    stubRoomBrowser();
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
      `<link rel="icon" type="image/svg+xml" href="${faviconUrl}" />`
    );
    const icon = document.head.querySelector(iconSelector);

    const expectAlert = (title: string, hasDot: boolean) => {
      expect(document.title).toBe(title);
      const favicon = decodeURIComponent(icon?.getAttribute("href") ?? "");
      expect(favicon).toMatch(/^data:image\/svg\+xml,<svg/u);
      expect(favicon.includes("<circle")).toBe(hasDot);
    };

    const history = memoryHistory(`/room/${roomCode}`);
    renderRoom(history);
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
    expect(icon?.getAttribute("href")).toBe(faviconUrl);
  });

  it("keeps the chat draft when the host starts the game", async () => {
    stubRoomBrowser();

    renderRoom(memoryHistory(`/room/${roomCode}`));
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
    receive(socket, { playerId: "ada", token: "test-token", type: "welcome" });
    receive(socket, toStateMessage(roomCode, game));
    await advanceTime(0);

    fireEvent.input(screen.getByPlaceholderText("Say something…"), {
      target: { value: "good luck" },
    });
    flush();
    expect(screen.getByPlaceholderText("Say something…")).toHaveValue(
      "good luck"
    );

    startGame(game, "ada", () => 0.5);
    receive(socket, toStateMessage(roomCode, game));
    await advanceTime(0);

    expect(screen.getByPlaceholderText("Say something…")).toHaveValue(
      "good luck"
    );
  });

  it("keeps a confirmed reaction visible during Deal playback", async ({
    onTestFinished,
  }) => {
    stubRoomBrowser(true);
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: () => ({ cancel: () => {}, finished: Promise.resolve() }),
    });
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, "animate");
    });

    renderRoom(memoryHistory(`/room/${roomCode}`));
    flush();
    await advanceTime(0);
    const socket = TestSocket.current;

    if (socket === undefined) {
      throw new Error("Expected the room to connect");
    }

    socket.dispatchEvent(new Event("open"));
    const game = gameAtFirstTurn();
    chat(game, "a", "Nice!");
    const messageId = game.logSeq;
    reactToChat(game, "b", messageId, "👍");
    receive(socket, { playerId: "b", token: "test-token", type: "welcome" });
    receive(socket, toStateMessage(roomCode, game));
    await advanceTime(0);

    game.deck.push({ id: 1003, kind: "number", value: 7 });
    hit(game, "a", random);
    receive(socket, toStateMessage(roomCode, game));
    await advanceTime(0);

    fireEvent.click(screen.getByRole("button", { name: "Thumbs up: 1" }));
    flush();
    expect(screen.queryByRole("button", { name: "Thumbs up: 1" })).toBeNull();

    const command = parseClientMessage(socket.sent.at(-1) ?? "");

    if (command?.type !== "react" || command.requestId === undefined) {
      throw new Error("Expected a reaction command with a request ID");
    }

    reactToChat(game, "b", messageId, null);
    receive(socket, toStateMessage(roomCode, game));
    receive(socket, { requestId: command.requestId, type: "accepted" });
    await advanceTime(0);

    expect(screen.getByText("Ada hits…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Thumbs up: 1" })).toBeNull();
  });
});
