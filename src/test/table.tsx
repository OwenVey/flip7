import { createAgent } from "@ui-sdk/solid/agent";
import type { ComponentProps } from "solid-js";

import TableView from "../components/table";
import { roundPointsFor } from "../lib/deal-playback";

/** Lets the test agent take steps that need a person to confirm them. */
export const agentApproval = { approve: false };

/** Drives the table the way an assistant would, through its labelled controls. */
export const agent = createAgent({
  allow: (step) => (step.confirm ?? "") === "" || agentApproval.approve,
});

/** The table, with round points worked out from the room unless a test sets them. */
export const Table = (
  props: Omit<ComponentProps<typeof TableView>, "roundPoints"> &
    Partial<Pick<ComponentProps<typeof TableView>, "roundPoints">>
) => (
  <TableView
    {...props}
    roundPoints={props.roundPoints ?? roundPointsFor(props.room)}
  />
);
