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

export default function RemovePlayer(props: {
  disabled?: boolean;
  name: string;
  onRemove: () => void;
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
          props.onRemove();
        }
      }}
    >
      <AlertDialogTrigger
        data-variant="quiet"
        data-size="sm"
        disabled={props.disabled}
      >
        <UserMinus size={14} aria-hidden="true" />
        <span class="button-label">Remove</span>
        <span class="sr-only"> {props.name}</span>
      </AlertDialogTrigger>
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div data-slot="stack">
          <AlertDialogTitle>Remove {props.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose their seat and points. They can come back with the room
            code as a new player.
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
      </AlertDialogContent>
    </AlertDialog>
  );
}
