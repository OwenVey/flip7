import X from "@lucide/solid/icons/x";
import type { JSX } from "@solidjs/web";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";
import { Show } from "solid-js";
import type { ParentProps } from "solid-js";

import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

export default function TableSheet(
  props: ParentProps<{
    title: string;
    triggerLabel: string;
    trigger: JSX.Element;
    /** A short visible label beside the icon, shown when the header has room. */
    shortLabel?: string;
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
      <Tooltip
        content={props.triggerLabel}
        type="label"
        side="bottom"
        compactOnly={props.shortLabel !== undefined}
        trigger={(hint) => (
          <DialogTrigger
            {...hint}
            data-table-sheet-trigger=""
            aria-label={props.triggerLabel}
          />
        )}
      >
        {props.trigger}
        <Show when={props.shortLabel}>
          <span class="button-label" aria-hidden="true">
            {props.shortLabel}
          </span>
        </Show>
      </Tooltip>
      <DialogContent class="table-sheet" keepMounted={props.keepMounted}>
        <header class="table-sheet-header">
          <DialogTitle>{props.title}</DialogTitle>
          <Tooltip
            content="Close"
            type="label"
            trigger={(hint) => (
              <DialogClose
                {...hint}
                aria-label="Close"
                data-size="sm"
                data-icon=""
              />
            )}
          >
            <X size={16} aria-hidden="true" />
          </Tooltip>
        </header>
        <ScrollFade
          viewportClass="table-sheet-body"
          label={props.title}
          hiddenFromAgent={props.open === false}
        >
          {props.children}
        </ScrollFade>
      </DialogContent>
    </Dialog>
  );
}
