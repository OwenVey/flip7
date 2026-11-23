export interface HeartbeatSocket {
  addEventListener: (
    type: "open" | "message" | "close",
    listener: () => void
  ) => void;
  send: (message: string) => void;
}

export interface HeartbeatOptions {
  interval: number;
  message: string;
  wait: number;
}

/**
 * Pings on a fixed cadence while the socket is open and reports when nothing comes back in time.
 * Unlike `makeHeartbeatWS`, incoming room traffic never postpones a ping, so the server always sees one.
 */
export const makeSteadyHeartbeat = (
  ws: HeartbeatSocket,
  options: HeartbeatOptions,
  onMissedReply: () => void
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
      onMissedReply();
    }, options.wait);
  };

  ws.addEventListener("open", () => {
    stop();
    pingTimer = setInterval(ping, options.interval);
  });
  ws.addEventListener("message", stopWaiting);
  ws.addEventListener("close", stop);
};
