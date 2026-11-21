import X from "@lucide/solid/icons/x";
import type { JSX } from "@solidjs/web";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";
import type { ParentProps } from "solid-js";

export default function TableSheet(
  props: ParentProps<{
    title: string;
    triggerLabel: string;
    trigger: JSX.Element;
    keepMounted?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>
) {
  return (
    <Dialog
      presentation="sheet"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogTrigger
        data-table-sheet-trigger=""
        aria-label={props.triggerLabel}
        title={props.title}
      >
        {props.trigger}
      </DialogTrigger>
      <DialogContent class="table-sheet" keepMounted={props.keepMounted}>
        <header class="table-sheet-header">
          <DialogTitle>{props.title}</DialogTitle>
          <DialogClose aria-label="Close" data-size="sm" data-icon="">
            <X size={16} aria-hidden="true" />
          </DialogClose>
        </header>
        <div
          class="table-sheet-body"
          data-agent-hidden={props.open === false ? "" : undefined}
        >
          {props.children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
