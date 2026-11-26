import ChevronDown from "@lucide/solid/icons/chevron-down";
import Crown from "@lucide/solid/icons/crown";
import UserX from "@lucide/solid/icons/user-x";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  createAlertDialogController,
} from "@ui-sdk/solid/alert-dialog";
import type { AlertDialogController } from "@ui-sdk/solid/alert-dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuItemIcon,
  MenuTrigger,
} from "@ui-sdk/solid/menu";
import { Show } from "solid-js";

import type { Player } from "../game/engine";
import type { AvailableMoves } from "../game/moves";
import PlayerAvatar from "./player-avatar";
import ScrollFade from "./scroll-fade";

type MenuPlayer = Pick<Player, "avatar" | "bot" | "id" | "name">;

const RemoveDialog = (props: {
  controller: AlertDialogController;
  disabled?: boolean;
  name: string;
  onRemove: () => void;
}) => {
  let confirmed = false;

  return (
    <AlertDialog
      controller={props.controller}
      onOpenChange={(open, details) => {
        if (open && confirmed) {
          details.cancel();
        } else if (!open) {
          confirmed = details.returnValue === "confirm";
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open && confirmed) {
          confirmed = false;
          props.onRemove();
        }
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <ScrollFade>
          <div class="alert-dialog-body">
            <div class="alert-dialog-copy">
              <AlertDialogTitle>Remove {props.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                They lose their seat and points. They can come back with the
                room code as a new player.
              </AlertDialogDescription>
            </div>
            <div data-slot="row">
              <AlertDialogClose>Cancel</AlertDialogClose>
              <AlertDialogClose
                disabled={props.disabled}
                value="confirm"
                data-variant="destructive"
                data-agent-confirm={`Removes ${props.name} from the room`}
              >
                Remove from room
              </AlertDialogClose>
            </div>
          </div>
        </ScrollFade>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * A player's avatar. For the host it opens the actions they can take on that
 * player: hand over hosting, or remove them. Everyone else sees a plain avatar.
 */
export default function PlayerMenu(props: {
  player: MenuPlayer;
  host: Pick<AvailableMoves["host"], "kick" | "makeHost">;
  disabled?: boolean;
  onRemove: (playerId: string) => void;
  onMakeHost: (playerId: string) => void;
}) {
  const confirmRemove = createAlertDialogController();

  const remove = () => {
    if (props.player.bot) {
      props.onRemove(props.player.id);
    } else {
      void confirmRemove.open();
    }
  };

  return (
    <Show
      when={props.host.kick.includes(props.player.id)}
      fallback={<PlayerAvatar player={props.player} />}
    >
      <Menu>
        <MenuTrigger
          class="player-menu-trigger"
          aria-label={`Options for ${props.player.name}`}
        >
          <PlayerAvatar player={props.player} />
          <span class="player-menu-badge" aria-hidden="true">
            <ChevronDown size={10} stroke-width={3} />
          </span>
        </MenuTrigger>
        <MenuContent side="bottom" align="start">
          <Show when={!props.player.bot}>
            <MenuItem
              disabled={
                props.disabled === true ||
                !props.host.makeHost.includes(props.player.id)
              }
              onSelect={() => {
                props.onMakeHost(props.player.id);
              }}
            >
              <MenuItemIcon>
                <Crown size={16} />
              </MenuItemIcon>
              Make host
              <Show
                when={
                  props.disabled !== true &&
                  !props.host.makeHost.includes(props.player.id)
                }
              >
                <span class="menu-item-note">Offline</span>
              </Show>
            </MenuItem>
          </Show>
          <MenuItem
            data-tone="danger"
            disabled={props.disabled}
            onSelect={remove}
          >
            <MenuItemIcon>
              <UserX size={16} />
            </MenuItemIcon>
            Remove from room
          </MenuItem>
        </MenuContent>
      </Menu>
      <Show when={!props.player.bot}>
        <RemoveDialog
          controller={confirmRemove}
          disabled={props.disabled}
          name={props.player.name}
          onRemove={() => {
            props.onRemove(props.player.id);
          }}
        />
      </Show>
    </Show>
  );
}
