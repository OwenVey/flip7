import type { JSX } from "@solidjs/web";
import { createUniqueId, Show } from "solid-js";

const RoomStatus = (props: {
  title: string;
  code?: string;
  art: JSX.Element;
  delayed?: boolean;
  children: JSX.Element;
}) => {
  const titleId = createUniqueId();

  return (
    <section
      class="room-status"
      data-delayed={props.delayed === true ? "" : undefined}
      aria-labelledby={titleId}
    >
      <div class="room-status-art" aria-hidden="true">
        {props.art}
      </div>
      <div class="panel room-status-panel">
        <h1 class="panel-title" id={titleId}>
          {props.title}
        </h1>
        <Show when={props.code}>
          {(code) => <p class="room-code">{code()}</p>}
        </Show>
        {props.children}
      </div>
    </section>
  );
};

export default RoomStatus;
