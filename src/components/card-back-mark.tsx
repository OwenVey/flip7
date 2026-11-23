/** The 7 on the back of every card, shared with the copy that flies off the deck. */
export const CARD_BACK_MARK_VIEW_BOX = "13 12 30 36";
export const CARD_BACK_MARK_PATH = "M16 15h24v7L28 45h-9l12-22H16z";

export default function CardBackMark() {
  return (
    <svg viewBox={CARD_BACK_MARK_VIEW_BOX} aria-hidden="true">
      <path d={CARD_BACK_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
