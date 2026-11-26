import type { ComponentProps } from "solid-js";

import LobbyView from "../components/lobby";
import { chatLogFor } from "./chat-log";
import type { ChatLogTestProps } from "./chat-log";

/** The lobby with its own Chat & Log. */
export const Lobby = (
  props: Omit<ComponentProps<typeof LobbyView>, "chatLog"> & ChatLogTestProps
) => {
  const chatLog = chatLogFor(props);

  return <LobbyView {...props} chatLog={chatLog} />;
};
