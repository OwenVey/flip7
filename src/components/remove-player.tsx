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
  name: string;
  onRemove: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger data-variant="quiet" data-size="sm">
        <UserMinus size={14} />
        Remove<span class="sr-only"> {props.name}</span>
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
            value="confirm"
            data-variant="destructive"
            data-agent-confirm={`Removes ${props.name} from the room`}
            action={() => {
              props.onRemove();
            }}
          >
            Remove from room
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
