import BotIcon from "@lucide/solid/icons/bot";
import { Show } from "solid-js";

import { avatarSrc } from "../game/avatars";
import type { PlayerView } from "../game/protocol";
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
      {(avatar) => (
        <img
          class="avatar"
          data-size={props.size}
          src={avatarSrc(avatar())}
          alt=""
          width="28"
          height="28"
        />
      )}
    </Show>
  );
}
