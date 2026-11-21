import type { JSX } from "@solidjs/web";
import {
  createTooltipController,
  Tooltip,
  TooltipContent,
} from "@ui-sdk/solid/tooltip";
import type { TooltipController } from "@ui-sdk/solid/tooltip";
import { createContext, useContext } from "solid-js";

const CardTooltipsContext = createContext<TooltipController<string> | null>(
  null
);

export const useCardTooltips = () => useContext(CardTooltipsContext);

/**
 * One tooltip shared by every card inside, so a hand of cards doesn't render
 * a tooltip beside each one.
 */
export default function CardTooltips(props: { children: JSX.Element }) {
  const controller = createTooltipController<string>();

  return (
    <CardTooltipsContext value={controller}>
      {props.children}
      <Tooltip controller={controller} delay={0}>
        <TooltipContent<string> data-agent-hidden="" sideOffset={8}>
          {(state) => <>{state.payload}</>}
        </TooltipContent>
      </Tooltip>
    </CardTooltipsContext>
  );
}
