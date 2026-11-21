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
      <AlertDialogTrigger data-variant="destructive" disabled={props.disabled}>
        <LogOut size={16} aria-hidden="true" />
        <span class="button-label">Leave room</span>
      </AlertDialogTrigger>
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div data-slot="stack">
          <AlertDialogTitle>Leave this room?</AlertDialogTitle>
          <AlertDialogDescription>
            You give up your seat and your points. If you're the host, the next
            player takes over.
          </AlertDialogDescription>
        </div>
        <div data-slot="row">
          <AlertDialogClose>Stay here</AlertDialogClose>
          <AlertDialogClose
            disabled={props.disabled}
            value="confirm"
            data-variant="destructive"
            data-agent-confirm="Gives up your seat and points in this room"
          >
            Leave and give up seat
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
