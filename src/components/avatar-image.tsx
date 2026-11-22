import { For } from "solid-js";

import { avatarSrc } from "../game/avatars";

/**
 * One avatar from the sprite sheet. Browsers don't repaint an image when
 * only the src fragment changes, so a new avatar gets a new element.
 */
export default function AvatarImage(props: { avatar: number; size?: "sm" }) {
  return (
    <For each={[props.avatar]}>
      {(avatar) => (
        <img
          class="avatar"
          data-size={props.size}
          src={avatarSrc(avatar)}
          alt=""
          width="28"
          height="28"
        />
      )}
    </For>
  );
}
