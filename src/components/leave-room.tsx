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

export default function LeaveRoom(props: { onLeave: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger data-variant="quiet">
        <LogOut size={16} />
        Leave room
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
            value="confirm"
            data-variant="destructive"
            data-agent-confirm="Gives up your seat and points in this room"
            action={() => {
              props.onLeave();
            }}
          >
            Leave and give up seat
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
