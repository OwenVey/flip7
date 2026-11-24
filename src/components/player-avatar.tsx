import { Show } from "solid-js";

import type { Player } from "../game/engine";
import AvatarImage from "./avatar-image";

/** A player's avatar, or the bot mark for a bot. */
export default function PlayerAvatar(props: {
  player: Pick<Player, "avatar">;
  size?: "sm";
}) {
  return (
    <Show
      when={props.player.avatar}
      fallback={
        <span class="avatar bot-avatar" aria-hidden="true">
          <span class="bot-antenna" />
          <span class="bot-ears" />
          <span class="bot-face" />
        </span>
      }
    >
      {(avatar) => <AvatarImage avatar={avatar()} size={props.size} />}
    </Show>
  );
}
