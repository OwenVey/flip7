import UserMinus from "@lucide/solid/icons/user-minus";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/solid/alert-dialog";
import { Button } from "@ui-sdk/solid/button";
import { Show } from "solid-js";

import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

const RemoveLabel = (props: { name: string }) => (
  <>
    <UserMinus size={14} aria-hidden="true" />
    <span class="button-label">Remove</span>
    <span class="sr-only"> {props.name}</span>
  </>
);

/** Removes a player after a confirmation, or straight away when `confirm` is false. */
export default function RemovePlayer(props: {
  bot?: boolean;
  confirm?: boolean;
  disabled?: boolean;
  name: string;
  onRemove: () => void;
}) {
  let confirmed = false;

  return (
    <Show
      when={props.confirm !== false}
      fallback={
        <Tooltip
          content={`Remove ${props.name}`}
          type="label"
          compactOnly
          trigger={(hint) => (
            <Button
              {...hint}
              class="remove-player"
              data-variant="quiet"
              data-size="sm"
              aria-disabled={props.disabled === true ? "true" : undefined}
              onClick={() => {
                if (props.disabled !== true) {
                  props.onRemove();
                }
              }}
            />
          )}
        >
          <RemoveLabel name={props.name} />
        </Tooltip>
      }
    >
      <AlertDialog
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
        <Tooltip
          content={`Remove ${props.name}`}
          type="label"
          compactOnly
          trigger={(hint) => (
            <AlertDialogTrigger
              {...hint}
              class="remove-player"
              data-variant="quiet"
              data-size="sm"
              aria-disabled={props.disabled === true ? "true" : undefined}
              onClick={(event) => {
                if (props.disabled === true) {
                  event.preventDefault();
                }
              }}
            />
          )}
        >
          <RemoveLabel name={props.name} />
        </Tooltip>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <ScrollFade>
            <div class="alert-dialog-body">
              <div class="alert-dialog-copy">
                <AlertDialogTitle>Remove {props.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {props.bot === true
                    ? "The bot leaves the table and its points are lost."
                    : "They lose their seat and points. They can come back with the room code as a new player."}
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
    </Show>
  );
}
