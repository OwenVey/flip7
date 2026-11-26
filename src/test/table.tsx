import { createAgent } from "@ui-sdk/solid/agent";
import type { ComponentProps } from "solid-js";

import TableView from "../components/table";
import { roundPointsFor } from "../lib/deal-playback";
import type { PromptPlayback } from "../lib/table-prompt";
import { chatLogFor } from "./chat-log";
import type { ChatLogTestProps } from "./chat-log";

/** Lets the test agent take steps that need a person to confirm them. */
export const agentApproval = { approve: false };

/** Drives the table the way an assistant would, through its labelled controls. */
export const agent = createAgent({
  allow: (step) => (step.confirm ?? "") === "" || agentApproval.approve,
});

/**
 * The table with its own Chat & Log. Deal playback has finished unless a test
 * sets it, and round points are worked out from the room unless a test sets them.
 */
export const Table = (
  props: Omit<ComponentProps<typeof TableView>, "playback" | "chatLog"> &
    Omit<ChatLogTestProps, "dealing"> & { playback?: Partial<PromptPlayback> }
) => {
  const chatLog = chatLogFor({
    get chat() {
      return props.chat;
    },
    get dealing() {
      return props.playback?.dealing;
    },
    get playerId() {
      return props.playerId;
    },
    get room() {
      return props.room;
    },
    get typing() {
      return props.typing;
    },
  });

  return (
    <TableView
      {...props}
      chatLog={chatLog}
      playback={{
        dealing: props.playback?.dealing ?? false,
        moment: props.playback?.moment ?? null,
        roundPoints: props.playback?.roundPoints ?? roundPointsFor(props.room),
        step: props.playback?.step ?? null,
      }}
    />
  );
};
