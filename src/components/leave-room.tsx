import LogOut from "@lucide/solid/icons/log-out";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/solid/alert-dialog";

import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

export default function LeaveRoom(props: {
  disabled?: boolean;
  onLeave: () => void;
}) {
  let confirmed = false;

  return (
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
          props.onLeave();
        }
      }}
    >
      <Tooltip
        content={
          props.disabled === true
            ? "You can leave after the deal"
            : "Leave room"
        }
        type={props.disabled === true ? "description" : "label"}
        compactOnly={props.disabled !== true}
        trigger={(hint) => (
          <AlertDialogTrigger
            {...hint}
            aria-label="Leave room"
            data-variant="quiet"
            data-tone="danger"
            aria-disabled={props.disabled === true ? "true" : undefined}
            onClick={(event) => {
              if (props.disabled === true) {
                event.preventDefault();
              }
            }}
          />
        )}
      >
        <LogOut size={16} aria-hidden="true" />
        <span class="button-label">Leave</span>
      </Tooltip>
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <ScrollFade>
          <div class="alert-dialog-body">
            <div class="alert-dialog-copy">
              <AlertDialogTitle>Leave this room?</AlertDialogTitle>
              <AlertDialogDescription>
                You give up your seat and your points. If you're the host,
                another player takes over if anyone remains.
              </AlertDialogDescription>
            </div>
            <div data-slot="row">
              <AlertDialogClose>Cancel</AlertDialogClose>
              <AlertDialogClose
                disabled={props.disabled}
                value="confirm"
                data-variant="destructive"
                data-agent-confirm="Gives up your seat and points in this room"
              >
                <LogOut size={16} aria-hidden="true" />
                <span>Leave</span>
              </AlertDialogClose>
            </div>
          </div>
        </ScrollFade>
      </AlertDialogContent>
    </AlertDialog>
  );
}
