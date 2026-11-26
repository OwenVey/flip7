export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "🎉", "😬"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface ChatReaction {
  playerId: string;
  emoji: ReactionEmoji;
}

export type ChatReactions = Map<number, ChatReaction[]>;

export type ReactionSelections = Partial<Record<number, ReactionEmoji>>;

export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;

export const countReactions = (reactions: ChatReactions) => {
  const counts: Partial<Record<number, ReactionCounts>> = {};

  for (const [id, entries] of reactions) {
    const totals: ReactionCounts = {};

    for (const { emoji } of entries) {
      totals[emoji] = (totals[emoji] ?? 0) + 1;
    }

    counts[id] = totals;
  }

  return counts;
};

export const reactionSelections = (reactions: ChatReactions) => {
  const selections = new Map<string, ReactionSelections>();

  for (const [id, entries] of reactions) {
    for (const { emoji, playerId } of entries) {
      const mine = selections.get(playerId) ?? {};
      mine[id] = emoji;
      selections.set(playerId, mine);
    }
  }

  return selections;
};
