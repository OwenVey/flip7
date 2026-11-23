import Check from "@lucide/solid/icons/check";
import Link2 from "@lucide/solid/icons/link-2";
import Share2 from "@lucide/solid/icons/share-2";
import { Button } from "@ui-sdk/solid/button";
import { Match, Show, Switch } from "solid-js";

import { createInvite } from "../lib/invite";
import Tooltip from "./tooltip";

/** `brief` shows just "Invite" for crowded headers; the tooltip and accessible name keep the full label. */
export default function InviteButton(props: {
  solid?: boolean;
  brief?: boolean;
}) {
  const { copied, invite, shares } = createInvite();

  const label = () => {
    if (copied()) {
      return "Link copied";
    }

    return shares() ? "Share invite link" : "Copy invite link";
  };

  const shortLabel = () => {
    if (copied()) {
      return "Copied";
    }

    return shares() ? "Share" : "Copy link";
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
      <Show
        when={props.brief === true}
        fallback={
          <span class="button-label">
            <span class="label-long">{label()}</span>
            <span class="label-short" aria-hidden="true">
              {shortLabel()}
            </span>
          </span>
        }
      >
        <span class="button-label" aria-hidden="true">
          {copied() ? "Copied" : "Invite"}
        </span>
      </Show>
    </Tooltip>
  );
}
