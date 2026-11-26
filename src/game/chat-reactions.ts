import * as v from "valibot";

export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "🎉", "😬"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export const ReactionEmojiSchema = v.picklist(REACTION_EMOJI);

/** Each Player's reaction to one chat message, by player ID. */
export type MessageReactions = Record<string, ReactionEmoji>;

/** The reactions to each chat message, by message ID, then player ID. */
export type ChatReactions = Map<number, Map<string, ReactionEmoji>>;

export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;

export const toReactionsView = (reactions: ChatReactions) => {
  const view: Record<number, MessageReactions> = {};

  for (const [id, byPlayer] of reactions) {
    view[id] = Object.fromEntries(byPlayer);
  }

  return view;
};

export const countReactions = (reactions: MessageReactions = {}) => {
  const counts: ReactionCounts = {};

  for (const emoji of Object.values(reactions)) {
    counts[emoji] = (counts[emoji] ?? 0) + 1;
  }

  return counts;
};
