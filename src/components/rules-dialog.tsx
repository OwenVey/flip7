import X from "@lucide/solid/icons/x";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";

import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

export default function RulesDialog(props: {
  targetScore: number;
  label?: string;
  variant?: "quiet";
}) {
  return (
    <Dialog presentation="auto">
      <DialogTrigger
        data-variant={props.variant}
        data-size={props.variant ? "sm" : undefined}
      >
        {props.label ?? "Rules"}
      </DialogTrigger>
      <DialogContent class="rules-dialog" initialFocus="content">
        <header class="table-sheet-header">
          <DialogTitle>How to play</DialogTitle>
          <Tooltip
            content="Close rules"
            type="label"
            trigger={(hint) => (
              <DialogClose
                {...hint}
                aria-label="Close rules"
                data-size="sm"
                data-icon=""
              />
            )}
          >
            <X size={16} aria-hidden="true" />
          </Tooltip>
        </header>
        <ScrollFade viewportClass="table-sheet-body" label="Game rules">
          <ul>
            <li>
              On your turn, <strong>Hit</strong> to get dealt another card or{" "}
              <strong>Stay</strong> to bank your points and exit the round. You
              can Stay once you have a card in front of you.
            </li>
            <li>
              If you get a duplicate Number card, you bust and score zero for
              the round.
            </li>
            <li>
              <strong>Flip 7</strong> unique Number cards to earn 15 bonus
              points and end the round for everyone. Only Number cards count
              toward the Flip 7 bonus.
            </li>
            <li>
              <strong>Action cards</strong> are played on active players.{" "}
              <strong>Freeze</strong> banks the receiving player's points and
              ends their round. <strong>Flip Three</strong> makes them take the
              next three cards, one at a time. Any Freeze or Flip Three they
              reveal waits until all three cards are done.{" "}
              <strong>Second Chance</strong> is discarded along with your next
              duplicate Number card.
            </li>
            <li>
              Add up your Number cards, apply the ×2 multiplier if you have it,
              then add points from any other{" "}
              <strong>Score Modifier cards</strong> and the Flip 7 bonus.
            </li>
            <li>
              When a round ends with someone at {props.targetScore} or more, the
              highest score wins. A tie for first plays on.
            </li>
            <li>
              If the deck and the discard pile both run out, the round ends and
              everyone who hasn't busted scores what they hold.
            </li>
          </ul>
        </ScrollFade>
      </DialogContent>
    </Dialog>
  );
}
