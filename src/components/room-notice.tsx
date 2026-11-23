import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";

import { paths } from "../router";
import CardBackMark from "./card-back-mark";
import RoomStatus from "./room-status";

/**
 * A dead end in the room route: one line of explanation and a way home.
 * `deck` is the connecting screen's deck at rest; `empty` leaves a dashed slot
 * where no table exists.
 */
const RoomNotice = (props: {
  title: string;
  code?: string;
  card: "deck" | "empty";
  children: JSX.Element;
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
    <Button
      data-variant="solid"
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
