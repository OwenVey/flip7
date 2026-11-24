import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import { Show } from "solid-js";

import { paths } from "../router";
import CardBackMark from "./card-back-mark";
import RoomStatus from "./room-status";

const RoomNotice = (props: {
  title: string;
  code?: string;
  card: "deck" | "empty";
  children: JSX.Element;
  onReturn?: () => void;
}) => (
  <RoomStatus
    title={props.title}
    code={props.code}
    art={
      props.card === "deck" ? (
        <span class="card-back">
          <CardBackMark />
        </span>
      ) : (
        <span class="card-back" data-empty="" />
      )
    }
  >
    <p class="muted room-notice-message">{props.children}</p>
    <Show when={props.onReturn}>
      <Button data-variant="solid" onClick={() => props.onReturn?.()}>
        Return to room
      </Button>
    </Show>
    <Button
      data-variant={props.onReturn ? undefined : "solid"}
      render={(buttonProps) => (
        <a {...buttonProps} href={paths()}>
          {buttonProps.children}
        </a>
      )}
    >
      Back to home
    </Button>
  </RoomStatus>
);

export default RoomNotice;
