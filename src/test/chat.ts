import type { ChatControls } from "../lib/room-connection";

/** Chat controls for a component test that record what was sent and each typing change. `accept` decides whether a send goes through. */
export const chatControls = (
  accept: ChatControls["send"] = () => true,
  acceptReaction = true
) => {
  const sent: string[] = [];
  const typed: boolean[] = [];
  const reactions: Parameters<ChatControls["react"]>[] = [];

  const controls: ChatControls = {
    react: async (messageId, emoji) => {
      reactions.push([messageId, emoji]);

      return await Promise.resolve(acceptReaction);
    },
    send: (text) => {
      const accepted = accept(text);

      if (accepted) {
        sent.push(text);
      }

      return accepted;
    },
    typing: (active) => {
      typed.push(active);
    },
  };

  return { ...controls, reactions, sent, typed };
};
