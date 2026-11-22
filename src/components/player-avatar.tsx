import BotIcon from "@lucide/solid/icons/bot";
import { Show } from "solid-js";

import type { PlayerView } from "../game/protocol";
import AvatarImage from "./avatar-image";
import Tooltip from "./tooltip";

/** A player's avatar, or the bot mark for a bot. */
export default function PlayerAvatar(props: {
  player: Pick<PlayerView, "avatar">;
  size?: "sm";
}) {
  return (
    <Show
      when={props.player.avatar}
      fallback={
        <Tooltip
          content="Bot"
          type="label"
          trigger={(hint) => <span {...hint} class="bot-avatar" />}
        >
          <BotIcon size={16} strokeWidth={2.25} aria-hidden="true" />
        </Tooltip>
      }
    >
      {(avatar) => <AvatarImage avatar={avatar()} size={props.size} />}
    </Show>
  );
}
