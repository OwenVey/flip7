import ArrowLeft from "@lucide/solid/icons/arrow-left";
import RotateCcw from "@lucide/solid/icons/rotate-ccw";
import Trophy from "@lucide/solid/icons/trophy";
import X from "@lucide/solid/icons/x";
import { Button } from "@ui-sdk/solid/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/solid/dialog";
import {
  createMemo,
  createSignal,
  For,
  onSettled,
  Repeat,
  Show,
} from "solid-js";

import type { RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import { hostName } from "../lib/host";
import { rankPlayers } from "../lib/standings";
import PlayerAvatar from "./player-avatar";
import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

const OPEN_DELAY_MS = 700;

const BURST_PIECES = 28;

const BURST_COLORS = [
  "var(--gold)",
  "var(--accent)",
  "var(--flip-three)",
  "var(--success)",
  "var(--danger)",
  "var(--freeze)",
] as const;

const ORDINAL_SUFFIXES = new Map<Intl.LDMLPluralRule, string>([
  ["few", "rd"],
  ["one", "st"],
  ["two", "nd"],
]);

const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });

const ordinal = (rank: number) =>
  `${rank}${ORDINAL_SUFFIXES.get(ordinalRules.select(rank)) ?? "th"}`;

const points = (score: number) => (score === 1 ? "1 point" : `${score} points`);

const FinalScore = (props: { score: number; roundPoints: number }) => {
  const shown = createCountUp(() => props.score, {
    initial: () => props.score - props.roundPoints,
  });

  return (
    <>
      <span class="game-over-score" aria-hidden="true">
        {shown()}
      </span>
      <span class="sr-only">{points(props.score)}</span>
    </>
  );
};

const burstStyle = (index: number) => {
  const angle = (index / BURST_PIECES) * Math.PI * 2;
  const reach = 7 + ((index * 7) % 5) * 1.5;
  const x = Math.cos(angle) * reach;
  const y = Math.sin(angle) * reach + 4;

  return {
    "--burst-color": BURST_COLORS[index % BURST_COLORS.length],
    "--burst-delay": `${(index % 4) * 40}ms`,
    "--burst-spin": `${((index * 137) % 720) - 360}deg`,
    "--burst-x": `${x.toFixed(2)}rem`,
    "--burst-y": `${y.toFixed(2)}rem`,
  };
};

export default function GameOverDialog(props: {
  room: RoomView;
  playerId: string | null;
  canPlayAgain: boolean;
  canReturnToLobby: boolean;
  actionsDisabled?: boolean;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
}) {
  const [open, setOpen] = createSignal(false);

  onSettled(() => {
    const timer = setTimeout(() => {
      setOpen(true);
    }, OPEN_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  });

  const standings = createMemo(() => rankPlayers(props.room.players));

  const winnerIds = createMemo(() => new Set(props.room.winnerIds));

  const winners = () =>
    standings().filter((entry) => winnerIds().has(entry.player.id));

  const iWon = () => props.playerId !== null && winnerIds().has(props.playerId);

  const title = () => {
    if (iWon()) {
      return winners().length > 1 ? "You share the win!" : "You win!";
    }

    const names = winners().map((entry) => entry.player.name);

    return names.length > 1
      ? `${names.join(" and ")} win!`
      : `${names[0] ?? "Someone"} wins!`;
  };

  const summary = () => {
    const mine = standings().find(
      (entry) => entry.player.id === props.playerId
    );

    if (!mine || iWon()) {
      return null;
    }

    return `You finished ${ordinal(mine.rank)} with ${points(mine.player.score)}.`;
  };

  return (
    <Dialog
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
      }}
      presentation="dialog"
    >
      <DialogContent class="game-over-dialog" initialFocus="content">
        <Tooltip
          content="See the table"
          type="label"
          trigger={(hint) => (
            <DialogClose
              {...hint}
              class="game-over-close"
              aria-label="See the table"
              data-size="sm"
              data-icon=""
            />
          )}
        >
          <X size={16} aria-hidden="true" />
        </Tooltip>
        <div class="game-over-emblem" aria-hidden="true">
          <span class="game-over-rays" />
          <span class="game-over-trophy">
            <Trophy size={40} stroke-width={2.25} />
          </span>
          <span class="game-over-burst">
            <Repeat count={BURST_PIECES}>
              {(index) => <span style={burstStyle(index)} />}
            </Repeat>
          </span>
        </div>
        <p class="game-over-kicker">Game over · Round {props.room.round}</p>
        <DialogTitle class="game-over-title">{title()}</DialogTitle>
        <Show when={summary()}>
          {(text) => (
            <DialogDescription class="game-over-summary">
              {text()}
            </DialogDescription>
          )}
        </Show>
        <ScrollFade class="game-over-list" label="Final standings">
          <ol class="game-over-standings" aria-label="Final scores">
            <For each={standings()} keyed={(entry) => entry.player.id}>
              {(entry) => (
                <li
                  style={{ "--row-index": entry().index }}
                  data-rank={entry().rank <= 3 ? entry().rank : undefined}
                  data-me={
                    entry().player.id === props.playerId ? "" : undefined
                  }
                  data-winner={
                    winnerIds().has(entry().player.id) ? "" : undefined
                  }
                >
                  <span class="game-over-rank">{entry().rank}</span>
                  <PlayerAvatar player={entry().player} />
                  <span class="game-over-name">
                    {entry().player.name}
                    <Show when={entry().player.id === props.playerId}>
                      {" "}
                      <span class="badge">You</span>
                    </Show>
                    <Show when={entry().player.bot}>
                      {" "}
                      <span class="badge" data-tone="bot">
                        Bot
                      </span>
                    </Show>
                  </span>
                  <FinalScore
                    score={entry().player.score}
                    roundPoints={entry().player.lastRound?.total ?? 0}
                  />
                </li>
              )}
            </For>
          </ol>
        </ScrollFade>
        <div class="game-over-actions">
          <Show
            when={props.canReturnToLobby}
            fallback={
              <p class="muted">
                Waiting for {hostName(props.room)} to play again or head back to
                the lobby.
              </p>
            }
          >
            <Button
              data-size="lg"
              data-variant={props.canPlayAgain ? undefined : "solid"}
              disabled={props.actionsDisabled}
              onClick={props.onReturnToLobby}
            >
              <ArrowLeft size={16} />
              Back to lobby
            </Button>
            <Show when={props.canPlayAgain}>
              <Button
                data-size="lg"
                data-variant="solid"
                disabled={props.actionsDisabled}
                data-game-tap=""
                onClick={props.onPlayAgain}
              >
                <RotateCcw size={16} />
                Play again
              </Button>
            </Show>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
