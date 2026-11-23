import { Button } from "@ui-sdk/solid/button";
import { createSignal, onSettled, Show } from "solid-js";

import { paths } from "../router";
import CardBackMark from "./card-back-mark";

export const SLOW_CONNECTION_MS = 8000;

const RoomConnecting = (props: {
  code: string;
  online: boolean;
  onRetry: () => void;
}) => {
  const [slow, setSlow] = createSignal(false);
  const [exitsStayOffered, setExitsStayOffered] = createSignal(false);

  const waitForSlow = () => {
    setSlow(false);

    const timer = setTimeout(() => {
      setSlow(true);
      setExitsStayOffered(true);
    }, SLOW_CONNECTION_MS);

    return () => {
      clearTimeout(timer);
    };
  };

  let stopWaiting: (() => void) | undefined;

  onSettled(() => {
    stopWaiting = waitForSlow();

    return () => {
      stopWaiting?.();
    };
  });

  const status = () => {
    if (!props.online) {
      return "Waiting for a connection";
    }

    return slow() ? "Taking longer than usual" : "Connecting";
  };

  const retry = () => {
    if (!props.online) {
      return;
    }

    stopWaiting?.();
    stopWaiting = waitForSlow();
    props.onRetry();
  };

  return (
    <section class="connecting" aria-labelledby="connecting-room">
      <div class="connecting-deck" aria-hidden="true">
        <span class="card-back">
          <CardBackMark />
        </span>
        <span class="card-back" data-dealt="">
          <CardBackMark />
        </span>
      </div>
      <div class="panel connecting-panel">
        <h1 class="panel-title" id="connecting-room">
          Finding your table
        </h1>
        <p class="room-code">{props.code}</p>
        <output class="muted connecting-status">
          {status()}
          <span class="connecting-dots" aria-hidden="true">
            ...
          </span>
        </output>
        <Show when={exitsStayOffered()}>
          <div class="connecting-actions">
            <Button
              data-variant="solid"
              aria-disabled={props.online ? undefined : "true"}
              onClick={retry}
            >
              Try again
            </Button>
            <a class="link" href={paths()}>
              Back to home
            </a>
          </div>
        </Show>
      </div>
    </section>
  );
};

export default RoomConnecting;
