import Check from "@lucide/solid/icons/check";
import Ellipsis from "@lucide/solid/icons/ellipsis";
import Link2 from "@lucide/solid/icons/link-2";
import LogOut from "@lucide/solid/icons/log-out";
import Share2 from "@lucide/solid/icons/share-2";
import SlidersHorizontal from "@lucide/solid/icons/sliders-horizontal";
import type { AlertDialogController } from "@ui-sdk/solid/alert-dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuItemIcon,
  MenuSeparator,
  MenuTrigger,
} from "@ui-sdk/solid/menu";
import type { PopoverController } from "@ui-sdk/solid/popover";
import { Match, Show, Switch } from "solid-js";

import { createInvite } from "../lib/invite";
import Tooltip from "./tooltip";

/** On narrow screens, the table header's occasional actions share one menu so the header fits. */
export default function TableMoreMenu(props: {
  leave: AlertDialogController;
  leaveDisabled?: boolean;
  settings?: PopoverController;
}) {
  const { copied, invite, shares } = createInvite();

  const inviteLabel = () => {
    if (copied()) {
      return "Link copied";
    }

    return shares() ? "Share invite link" : "Copy invite link";
  };

  return (
    <Menu>
      <Tooltip
        content="More"
        type="label"
        side="bottom"
        trigger={(hint) => (
          <MenuTrigger
            {...hint}
            class="table-more-trigger"
            data-table-more-trigger=""
            aria-label="More"
          />
        )}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </Tooltip>
      <MenuContent side="bottom" align="end">
        <MenuItem closeOnSelect={shares()} onSelect={invite}>
          <MenuItemIcon>
            <Switch fallback={<Link2 size={16} />}>
              <Match when={copied()}>
                <Check size={16} />
              </Match>
              <Match when={shares()}>
                <Share2 size={16} />
              </Match>
            </Switch>
          </MenuItemIcon>
          {inviteLabel()}
        </MenuItem>
        <Show when={props.settings}>
          {(settings) => (
            <MenuItem
              onSelect={() => {
                const anchor = document.querySelector<HTMLElement>(
                  "[data-table-more-trigger]"
                );

                void settings().open({ anchor: anchor ?? undefined });
              }}
            >
              <MenuItemIcon>
                <SlidersHorizontal size={16} />
              </MenuItemIcon>
              Room settings
            </MenuItem>
          )}
        </Show>
        <MenuSeparator />
        <MenuItem
          data-tone="danger"
          disabled={props.leaveDisabled}
          onSelect={() => {
            void props.leave.open();
          }}
        >
          <MenuItemIcon>
            <LogOut size={16} />
          </MenuItemIcon>
          Leave room
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
