import Trophy from "@lucide/solid/icons/trophy";
import { createAlertDialogController } from "@ui-sdk/solid/alert-dialog";
import { createPopoverController } from "@ui-sdk/solid/popover";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { availableMoves } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { pointsOf } from "../lib/deal-playback";
import type { RoomChatLog } from "../lib/room-chat-log";
import { passDealerChip } from "../lib/table-motion";
import type { ChipSpot } from "../lib/table-motion";
import { tablePrompt } from "../lib/table-prompt";
import type { PromptPlayback } from "../lib/table-prompt";
import ActionBar from "./action-bar";
import CardTooltips from "./card-tooltips";
import ChatSheet from "./chat-sheet";
import Confetti from "./confetti";
import ChatLogPanel from "./game-log";
import GameOverDialog from "./game-over-dialog";
import InviteButton from "./invite-button";
import Leaderboard from "./leaderboard";
import LeaveRoom from "./leave-room";
import { RoomSettingsMenu } from "./room-settings";
import RoundPlayer from "./round-player";
import ScrollFade from "./scroll-fade";
import { SpectatorActions, WatcherCount } from "./spectator-controls";
import type { Spectator } from "./spectator-controls";
import { samePlayerIds, SCORES_TITLE } from "./table-common";
import type { TableProps } from "./table-common";
import TableMoreMenu from "./table-more-menu";
import TableSheet from "./table-sheet";

export default function Table(
  props: TableProps & {
    /** Deal playback, as the room route receives it. */
    playback: PromptPlayback;
    chatLog: RoomChatLog;
    /**
     * The room as last confirmed, ahead of deal playback. Settings read it so
     * a change shows as soon as the room accepts it, not after the deal.
     */
    latestRoom?: RoomView | null;
    /** A Spectator's Join and Leave, shown where a player's Leave and ⋯ go. */
    spectator?: Spectator;
  }
) {
  const moves = createMemo(() => availableMoves(props.room, props.playerId));

  const prompt = createMemo(() =>
    tablePrompt(props.room, props.playerId, props.playback)
  );

  const playerIds = createMemo(() => props.room.players.map(({ id }) => id), {
    equals: samePlayerIds,
  });

  const settings = createPopoverController();
  const leave = createAlertDialogController();

  const removePlayer = (playerId: string) => {
    void props.send({ playerId, type: "kick" });
  };

  const makeHost = (playerId: string) => {
    void props.send({ playerId, type: "makeHost" });
  };

  const chooseTarget = (targetId: string) => {
    const pick = prompt().players.get(targetId)?.pick;

    if (props.actionsDisabled === true || pick === null || pick === undefined) {
      return;
    }

    const { forId } = pick;
    void props.send({
      ...(forId !== undefined && { forId }),
      targetId,
      type: "choose",
    });
  };

  let chipSpot: ChipSpot | null = null;

  createEffect(
    () => props.room.dealerId,
    (dealerId) => {
      chipSpot = passDealerChip(dealerId, chipSpot);
    }
  );

  const [scoresOpen, setScoresOpen] = createSignal(false);

  const sheetResultsRound = createMemo(() => {
    const round = prompt().resultsRound;

    return round !== null && props.chatLog.inSheet() ? round : null;
  });

  createEffect(sheetResultsRound, (round, previous) => {
    if (round !== null) {
      setScoresOpen(true);
    } else if (previous !== null && previous !== undefined) {
      setScoresOpen(false);
    }
  });

  return (
    <CardTooltips>
      <div class="table" data-phase={props.room.phase}>
        <header class="table-header">
          <h1>Round {props.room.round}</h1>
          <div class="row">
            <WatcherCount
              count={(props.latestRoom ?? props.room).spectatorCount}
              watching={props.playerId === null}
            />
            <TableSheet
              open={scoresOpen()}
              onOpenChange={(open) => {
                setScoresOpen(open);
              }}
              title={SCORES_TITLE}
              triggerLabel={SCORES_TITLE}
              shortLabel={SCORES_TITLE}
              trigger={<Trophy size={16} aria-hidden="true" />}
            >
              <Leaderboard
                room={props.room}
                playerId={props.playerId}
                roundPoints={props.playback.roundPoints}
              />
            </TableSheet>
            <ChatSheet chatLog={props.chatLog} />
            <InviteButton brief collapsible />
            <Show when={moves().host.configure}>
              <RoomSettingsMenu
                room={props.latestRoom ?? props.room}
                controller={settings}
                collapsible
                onChange={(changes) => {
                  void props.send({ ...changes, type: "configure" });
                }}
              />
            </Show>
            <Show
              when={props.playerId !== null}
              fallback={
                <Show when={props.spectator}>
                  {(spectator) => (
                    <SpectatorActions
                      room={props.latestRoom ?? props.room}
                      join={spectator().join}
                      onStopWatching={spectator().onLeave}
                    />
                  )}
                </Show>
              }
            >
              <LeaveRoom
                disabled={props.offline}
                controller={leave}
                collapsible
                onLeave={() => {
                  void props.send({ type: "leave" });
                }}
              />
              <TableMoreMenu
                leave={leave}
                leaveDisabled={props.offline}
                settings={moves().host.configure ? settings : undefined}
              />
            </Show>
          </div>
        </header>

        <ActionBar
          room={props.room}
          send={props.send}
          actionsDisabled={props.actionsDisabled}
          prompt={prompt().bar}
          gameOver={prompt().gameOver}
          roundResults={prompt().resultsRound !== null}
        />

        <div class="table-body">
          <div class="seats">
            <For each={playerIds()}>
              {(id, index) => (
                <Show when={props.room.players[index()]}>
                  {(player) => (
                    <Show when={prompt().players.get(id)}>
                      {(playerPrompt) => (
                        <RoundPlayer
                          player={player()}
                          room={props.room}
                          playerId={props.playerId}
                          actionsDisabled={props.actionsDisabled}
                          removeDisabled={props.offline}
                          roundPoints={pointsOf(props.playback.roundPoints, id)}
                          prompt={playerPrompt()}
                          host={moves().host}
                          dealStep={props.playback.step}
                          onPick={chooseTarget}
                          onRemove={removePlayer}
                          onMakeHost={makeHost}
                        />
                      )}
                    </Show>
                  )}
                </Show>
              )}
            </For>
          </div>

          <div class="stack table-sidebar">
            <section class="panel leaderboard-panel">
              <h2>{SCORES_TITLE}</h2>
              <ScrollFade
                class="leaderboard-body"
                viewportClass="leaderboard-scroll"
                label={SCORES_TITLE}
              >
                <Leaderboard
                  room={props.room}
                  playerId={props.playerId}
                  roundPoints={props.playback.roundPoints}
                />
              </ScrollFade>
            </section>
            <ChatLogPanel chatLog={props.chatLog} />
          </div>
        </div>
        <div class="flight-layer" data-flight-layer="" aria-hidden="true" />
        <div class="flight-layer" data-chip-layer="" aria-hidden="true" />
        <Show when={prompt().gameOver}>
          <Confetti />
          <GameOverDialog
            room={props.room}
            playerId={props.playerId}
            canPlayAgain={moves().host.start}
            canReturnToLobby={moves().host.lobby}
            actionsDisabled={props.actionsDisabled}
            onPlayAgain={() => {
              void props.send({ type: "start" });
            }}
            onReturnToLobby={() => {
              void props.send({ type: "lobby" });
            }}
          />
        </Show>
      </div>
    </CardTooltips>
  );
}
