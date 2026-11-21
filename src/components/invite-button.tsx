import Check from "@lucide/solid/icons/check";
import Link2 from "@lucide/solid/icons/link-2";
import Share2 from "@lucide/solid/icons/share-2";
import { writeClipboard } from "@solid-primitives/clipboard";
import { createTimer } from "@solid-primitives/timer";
import { Button } from "@ui-sdk/solid/button";
import { createSignal, Match, onSettled, Switch } from "solid-js";

import Tooltip from "./tooltip";

const COPIED_RESET_MS = 2000;

const canUseShareSheet = () =>
  "share" in navigator && globalThis.matchMedia?.("(pointer: coarse)").matches;

export default function InviteButton(props: { solid?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const [shares, setShares] = createSignal(false);

  onSettled(() => {
    setShares(canUseShareSheet());
  });

  createTimer(
    () => {
      setCopied(false);
    },
    () => (copied() ? COPIED_RESET_MS : false),
    setTimeout
  );

  const label = () => {
    if (copied()) {
      return "Link copied";
    }

    return shares() ? "Share invite link" : "Copy invite link";
  };

  const invite = async () => {
    if (shares()) {
      try {
        await navigator.share({
          title: "Join my Hot Streak table",
          url: location.href,
        });

        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    await writeClipboard(location.href);
    setCopied(true);
  };

  return (
    <Tooltip
      content={label()}
      type="label"
      compactOnly
      trigger={(hint) => (
        <Button
          {...hint}
          data-variant={props.solid === true ? "solid" : undefined}
          onClick={invite}
        />
      )}
    >
      <Switch fallback={<Link2 size={16} />}>
        <Match when={copied()}>
          <Check size={16} />
        </Match>
        <Match when={shares()}>
          <Share2 size={16} />
        </Match>
      </Switch>
      <span class="button-label">{label()}</span>
    </Tooltip>
  );
}
