import Check from "@lucide/solid/icons/check";
import Link2 from "@lucide/solid/icons/link-2";
import { writeClipboard } from "@solid-primitives/clipboard";
import { createTimer } from "@solid-primitives/timer";
import { Button } from "@ui-sdk/solid/button";
import { createSignal } from "solid-js";

const COPIED_RESET_MS = 2000;

export default function InviteButton(props: { solid?: boolean }) {
  const [copied, setCopied] = createSignal(false);

  createTimer(
    () => {
      setCopied(false);
    },
    () => (copied() ? COPIED_RESET_MS : false),
    setTimeout
  );

  const copyLink = async () => {
    await writeClipboard(location.href);
    setCopied(true);
  };

  return (
    <Button
      data-variant={props.solid === true ? "solid" : undefined}
      onClick={copyLink}
    >
      {copied() ? <Check size={16} /> : <Link2 size={16} />}
      {copied() ? "Link copied" : "Copy invite link"}
    </Button>
  );
}
