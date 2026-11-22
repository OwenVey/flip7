import { onSettled } from "solid-js";
import type { ParentProps } from "solid-js";

import { observeScrollEdges } from "../lib/scroll-edges";

export default function ScrollFade(
  props: ParentProps<{
    class?: string;
    viewportClass?: string;
    horizontal?: boolean;
    label?: string;
    hiddenFromAgent?: boolean;
  }>
) {
  let viewport: HTMLDivElement | undefined;

  onSettled(() => {
    const content = viewport?.firstElementChild;

    return viewport && content
      ? observeScrollEdges(viewport, content, undefined, props.horizontal)
      : undefined;
  });

  return (
    <div
      class={["scroll-fades", props.class]}
      data-horizontal={props.horizontal === true ? "" : undefined}
      data-agent-hidden={props.hiddenFromAgent === true ? "" : undefined}
    >
      <div
        class={["scroll-fade-viewport", props.viewportClass]}
        aria-label={props.label}
        role={props.label === undefined ? undefined : "region"}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus named scroll areas.
        tabindex={props.label === undefined ? undefined : 0}
        ref={(element) => {
          viewport = element;
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
