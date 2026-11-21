export interface HeartbeatSocket {
  addEventListener: (
    type: "open" | "message" | "close",
    listener: () => void
  ) => void;
  reconnect: () => void;
  send: (message: string) => void;
}

export interface HeartbeatOptions {
  interval: number;
  message: string;
  wait: number;
}

/**
 * Pings on a fixed cadence while the socket is open and reconnects when nothing comes back in time.
 * Unlike `makeHeartbeatWS`, incoming room traffic never postpones a ping, so the server always sees one.
 */
export const makeSteadyHeartbeat = <Socket extends HeartbeatSocket>(
  ws: Socket,
  options: HeartbeatOptions
) => {
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  const stopWaiting = () => {
    clearTimeout(pongTimer);
    pongTimer = undefined;
  };

  const stop = () => {
    clearInterval(pingTimer);
    pingTimer = undefined;
    stopWaiting();
  };

  const ping = () => {
    ws.send(options.message);
    pongTimer ??= setTimeout(() => {
      stop();
      ws.reconnect();
    }, options.wait);
  };

  ws.addEventListener("open", () => {
    stop();
    pingTimer = setInterval(ping, options.interval);
  });
  ws.addEventListener("message", stopWaiting);
  ws.addEventListener("close", stop);

  return ws;
};
