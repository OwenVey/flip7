import { avatarImage } from "../lib/avatar-images";

export default function AvatarImage(props: { avatar: number; size?: "sm" }) {
  return (
    <span class="avatar" data-size={props.size}>
      <img src={avatarImage(props.avatar)} alt="" width="28" height="28" />
    </span>
  );
}
