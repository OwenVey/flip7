import { Button } from "@ui-sdk/solid/button";
import { createSignal, onSettled, Show } from "solid-js";

import { paths } from "../router";
import CardBackMark from "./card-back-mark";
import RoomStatus from "./room-status";

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
    <RoomStatus
      title="Finding your table"
      code={props.code}
      delayed
      art={
        <>
          <span class="card-back">
            <CardBackMark />
          </span>
          <span class="card-back" data-dealt="">
            <CardBackMark />
          </span>
        </>
      }
    >
      <output class="muted connecting-status">
        {status()}
        <span class="connecting-dots" aria-hidden="true">
          ...
        </span>
      </output>
      <Show when={exitsStayOffered()}>
        <div class="room-status-actions connecting-actions">
          <a class="link" href={paths()}>
            Back to home
          </a>
          <Button
            data-variant="solid"
            aria-disabled={props.online ? undefined : "true"}
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      </Show>
    </RoomStatus>
  );
};

export default RoomConnecting;
