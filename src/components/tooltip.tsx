import type { JSX } from "@solidjs/web";
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipTrigger,
} from "@ui-sdk/solid/tooltip";

type TriggerRender = NonNullable<
  Parameters<typeof TooltipTrigger>[0]["render"]
>;

export default function Tooltip(props: {
  content: JSX.Element;
  trigger?: TriggerRender;
  type?: "description" | "label";
  side?: "top" | "right" | "bottom" | "left";
  compactOnly?: boolean;
  children?: JSX.Element;
}) {
  return (
    <TooltipRoot type={props.type} delay={0}>
      <TooltipTrigger render={props.trigger}>{props.children}</TooltipTrigger>
      <TooltipContent
        data-agent-hidden=""
        side={props.side}
        sideOffset={8}
        data-compact-only={props.compactOnly === true ? "" : undefined}
      >
        {props.content}
      </TooltipContent>
    </TooltipRoot>
  );
}
