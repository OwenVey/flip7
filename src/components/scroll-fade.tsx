import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@ui-sdk/solid/scroll-area";
import type { ParentProps } from "solid-js";

export default function ScrollFade(
  props: ParentProps<{
    class?: string;
    viewportClass?: string;
    horizontal?: boolean;
    label?: string;
    hiddenFromAgent?: boolean;
  }>
) {
  return (
    <ScrollArea
      class={["scroll-fades", props.class]}
      type="auto"
      data-horizontal={props.horizontal === true ? "" : undefined}
      data-agent-hidden={props.hiddenFromAgent === true ? "" : undefined}
    >
      <ScrollAreaViewport
        class={["scroll-fade-viewport", props.viewportClass]}
        aria-label={props.label}
        role={props.label === undefined ? undefined : "region"}
      >
        <ScrollAreaContent>{props.children}</ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar
        orientation={props.horizontal === true ? "horizontal" : "vertical"}
      >
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  );
}
